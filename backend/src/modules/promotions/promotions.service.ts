import { Injectable } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';

export interface PromotionRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  discount_type: 'PERCENT' | 'FLAT';
  discount_value: number;
  max_discount: number | null;
  min_fare: number;
  starts_at: Date;
  ends_at: Date;
  usage_limit_total: number | null;
  usage_limit_per_user: number;
  city_ids: string[];
  product_codes: string[];
  new_users_only: boolean;
  corporate_id: string | null;
  active: boolean;
}

export interface PromoPreview {
  promotionId: string;
  code: string;
  name: string;
  discount: number;
  description: string;
}

export function computeDiscount(p: Pick<PromotionRow, 'discount_type' | 'discount_value' | 'max_discount'>, fare: number): number {
  const raw = p.discount_type === 'PERCENT' ? Math.round((fare * p.discount_value) / 100) : p.discount_value;
  const capped = p.max_discount ? Math.min(raw, p.max_discount) : raw;
  return Math.max(0, Math.min(capped, fare));
}

@Injectable()
export class PromotionsService {
  constructor(private readonly db: DatabaseService) {}

  /** Validates eligibility and returns the discount this promo would give. Does not reserve. */
  async preview(code: string, userId: string, ctx: { cityId: string; productCode: string; fare: number; corporateId?: string | null }, client?: Queryable): Promise<PromoPreview> {
    const p = await this.db.one<PromotionRow>(`SELECT * FROM promotions WHERE upper(code) = upper($1)`, [code.trim()], client);
    const invalid = (msg: string) => AppError.unprocessable('PROMO_NOT_APPLICABLE', msg);
    if (!p || !p.active) throw invalid('This promo code is not valid');
    const now = new Date();
    if (now < p.starts_at || now > p.ends_at) throw invalid('This promo code is not active right now');
    if (p.city_ids.length && !p.city_ids.includes(ctx.cityId)) throw invalid('This promo code is not valid in this city');
    if (p.product_codes.length && !p.product_codes.includes(ctx.productCode)) throw invalid('This promo code does not apply to this ride type');
    if (ctx.fare < p.min_fare) throw invalid(`This promo needs a minimum fare of Rs ${p.min_fare}`);
    if (p.corporate_id && p.corporate_id !== ctx.corporateId) throw invalid('This promo code is only for a business account');
    const usage = await this.db.one<{ total: number; mine: number }>(
      `SELECT count(*) FILTER (WHERE status <> 'RELEASED')::int AS total,
              count(*) FILTER (WHERE status <> 'RELEASED' AND user_id = $2)::int AS mine
         FROM promotion_redemptions WHERE promotion_id = $1`,
      [p.id, userId],
      client,
    );
    if (p.usage_limit_total !== null && (usage?.total ?? 0) >= p.usage_limit_total) throw invalid('This promo code has been fully used');
    if ((usage?.mine ?? 0) >= p.usage_limit_per_user) throw invalid('You have already used this promo code');
    if (p.new_users_only || p.kind === 'FIRST_RIDE') {
      const rides = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM rides WHERE passenger_id = $1 AND status = 'COMPLETED'`, [userId], client);
      if ((rides?.n ?? 0) > 0) throw invalid('This promo is only for your first ride');
    }
    const discount = computeDiscount(p, ctx.fare);
    const description = p.discount_type === 'PERCENT' ? `${p.discount_value}% off${p.max_discount ? ` (up to Rs ${p.max_discount})` : ''}` : `Rs ${p.discount_value} off`;
    return { promotionId: p.id, code: p.code, name: p.name, discount, description };
  }

  /** Reserve inside the ride-creation transaction (prevents over-redemption races via row lock). */
  async reserve(client: Queryable, promotionId: string, userId: string, rideId: string, amount: number): Promise<void> {
    const p = await this.db.one<{ usage_limit_total: number | null; usage_limit_per_user: number }>(
      `SELECT usage_limit_total, usage_limit_per_user FROM promotions WHERE id = $1 FOR UPDATE`,
      [promotionId],
      client,
    );
    // re-check limits UNDER the lock: preview() ran before it, so two concurrent requests could both have passed it
    const usage = await this.db.one<{ total: number; mine: number }>(
      `SELECT count(*) FILTER (WHERE status <> 'RELEASED')::int AS total, count(*) FILTER (WHERE status <> 'RELEASED' AND user_id = $2)::int AS mine
         FROM promotion_redemptions WHERE promotion_id = $1`,
      [promotionId, userId],
      client,
    );
    if (!p || (p.usage_limit_total !== null && (usage?.total ?? 0) >= p.usage_limit_total) || (usage?.mine ?? 0) >= p.usage_limit_per_user) {
      throw AppError.unprocessable('PROMO_NOT_APPLICABLE', 'This promo code has been fully used');
    }
    await client.query(`INSERT INTO promotion_redemptions (promotion_id, user_id, ride_id, amount) VALUES ($1,$2,$3,$4)`, [promotionId, userId, rideId, amount]);
  }

  async markApplied(rideId: string, client?: Queryable) {
    await this.db.query(`UPDATE promotion_redemptions SET status = 'APPLIED' WHERE ride_id = $1 AND status = 'RESERVED'`, [rideId], client);
  }

  async release(rideId: string, client?: Queryable) {
    await this.db.query(`UPDATE promotion_redemptions SET status = 'RELEASED' WHERE ride_id = $1 AND status = 'RESERVED'`, [rideId], client);
  }

  // ------------------------------------------------------------ admin
  list() {
    return this.db.query(
      `SELECT p.*, (SELECT count(*)::int FROM promotion_redemptions r WHERE r.promotion_id = p.id AND r.status <> 'RELEASED') AS redemptions
         FROM promotions p ORDER BY created_at DESC`,
    );
  }
}
