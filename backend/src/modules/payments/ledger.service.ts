import { Injectable } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { offsetOf, PageQuery } from '../../common/dto';

export type OwnerType = 'PASSENGER' | 'DRIVER' | 'CORPORATE' | 'PLATFORM_REVENUE' | 'PLATFORM_CASH_CLEARING' | 'PAYMENT_GATEWAY' | 'PROMOTIONS';
export type LedgerKind =
  | 'TOPUP'
  | 'RIDE_PAYMENT'
  | 'RIDE_CASH_COMMISSION'
  | 'DRIVER_EARNING'
  | 'PLATFORM_FEE'
  | 'WITHDRAWAL'
  | 'WITHDRAWAL_SETTLED'
  | 'REFUND'
  | 'PROMO_CREDIT'
  | 'REFERRAL_REWARD'
  | 'CANCELLATION_FEE'
  | 'CORPORATE_CHARGE'
  | 'ADJUSTMENT';

export interface Entry {
  walletId: string;
  amount: number; // signed PKR
  bucket?: 'AVAILABLE' | 'PENDING';
}

export interface Posting {
  kind: LedgerKind;
  idempotencyKey: string;
  description: string;
  referenceType?: string;
  referenceId?: string;
  createdBy?: string | null;
  entries: Entry[];
}

/** Pure check used before hitting the database (the DB trigger enforces it again). */
export function assertBalanced(entries: Entry[]): void {
  const nonZero = entries.filter((e) => e.amount !== 0);
  if (nonZero.length < 2) throw new Error('A ledger transaction needs at least two non-zero entries');
  const sum = nonZero.reduce((s, e) => s + e.amount, 0);
  if (sum !== 0) throw new Error(`Unbalanced ledger transaction (sum ${sum})`);
  if (nonZero.some((e) => !Number.isInteger(e.amount))) throw new Error('Ledger amounts must be integers');
}

/**
 * Double-entry ledger. Balances are always derived from immutable entries; nothing ever does
 * `balance = balance + x`. Postings are idempotent by key.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly db: DatabaseService) {}

  async wallet(ownerType: OwnerType, ownerId: string | null, client?: Queryable): Promise<string> {
    const existing = await this.db.one<{ id: string }>(
      `SELECT id FROM wallets WHERE owner_type = $1 AND owner_id IS NOT DISTINCT FROM $2 AND currency = 'PKR'`,
      [ownerType, ownerId],
      client,
    );
    if (existing) return existing.id;
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO wallets (owner_type, owner_id) VALUES ($1, $2)
       ON CONFLICT (owner_type, owner_id, currency) DO UPDATE SET owner_type = EXCLUDED.owner_type RETURNING id`,
      [ownerType, ownerId],
      client,
    );
    return row!.id;
  }

  /** Posts a balanced transaction. Returns the existing transaction id if the idempotency key was already used. */
  async post(client: Queryable, p: Posting): Promise<{ transactionId: string; replayed: boolean }> {
    const entries = p.entries.filter((e) => e.amount !== 0);
    assertBalanced(entries);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (kind, reference_type, reference_id, idempotency_key, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [p.kind, p.referenceType ?? null, p.referenceId ?? null, p.idempotencyKey, p.description, p.createdBy ?? null],
    );
    if (!inserted.rowCount) {
      const existing = await client.query<{ id: string }>(`SELECT id FROM ledger_transactions WHERE idempotency_key = $1`, [p.idempotencyKey]);
      return { transactionId: existing.rows[0].id, replayed: true };
    }
    const txId = inserted.rows[0].id;
    for (const e of entries) {
      await client.query(`INSERT INTO wallet_transactions (transaction_id, wallet_id, bucket, amount) VALUES ($1,$2,$3,$4)`, [txId, e.walletId, e.bucket ?? 'AVAILABLE', e.amount]);
    }
    return { transactionId: txId, replayed: false };
  }

  async balance(walletId: string, client?: Queryable): Promise<{ available: number; pending: number }> {
    const rows = await this.db.query<{ bucket: string; total: number }>(
      `SELECT bucket, COALESCE(SUM(amount), 0)::bigint AS total FROM wallet_transactions WHERE wallet_id = $1 GROUP BY bucket`,
      [walletId],
      client,
    );
    return {
      available: rows.find((r) => r.bucket === 'AVAILABLE')?.total ?? 0,
      pending: rows.find((r) => r.bucket === 'PENDING')?.total ?? 0,
    };
  }

  /** Lock the wallet row so concurrent debits cannot both pass a balance check. */
  async lockWallet(client: Queryable, walletId: string): Promise<void> {
    await client.query(`SELECT id FROM wallets WHERE id = $1 FOR UPDATE`, [walletId]);
  }

  async entries(walletId: string, q: PageQuery) {
    const [items, total] = await Promise.all([
      this.db.query(
        `SELECT wt.id, lt.id AS "transactionId", lt.kind, lt.description, lt.reference_type AS "referenceType", lt.reference_id AS "referenceId",
                wt.bucket, wt.amount, wt.created_at AS "createdAt"
           FROM wallet_transactions wt JOIN ledger_transactions lt ON lt.id = wt.transaction_id
          WHERE wt.wallet_id = $1 ORDER BY wt.id DESC LIMIT $2 OFFSET $3`,
        [walletId, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM wallet_transactions WHERE wallet_id = $1`, [walletId]),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  async requireWallet(walletId: string) {
    const w = await this.db.one<{ id: string; owner_type: string; owner_id: string | null }>(`SELECT id, owner_type, owner_id FROM wallets WHERE id = $1`, [walletId]);
    if (!w) throw AppError.notFound('Wallet');
    return w;
  }
}
