import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config/config';

export interface ChargeRequest {
  amount: number; // PKR
  currency: 'PKR';
  token: string; // provider payment-method token (never a card number)
  idempotencyKey: string;
  description: string;
}

export interface ChargeResult {
  status: 'SUCCEEDED' | 'FAILED';
  providerRef: string | null;
  failureReason?: string;
}

export abstract class PaymentProvider {
  abstract readonly name: string;
  abstract charge(req: ChargeRequest): Promise<ChargeResult>;
  abstract refund(providerRef: string, amount: number, idempotencyKey: string): Promise<ChargeResult>;
  /** Describe a token (brand/last4) for display. */
  abstract describeToken(token: string): Promise<{ brand: string; last4: string; expMonth: number; expYear: number } | null>;
}

/**
 * DEVELOPMENT ONLY. Deterministic provider with test tokens, modelled on common gateway test modes:
 *  tok_visa, tok_mastercard           -> success
 *  tok_declined                       -> card_declined
 *  tok_insufficient_funds             -> insufficient_funds
 * Any other token is rejected. No money moves.
 */
@Injectable()
export class MockPaymentProvider extends PaymentProvider {
  readonly name = 'mock';
  private readonly seen = new Map<string, ChargeResult>();

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const prev = this.seen.get(req.idempotencyKey);
    if (prev) return prev;
    let result: ChargeResult;
    if (req.amount <= 0) result = { status: 'FAILED', providerRef: null, failureReason: 'invalid_amount' };
    else if (req.token === 'tok_visa' || req.token === 'tok_mastercard') result = { status: 'SUCCEEDED', providerRef: `mock_ch_${req.idempotencyKey.slice(0, 24)}` };
    else if (req.token === 'tok_declined') result = { status: 'FAILED', providerRef: null, failureReason: 'card_declined' };
    else if (req.token === 'tok_insufficient_funds') result = { status: 'FAILED', providerRef: null, failureReason: 'insufficient_funds' };
    else result = { status: 'FAILED', providerRef: null, failureReason: 'invalid_token' };
    this.seen.set(req.idempotencyKey, result);
    return result;
  }

  async refund(providerRef: string, _amount: number, idempotencyKey: string): Promise<ChargeResult> {
    return { status: 'SUCCEEDED', providerRef: `mock_re_${idempotencyKey.slice(0, 16)}_${providerRef.slice(-6)}` };
  }

  async describeToken(token: string) {
    const known: Record<string, { brand: string; last4: string }> = {
      tok_visa: { brand: 'visa', last4: '4242' },
      tok_mastercard: { brand: 'mastercard', last4: '4444' },
      tok_declined: { brand: 'visa', last4: '0002' },
      tok_insufficient_funds: { brand: 'visa', last4: '9995' },
    };
    const k = known[token];
    return k ? { ...k, expMonth: 12, expYear: new Date().getFullYear() + 3 } : null;
  }
}

/**
 * Stripe PaymentIntents integration (card payments). Requires STRIPE_SECRET_KEY. PKR support and local
 * acquiring must be confirmed with Stripe for Pakistan; local gateways (JazzCash / Easypaisa / 1LINK)
 * would implement this same interface. NOT exercised by automated tests (no credentials available).
 */
@Injectable()
export class StripePaymentProvider extends PaymentProvider {
  readonly name = 'stripe';
  private readonly logger = new Logger(StripePaymentProvider.name);

  private async stripe(path: string, form: Record<string, string>, idempotencyKey: string) {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config().STRIPE_SECRET_KEY}`,
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': idempotencyKey,
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!config().STRIPE_SECRET_KEY) return { status: 'FAILED', providerRef: null, failureReason: 'provider_not_configured' };
    try {
      const { ok, body } = await this.stripe(
        'payment_intents',
        { amount: String(req.amount * 100), currency: req.currency.toLowerCase(), payment_method: req.token, confirm: 'true', off_session: 'true', description: req.description },
        req.idempotencyKey,
      );
      if (ok && body.status === 'succeeded') return { status: 'SUCCEEDED', providerRef: body.id };
      return { status: 'FAILED', providerRef: body.id ?? null, failureReason: body.error?.code ?? body.status ?? 'payment_failed' };
    } catch (err) {
      this.logger.error(`Stripe charge failed: ${(err as Error).message}`);
      return { status: 'FAILED', providerRef: null, failureReason: 'provider_unavailable' };
    }
  }

  async refund(providerRef: string, amount: number, idempotencyKey: string): Promise<ChargeResult> {
    const { ok, body } = await this.stripe('refunds', { payment_intent: providerRef, amount: String(amount * 100) }, idempotencyKey);
    return ok ? { status: 'SUCCEEDED', providerRef: body.id } : { status: 'FAILED', providerRef: null, failureReason: body.error?.code ?? 'refund_failed' };
  }

  async describeToken(): Promise<null> {
    return null; // brand/last4 come from the client SDK response in a real integration
  }
}
