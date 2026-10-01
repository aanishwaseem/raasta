import { Injectable, OnModuleInit } from '@nestjs/common';
import { config } from '../../config/config';
import { DatabaseService } from '../../common/db/database.service';
import { QueueService } from '../../common/queue/queue.service';
import { EventBus } from '../../common/events/event-bus';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { PageQuery } from '../../common/dto';
import type { AuthUser } from '../../common/auth/auth.types';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { platformFee } from '../pricing/pricing.engine';
import { LedgerService } from './ledger.service';
import { PaymentProvider } from './payment-provider';

interface RideForPayment {
  id: string;
  passenger_id: string;
  driver_id: string;
  city_id: string;
  product_code: string;
  offered_fare: number;
  discount_amount: number;
  payment_method: 'CASH' | 'WALLET' | 'CARD' | 'CORPORATE';
  corporate_id: string | null;
  payment_status: string;
}

export interface SettlementResult {
  status: 'PAID' | 'FAILED';
  method: string;
  amount: number;
  failureReason?: string;
}

/**
 * Payment orchestration over a provider abstraction and a double-entry ledger.
 * Drivers are always paid the agreed fare minus the platform fee; promo discounts are funded by
 * the PROMOTIONS wallet, never by the driver.
 */
@Injectable()
export class PaymentsService implements OnModuleInit {

  constructor(
    private readonly db: DatabaseService,
    private readonly ledger: LedgerService,
    private readonly provider: PaymentProvider,
    private readonly queue: QueueService,
    private readonly events: EventBus,
    private readonly metrics: MetricsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.queue.register('maintenance', 'settle-driver-earnings', () => this.settlePendingEarnings());
  }

  // ------------------------------------------------------------ ride settlement
  async settleRide(rideId: string): Promise<SettlementResult> {
    const ride = await this.db.one<RideForPayment>(
      `SELECT id, passenger_id, driver_id, city_id, product_code, offered_fare, discount_amount, payment_method, corporate_id, payment_status
         FROM rides WHERE id = $1 AND status = 'COMPLETED'`,
      [rideId],
    );
    if (!ride) throw AppError.notFound('Completed ride');
    if (ride.payment_status === 'PAID') return { status: 'PAID', method: ride.payment_method, amount: ride.offered_fare - ride.discount_amount };
    const cfg = await this.db.one<{ platform_fee_pct: number }>(`SELECT platform_fee_pct FROM pricing_configs WHERE city_id=$1 AND product_code=$2`, [ride.city_id, ride.product_code]);
    const fare = ride.offered_fare;
    const discount = Math.min(ride.discount_amount, fare);
    const payable = fare - discount;
    const fee = platformFee(fare, cfg?.platform_fee_pct ?? 15);

    const driverW = await this.ledger.wallet('DRIVER', ride.driver_id);
    const revenueW = await this.ledger.wallet('PLATFORM_REVENUE', null);
    const promoW = await this.ledger.wallet('PROMOTIONS', null);
    let result: SettlementResult;

    if (ride.payment_method === 'CASH') {
      // Passenger pays `payable` in cash directly to the driver. Driver owes the fee, and is owed the discount.
      await this.db.tx(async (c) => {
        const { transactionId } = await this.ledger.post(c, {
          kind: 'RIDE_CASH_COMMISSION',
          idempotencyKey: `ride:${ride.id}:settle`,
          description: `Cash ride: platform fee Rs ${fee}${discount ? `, promo reimbursement Rs ${discount}` : ''}`,
          referenceType: 'ride',
          referenceId: ride.id,
          entries: [
            { walletId: driverW, amount: -fee + discount },
            { walletId: revenueW, amount: fee },
            { walletId: promoW, amount: -discount },
          ],
        });
        await this.recordPayment(c, ride, 'CASH', 'cash', payable, 'SUCCEEDED', null, transactionId);
      });
      result = { status: 'PAID', method: 'CASH', amount: payable };
    } else if (ride.payment_method === 'WALLET' || ride.payment_method === 'CORPORATE') {
      const ownerType = ride.payment_method === 'WALLET' ? 'PASSENGER' : 'CORPORATE';
      const ownerId = ride.payment_method === 'WALLET' ? ride.passenger_id : ride.corporate_id!;
      const payerW = await this.ledger.wallet(ownerType, ownerId);
      result = await this.db.tx(async (c) => {
        await this.ledger.lockWallet(c, payerW);
        if (ownerType === 'PASSENGER') {
          const bal = await this.ledger.balance(payerW, c);
          if (bal.available < payable) {
            await this.recordPayment(c, ride, 'WALLET', 'wallet', payable, 'FAILED', 'insufficient_balance', null);
            return { status: 'FAILED' as const, method: 'WALLET', amount: payable, failureReason: 'insufficient_balance' };
          }
        }
        const { transactionId } = await this.ledger.post(c, {
          kind: ownerType === 'PASSENGER' ? 'RIDE_PAYMENT' : 'CORPORATE_CHARGE',
          idempotencyKey: `ride:${ride.id}:settle`,
          description: `Ride payment Rs ${payable}`,
          referenceType: 'ride',
          referenceId: ride.id,
          entries: [
            { walletId: payerW, amount: -payable },
            { walletId: promoW, amount: -discount },
            { walletId: driverW, amount: fare - fee, bucket: 'PENDING' },
            { walletId: revenueW, amount: fee },
          ],
        });
        await this.recordPayment(c, ride, ride.payment_method, ownerType === 'PASSENGER' ? 'wallet' : 'corporate', payable, 'SUCCEEDED', null, transactionId);
        return { status: 'PAID' as const, method: ride.payment_method, amount: payable };
      });
    } else {
      // CARD via provider
      const pm = await this.db.one<{ provider_token: string }>(
        `SELECT provider_token FROM payment_methods WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 1`,
        [ride.passenger_id],
      );
      const charge = pm
        ? await this.provider.charge({ amount: payable, currency: 'PKR', token: pm.provider_token, idempotencyKey: `ride-${ride.id}`, description: `Raasta ride ${ride.id.slice(0, 8)}` })
        : { status: 'FAILED' as const, providerRef: null, failureReason: 'no_payment_method' };
      const gatewayW = await this.ledger.wallet('PAYMENT_GATEWAY', null);
      result = await this.db.tx(async (c) => {
        if (charge.status !== 'SUCCEEDED') {
          await this.recordPayment(c, ride, 'CARD', this.provider.name, payable, 'FAILED', charge.failureReason ?? 'payment_failed', null, charge.providerRef);
          return { status: 'FAILED' as const, method: 'CARD', amount: payable, failureReason: charge.failureReason };
        }
        const { transactionId } = await this.ledger.post(c, {
          kind: 'RIDE_PAYMENT',
          idempotencyKey: `ride:${ride.id}:settle`,
          description: `Card payment Rs ${payable}`,
          referenceType: 'ride',
          referenceId: ride.id,
          entries: [
            { walletId: gatewayW, amount: -payable },
            { walletId: promoW, amount: -discount },
            { walletId: driverW, amount: fare - fee, bucket: 'PENDING' },
            { walletId: revenueW, amount: fee },
          ],
        });
        await this.recordPayment(c, ride, 'CARD', this.provider.name, payable, 'SUCCEEDED', null, transactionId, charge.providerRef);
        return { status: 'PAID' as const, method: 'CARD', amount: payable };
      });
    }

    await this.db.query(`UPDATE rides SET payment_status = $2, final_fare = $3 WHERE id = $1`, [ride.id, result.status === 'PAID' ? 'PAID' : 'FAILED', payable]);
    if (result.status === 'FAILED') {
      this.metrics.paymentFailures.inc({ method: result.method, reason: result.failureReason ?? 'unknown' });
      this.events.emit('payment.failed', { userId: ride.passenger_id, rideId: ride.id, reason: result.failureReason ?? 'unknown' });
    }
    const payload = { rideId: ride.id, status: result.status, method: result.method, amount: result.amount, failureReason: result.failureReason ?? null };
    this.realtime.toRide(ride.id, 'payment.updated', payload);
    this.realtime.toUser(ride.passenger_id, 'payment.updated', payload);
    return result;
  }

  /**
   * After a failed wallet/card payment the passenger settles in cash with the driver (the app asks
   * the driver to collect). Recorded like a cash ride.
   */
  async fallbackToCash(rideId: string, actor: AuthUser): Promise<SettlementResult> {
    const ride = await this.db.one<{ passenger_id: string; driver_id: string; payment_status: string }>(`SELECT passenger_id, driver_id, payment_status FROM rides WHERE id=$1 AND status='COMPLETED'`, [rideId]);
    if (!ride || (ride.passenger_id !== actor.id && ride.driver_id !== actor.id)) throw AppError.notFound('Ride', 'RIDE_NOT_FOUND');
    if (ride.payment_status !== 'FAILED') throw AppError.conflict('PAYMENT_NOT_FAILED', 'This ride does not need a payment fallback');
    await this.db.query(`UPDATE rides SET payment_method = 'CASH', payment_status = 'PENDING' WHERE id = $1`, [rideId]);
    return this.settleRide(rideId);
  }

  // ------------------------------------------------------------ cancellation fee
  async chargeCancellationFee(rideId: string, passengerId: string, driverId: string | null, cityId: string, productCode: string, fee: number): Promise<void> {
    if (fee <= 0) return;
    const cfg = await this.db.one<{ platform_fee_pct: number }>(`SELECT platform_fee_pct FROM pricing_configs WHERE city_id=$1 AND product_code=$2`, [cityId, productCode]);
    const cut = platformFee(fee, cfg?.platform_fee_pct ?? 15);
    const passengerW = await this.ledger.wallet('PASSENGER', passengerId);
    const revenueW = await this.ledger.wallet('PLATFORM_REVENUE', null);
    const entries = driverId
      ? [
          { walletId: passengerW, amount: -fee },
          { walletId: await this.ledger.wallet('DRIVER', driverId), amount: fee - cut, bucket: 'PENDING' as const },
          { walletId: revenueW, amount: cut },
        ]
      : [
          { walletId: passengerW, amount: -fee },
          { walletId: revenueW, amount: fee },
        ];
    await this.db.tx(async (c) => {
      const { transactionId } = await this.ledger.post(c, {
        kind: 'CANCELLATION_FEE',
        idempotencyKey: `ride:${rideId}:cancel-fee`,
        description: `Late cancellation fee Rs ${fee}`,
        referenceType: 'ride',
        referenceId: rideId,
        entries,
      });
      await c.query(
        `INSERT INTO payments (ride_id, payer_user_id, purpose, method, provider, amount, status, idempotency_key, ledger_transaction_id)
         VALUES ($1,$2,'CANCELLATION_FEE','WALLET','wallet',$3,'SUCCEEDED',$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`,
        [rideId, passengerId, fee, `ride:${rideId}:cancel-fee`, transactionId],
      );
    });
  }

  // ------------------------------------------------------------ passenger wallet
  async ledgerFor(walletId: string, q: PageQuery) {
    await this.ledger.requireWallet(walletId);
    return this.ledger.entries(walletId, q);
  }

  async walletSummary(userId: string, ownerType: 'PASSENGER' | 'DRIVER') {
    const walletId = await this.ledger.wallet(ownerType, userId);
    const bal = await this.ledger.balance(walletId);
    return { walletId, currency: 'PKR', available: bal.available, pending: bal.pending, outstanding: bal.available < 0 ? -bal.available : 0 };
  }

  async transactions(userId: string, ownerType: 'PASSENGER' | 'DRIVER', q: PageQuery) {
    const walletId = await this.ledger.wallet(ownerType, userId);
    return this.ledger.entries(walletId, q);
  }

  async topup(userId: string, amount: number, paymentMethodId: string, idempotencyKey: string) {
    const pm = await this.db.one<{ provider_token: string; provider: string }>(`SELECT provider_token, provider FROM payment_methods WHERE id = $1 AND user_id = $2`, [paymentMethodId, userId]);
    if (!pm) throw AppError.notFound('Payment method');
    const key = `topup:${userId}:${idempotencyKey}`;
    const charge = await this.provider.charge({ amount, currency: 'PKR', token: pm.provider_token, idempotencyKey: key, description: 'Raasta wallet top-up' });
    const passengerW = await this.ledger.wallet('PASSENGER', userId);
    const gatewayW = await this.ledger.wallet('PAYMENT_GATEWAY', null);
    const payment = await this.db.tx(async (c) => {
      let txId: string | null = null;
      if (charge.status === 'SUCCEEDED') {
        ({ transactionId: txId } = await this.ledger.post(c, {
          kind: 'TOPUP',
          idempotencyKey: key,
          description: `Wallet top-up Rs ${amount}`,
          referenceType: 'payment',
          entries: [
            { walletId: gatewayW, amount: -amount },
            { walletId: passengerW, amount },
          ],
        }));
      }
      const row = await this.db.one<{ id: string; status: string }>(
        `INSERT INTO payments (payer_user_id, purpose, method, provider, provider_ref, amount, status, failure_reason, idempotency_key, ledger_transaction_id)
         VALUES ($1,'TOPUP','CARD',$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now() RETURNING id, status`,
        [userId, this.provider.name, charge.providerRef, amount, charge.status, charge.failureReason ?? null, key, txId],
        c,
      );
      return row!;
    });
    if (charge.status !== 'SUCCEEDED') {
      this.metrics.paymentFailures.inc({ method: 'CARD', reason: charge.failureReason ?? 'unknown' });
      this.events.emit('payment.failed', { userId, reason: charge.failureReason ?? 'unknown' });
      throw new AppError('PAYMENT_FAILED', friendlyFailure(charge.failureReason), 402, { paymentId: payment.id });
    }
    this.realtime.toUser(userId, 'payment.updated', { paymentId: payment.id, status: 'SUCCEEDED', purpose: 'TOPUP', amount });
    return { paymentId: payment.id, status: 'SUCCEEDED', wallet: await this.walletSummary(userId, 'PASSENGER') };
  }

  // ------------------------------------------------------------ payment methods (tokens only)
  async addPaymentMethod(userId: string, provider: string, token: string) {
    if (provider.toLowerCase() !== this.provider.name) throw AppError.unprocessable('PROVIDER_MISMATCH', 'This payment provider is not enabled');
    const info = await this.provider.describeToken(token);
    if (!info && this.provider.name === 'mock') throw AppError.unprocessable('INVALID_TOKEN', 'This card could not be added');
    const count = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM payment_methods WHERE user_id = $1`, [userId]);
    return this.db.one(
      `INSERT INTO payment_methods (user_id, provider, provider_token, brand, last4, exp_month, exp_year, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, provider, brand, last4, exp_month AS "expMonth", exp_year AS "expYear", is_default AS "isDefault"`,
      [userId, this.provider.name, token, info?.brand ?? null, info?.last4 ?? null, info?.expMonth ?? null, info?.expYear ?? null, (count?.n ?? 0) === 0],
    );
  }

  listPaymentMethods(userId: string) {
    return this.db.query(
      `SELECT id, provider, brand, last4, exp_month AS "expMonth", exp_year AS "expYear", is_default AS "isDefault"
         FROM payment_methods WHERE user_id = $1 ORDER BY is_default DESC, created_at`,
      [userId],
    );
  }

  async removePaymentMethod(userId: string, id: string) {
    const row = await this.db.one(`DELETE FROM payment_methods WHERE id=$1 AND user_id=$2 RETURNING id`, [id, userId]);
    if (!row) throw AppError.notFound('Payment method');
  }

  // ------------------------------------------------------------ driver earnings & withdrawals
  /** Moves driver earnings from PENDING to AVAILABLE after the settlement delay. Idempotent. */
  async settlePendingEarnings(): Promise<number> {
    const rows = await this.db.query<{ tx_id: string; wallet_id: string; amount: number }>(
      `SELECT lt.id AS tx_id, wt.wallet_id, wt.amount
         FROM ledger_transactions lt JOIN wallet_transactions wt ON wt.transaction_id = lt.id
        WHERE wt.bucket = 'PENDING' AND wt.amount > 0
          AND lt.created_at < now() - make_interval(hours => $1)
          AND NOT EXISTS (SELECT 1 FROM ledger_transactions s WHERE s.idempotency_key = 'settle:' || lt.id || ':' || wt.wallet_id)
        LIMIT 500`,
      [config().SETTLEMENT_DELAY_HOURS],
    );
    for (const r of rows) {
      await this.db.tx((c) =>
        this.ledger.post(c, {
          kind: 'DRIVER_EARNING',
          idempotencyKey: `settle:${r.tx_id}:${r.wallet_id}`,
          description: 'Earnings available for withdrawal',
          referenceType: 'ledger_transaction',
          referenceId: r.tx_id,
          entries: [
            { walletId: r.wallet_id, amount: -r.amount, bucket: 'PENDING' },
            { walletId: r.wallet_id, amount: r.amount, bucket: 'AVAILABLE' },
          ],
        }),
      );
    }
    return rows.length;
  }

  async requestWithdrawal(driverId: string, amount: number, destination: { method: string; accountNumber: string; accountTitle: string }) {
    const driverW = await this.ledger.wallet('DRIVER', driverId);
    const clearingW = await this.ledger.wallet('PLATFORM_CASH_CLEARING', null);
    return this.db.tx(async (c) => {
      await this.ledger.lockWallet(c, driverW);
      const bal = await this.ledger.balance(driverW, c);
      if (bal.available < amount) throw AppError.unprocessable('INSUFFICIENT_BALANCE', `You can withdraw up to Rs ${Math.max(0, bal.available)}`);
      const masked = { method: destination.method, accountTitle: destination.accountTitle, accountLast4: destination.accountNumber.slice(-4) };
      const w = await this.db.one<{ id: string }>(`INSERT INTO withdrawals (driver_id, amount, destination) VALUES ($1,$2,$3) RETURNING id`, [driverId, amount, JSON.stringify(masked)], c);
      await this.ledger.post(c, {
        kind: 'WITHDRAWAL',
        idempotencyKey: `withdrawal:${w!.id}`,
        description: `Withdrawal request Rs ${amount}`,
        referenceType: 'withdrawal',
        referenceId: w!.id,
        entries: [
          { walletId: driverW, amount: -amount },
          { walletId: clearingW, amount },
        ],
      });
      return { withdrawalId: w!.id, status: 'REQUESTED', amount };
    });
  }

  async processWithdrawal(admin: AuthUser, withdrawalId: string, decision: 'PAID' | 'REJECTED', note?: string) {
    const w = await this.db.one<{ id: string; driver_id: string; amount: number; status: string }>(`SELECT id, driver_id, amount, status FROM withdrawals WHERE id = $1`, [withdrawalId]);
    if (!w) throw AppError.notFound('Withdrawal');
    if (w.status !== 'REQUESTED') throw AppError.conflict('ALREADY_PROCESSED', 'This withdrawal was already processed');
    const clearingW = await this.ledger.wallet('PLATFORM_CASH_CLEARING', null);
    const otherW = decision === 'PAID' ? await this.ledger.wallet('PAYMENT_GATEWAY', null) : await this.ledger.wallet('DRIVER', w.driver_id);
    await this.db.tx(async (c) => {
      await this.ledger.post(c, {
        kind: decision === 'PAID' ? 'WITHDRAWAL_SETTLED' : 'REFUND',
        idempotencyKey: `withdrawal:${w.id}:${decision}`,
        description: decision === 'PAID' ? `Withdrawal paid out Rs ${w.amount}` : `Withdrawal rejected, Rs ${w.amount} returned`,
        referenceType: 'withdrawal',
        referenceId: w.id,
        createdBy: admin.id,
        entries: [
          { walletId: clearingW, amount: -w.amount },
          { walletId: otherW, amount: w.amount },
        ],
      });
      await c.query(`UPDATE withdrawals SET status = $2, processed_by = $3, processed_at = now() WHERE id = $1`, [w.id, decision, admin.id]);
      await this.audit.log({ actor: admin, action: `withdrawal.${decision.toLowerCase()}`, entityType: 'withdrawal', entityId: w.id, after: { decision }, reason: note }, c);
    });
    await this.notifications.notify({
      userId: w.driver_id,
      type: 'WITHDRAWAL_' + decision,
      title: decision === 'PAID' ? 'Withdrawal sent' : 'Withdrawal rejected',
      body: decision === 'PAID' ? `Rs ${w.amount} has been sent to your account.` : `Rs ${w.amount} was returned to your wallet.${note ? ` ${note}` : ''}`,
    });
    return { id: w.id, status: decision };
  }

  /** Referral reward to the referrer after the referee's first completed ride (blocked on device reuse). */
  async rewardReferral(refereeId: string, rideId: string): Promise<void> {
    const u = await this.db.one<{ referred_by: string | null }>(`SELECT referred_by FROM users WHERE id = $1`, [refereeId]);
    if (!u?.referred_by) return;
    const first = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM rides WHERE passenger_id = $1 AND status = 'COMPLETED'`, [refereeId]);
    if ((first?.n ?? 0) !== 1) return;
    const sharedDevice = await this.db.one(
      `SELECT 1 FROM auth_sessions a JOIN auth_sessions b ON a.device_id = b.device_id
        WHERE a.user_id = $1 AND b.user_id = $2 AND a.device_id IS NOT NULL LIMIT 1`,
      [refereeId, u.referred_by],
    );
    const amount = config().REFERRAL_REWARD_PKR;
    if (sharedDevice) {
      await this.db.query(
        `INSERT INTO referral_rewards (referrer_id, referee_id, ride_id, amount, status, blocked_reason) VALUES ($1,$2,$3,$4,'BLOCKED','same device') ON CONFLICT (referee_id) DO NOTHING`,
        [u.referred_by, refereeId, rideId, amount],
      );
      return;
    }
    const referrerW = await this.ledger.wallet('PASSENGER', u.referred_by);
    const promoW = await this.ledger.wallet('PROMOTIONS', null);
    await this.db.tx(async (c) => {
      const inserted = await c.query(
        `INSERT INTO referral_rewards (referrer_id, referee_id, ride_id, amount, status) VALUES ($1,$2,$3,$4,'PAID') ON CONFLICT (referee_id) DO NOTHING RETURNING referee_id`,
        [u.referred_by, refereeId, rideId, amount],
      );
      if (!inserted.rowCount) return;
      await this.ledger.post(c, {
        kind: 'REFERRAL_REWARD',
        idempotencyKey: `referral:${refereeId}`,
        description: `Referral reward Rs ${amount}`,
        referenceType: 'user',
        referenceId: refereeId,
        entries: [
          { walletId: promoW, amount: -amount },
          { walletId: referrerW, amount },
        ],
      });
    });
    await this.notifications.notify({ userId: u.referred_by, type: 'REFERRAL_REWARD', title: 'Referral reward', body: `Rs ${amount} has been added to your wallet. Thanks for inviting a friend!` });
  }

  private async recordPayment(
    c: Parameters<LedgerService['post']>[0],
    ride: RideForPayment,
    method: string,
    provider: string,
    amount: number,
    status: 'SUCCEEDED' | 'FAILED',
    failureReason: string | null,
    ledgerTxId: string | null,
    providerRef: string | null = null,
  ) {
    await c.query(
      `INSERT INTO payments (ride_id, payer_user_id, purpose, method, provider, provider_ref, amount, status, failure_reason, idempotency_key, ledger_transaction_id)
       VALUES ($1,$2,'RIDE',$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (idempotency_key) DO UPDATE SET status = EXCLUDED.status, failure_reason = EXCLUDED.failure_reason,
         ledger_transaction_id = EXCLUDED.ledger_transaction_id, provider_ref = EXCLUDED.provider_ref, method = EXCLUDED.method, updated_at = now()`,
      [ride.id, method === 'CORPORATE' ? null : ride.passenger_id, method, provider, providerRef, amount, status, failureReason, `ride:${ride.id}:${method}`, ledgerTxId],
    );
  }
}

export function friendlyFailure(reason?: string): string {
  switch (reason) {
    case 'card_declined':
      return 'Your card was declined. Please try another card.';
    case 'insufficient_funds':
      return 'Your card has insufficient funds.';
    case 'insufficient_balance':
      return 'Your wallet balance is too low.';
    case 'provider_unavailable':
      return 'Card payments are temporarily unavailable. Please try again or pay with cash.';
    default:
      return 'The payment could not be completed. Please try again or use another method.';
  }
}
