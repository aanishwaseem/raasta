import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';

export interface PolicyCheck {
  corporateId: string;
  userId: string;
  productCode: string;
  fare: number;
  at: Date;
  tripPurpose?: string | null;
}

/** Evaluates a corporate ride against the company's policy and budgets. Pure rule evaluation + spend queries. */
@Injectable()
export class CorporatePolicyService {
  constructor(private readonly db: DatabaseService) {}

  async assertAllowed(c: PolicyCheck): Promise<void> {
    const row = await this.db.one<{
      status: string;
      monthly_budget: number;
      member_active: boolean | null;
      monthly_limit: number | null;
      allowed_products: string[] | null;
      max_fare_per_ride: number | null;
      allowed_weekdays: number[] | null;
      allowed_start: string | null;
      allowed_end: string | null;
      require_purpose: boolean | null;
    }>(
      `SELECT ca.status, ca.monthly_budget, cu.active AS member_active, cu.monthly_limit,
              p.allowed_products, p.max_fare_per_ride, p.allowed_weekdays, p.allowed_start::text, p.allowed_end::text, p.require_purpose
         FROM corporate_accounts ca
         LEFT JOIN corporate_users cu ON cu.corporate_id = ca.id AND cu.user_id = $2
         LEFT JOIN corporate_policies p ON p.corporate_id = ca.id
        WHERE ca.id = $1`,
      [c.corporateId, c.userId],
    );
    const deny = (message: string, rule: string) => AppError.unprocessable('POLICY_VIOLATION', message, { rule });
    if (!row || !row.member_active) throw deny('You are not an active member of this business account', 'MEMBERSHIP');
    if (row.status !== 'ACTIVE') throw deny('This business account is suspended', 'ACCOUNT_STATUS');
    const violations = evaluatePolicy(
      {
        allowedProducts: row.allowed_products ?? [],
        maxFarePerRide: row.max_fare_per_ride ?? 0,
        allowedWeekdays: row.allowed_weekdays ?? [1, 2, 3, 4, 5, 6, 7],
        allowedStart: row.allowed_start ?? '00:00',
        allowedEnd: row.allowed_end ?? '23:59',
        requirePurpose: row.require_purpose ?? false,
      },
      c,
    );
    if (violations.length) throw deny(violations[0].message, violations[0].rule);

    const spend = await this.db.one<{ company: number; mine: number }>(
      `SELECT COALESCE(SUM(COALESCE(final_fare, offered_fare - discount_amount)),0)::int AS company,
              COALESCE(SUM(COALESCE(final_fare, offered_fare - discount_amount)) FILTER (WHERE passenger_id = $2),0)::int AS mine
         FROM rides WHERE corporate_id = $1 AND status NOT IN ('CANCELLED','NO_DRIVERS')
          AND requested_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi'`,
      [c.corporateId, c.userId],
    );
    if (row.monthly_budget > 0 && (spend?.company ?? 0) + c.fare > row.monthly_budget) throw deny("Your company's monthly ride budget has been reached", 'COMPANY_BUDGET');
    if ((row.monthly_limit ?? 0) > 0 && (spend?.mine ?? 0) + c.fare > row.monthly_limit!) throw deny('Your monthly business ride limit has been reached', 'EMPLOYEE_LIMIT');
  }
}

export interface Policy {
  allowedProducts: string[];
  maxFarePerRide: number;
  allowedWeekdays: number[];
  allowedStart: string; // HH:MM[:SS]
  allowedEnd: string;
  requirePurpose: boolean;
}

/** Pure policy evaluation (unit-tested). Times are Pakistan local time. */
export function evaluatePolicy(p: Policy, c: Pick<PolicyCheck, 'productCode' | 'fare' | 'at' | 'tripPurpose'>): { rule: string; message: string }[] {
  const out: { rule: string; message: string }[] = [];
  if (p.allowedProducts.length && !p.allowedProducts.includes(c.productCode)) {
    out.push({ rule: 'PRODUCT', message: `Your company allows only ${p.allowedProducts.join(', ')} rides` });
  }
  if (p.maxFarePerRide > 0 && c.fare > p.maxFarePerRide) out.push({ rule: 'MAX_FARE', message: `Business rides are limited to Rs ${p.maxFarePerRide}` });
  const local = new Date(c.at.getTime() + 5 * 3600 * 1000);
  const weekday = ((local.getUTCDay() + 6) % 7) + 1;
  if (!p.allowedWeekdays.includes(weekday)) out.push({ rule: 'WEEKDAY', message: 'Business rides are not allowed on this day' });
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const start = toMin(p.allowedStart);
  const end = toMin(p.allowedEnd);
  const inWindow = start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end;
  if (!inWindow) out.push({ rule: 'HOURS', message: `Business rides are allowed between ${p.allowedStart.slice(0, 5)} and ${p.allowedEnd.slice(0, 5)}` });
  if (p.requirePurpose && !c.tripPurpose?.trim()) out.push({ rule: 'PURPOSE', message: 'Please add a trip purpose for business rides' });
  return out;
}
