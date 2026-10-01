import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../common/audit/audit.service';
import { offsetOf, PageQuery } from '../../common/dto';
import { normalizePkPhone } from '../../common/crypto/crypto';
import type { AuthUser } from '../../common/auth/auth.types';
import { NotificationsService } from '../notifications/notifications.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { AddEmployeeDto, BudgetDto, CorporateScheduleDto, PolicyDto, UpdateEmployeeDto } from './dto/corporate.dto';

const MONTH_START = `date_trunc('month', now() AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi'`;
const FARE = `COALESCE(r.final_fare, r.offered_fare - r.discount_amount)`;

@Injectable()
export class CorporateService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly scheduling: SchedulingService,
  ) {}

  /** The company the caller administers. A user administering several must pass corporateId. */
  async accountFor(user: AuthUser, corporateId?: string): Promise<string> {
    const rows = await this.db.query<{ corporate_id: string }>(
      `SELECT cu.corporate_id FROM corporate_users cu JOIN corporate_accounts ca ON ca.id = cu.corporate_id
        WHERE cu.user_id = $1 AND cu.role = 'ADMIN' AND cu.active AND ($2::uuid IS NULL OR cu.corporate_id = $2)`,
      [user.id, corporateId ?? null],
    );
    if (!rows.length) throw AppError.forbidden('You are not an administrator of a business account');
    if (rows.length > 1) throw new AppError('VALIDATION_FAILED', 'You administer several business accounts. Pass corporateId.');
    return rows[0].corporate_id;
  }

  async overview(user: AuthUser, corporateId?: string) {
    const id = await this.accountFor(user, corporateId);
    const [acct, spend, top, purposes, pending] = await Promise.all([
      this.db.one<{ name: string; monthly_budget: number; status: string; industry: string }>(`SELECT name, monthly_budget, status, industry FROM corporate_accounts WHERE id = $1`, [id]),
      this.db.one<{ rides: number; spend: number }>(
        `SELECT count(*) FILTER (WHERE status = 'COMPLETED')::int AS rides, COALESCE(sum(${FARE}) FILTER (WHERE status = 'COMPLETED'),0)::int AS spend FROM rides r WHERE corporate_id = $1 AND requested_at >= ${MONTH_START}`, [id]),
      this.db.query(
        `SELECT u.id AS "userId", u.full_name AS name, count(*)::int AS rides, sum(${FARE})::int AS spend FROM rides r JOIN users u ON u.id = r.passenger_id
          WHERE r.corporate_id = $1 AND r.status = 'COMPLETED' AND r.requested_at >= ${MONTH_START} GROUP BY u.id ORDER BY spend DESC LIMIT 5`, [id]),
      this.db.query(
        `SELECT COALESCE(NULLIF(trip_purpose,''),'Unspecified') AS purpose, count(*)::int AS rides, sum(${FARE})::int AS spend FROM rides r
          WHERE corporate_id = $1 AND status = 'COMPLETED' AND requested_at >= ${MONTH_START} GROUP BY 1 ORDER BY spend DESC LIMIT 6`, [id]),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM scheduled_rides WHERE corporate_id = $1 AND status = 'PENDING'`, [id]),
    ]);
    const used = spend?.spend ?? 0;
    return {
      corporateId: id, name: acct!.name, status: acct!.status, industry: acct!.industry,
      month: { rides: spend?.rides ?? 0, spend: used, budget: acct!.monthly_budget, budgetUsedPct: acct!.monthly_budget > 0 ? Math.round((used / acct!.monthly_budget) * 100) : null },
      topEmployees: top, byPurpose: purposes, scheduledPending: pending?.n ?? 0, currency: 'PKR',
    };
  }

  async employees(user: AuthUser, corporateId?: string) {
    const id = await this.accountFor(user, corporateId);
    return this.db.query(
      `SELECT u.id AS "userId", u.full_name AS name, u.email, u.phone, cu.role, cu.monthly_limit AS "monthlyLimit", cu.employee_code AS "employeeCode", cu.active,
              COALESCE(sum(${FARE}) FILTER (WHERE r.status = 'COMPLETED' AND r.requested_at >= ${MONTH_START}),0)::int AS "spentThisMonth"
         FROM corporate_users cu JOIN users u ON u.id = cu.user_id LEFT JOIN rides r ON r.passenger_id = u.id AND r.corporate_id = cu.corporate_id
        WHERE cu.corporate_id = $1 GROUP BY u.id, cu.role, cu.monthly_limit, cu.employee_code, cu.active ORDER BY u.full_name`,
      [id],
    );
  }

  async addEmployee(user: AuthUser, dto: AddEmployeeDto, corporateId?: string, meta?: Parameters<AuditService['log']>[0]['meta']) {
    const id = await this.accountFor(user, corporateId);
    if (!dto.email && !dto.phone) throw new AppError('VALIDATION_FAILED', 'Provide the employee email or phone number');
    const u = await this.db.one<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM users WHERE status = 'ACTIVE' AND (($1::text IS NOT NULL AND lower(email) = lower($1)) OR ($2::text IS NOT NULL AND phone = $2))`,
      [dto.email ?? null, dto.phone ? normalizePkPhone(dto.phone) : null],
    );
    if (!u) throw AppError.notFound('User', 'EMPLOYEE_NOT_REGISTERED');
    await this.db.query(
      `INSERT INTO corporate_users (corporate_id, user_id, role, monthly_limit, employee_code) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (corporate_id, user_id) DO UPDATE SET active = true, role = EXCLUDED.role, monthly_limit = EXCLUDED.monthly_limit, employee_code = EXCLUDED.employee_code`,
      [id, u.id, dto.role ?? 'EMPLOYEE', dto.monthlyLimit ?? 0, dto.employeeCode ?? null],
    );
    if ((dto.role ?? 'EMPLOYEE') === 'ADMIN') await this.db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'CORPORATE_ADMIN') ON CONFLICT DO NOTHING`, [u.id]);
    await this.audit.log({ actor: user, action: 'corporate.employee.add', entityType: 'corporate_account', entityId: id, after: { userId: u.id, role: dto.role ?? 'EMPLOYEE' }, meta });
    await this.notifications.notify({ userId: u.id, type: 'CORPORATE_ADDED', title: 'Business rides enabled', body: 'You can now choose your company account when booking a ride.', data: { corporateId: id } });
    return { userId: u.id, name: u.full_name };
  }

  async updateEmployee(user: AuthUser, employeeId: string, dto: UpdateEmployeeDto, corporateId?: string, meta?: Parameters<AuditService['log']>[0]['meta']) {
    const id = await this.accountFor(user, corporateId);
    if (employeeId === user.id && (dto.active === false || dto.role === 'EMPLOYEE')) throw AppError.conflict('CANNOT_DEMOTE_SELF', 'You cannot remove your own administrator access');
    const r = await this.db.one(
      `UPDATE corporate_users SET monthly_limit = COALESCE($3, monthly_limit), active = COALESCE($4, active), role = COALESCE($5, role) WHERE corporate_id = $1 AND user_id = $2 RETURNING user_id`,
      [id, employeeId, dto.monthlyLimit ?? null, dto.active ?? null, dto.role ?? null],
    );
    if (!r) throw AppError.notFound('Employee', 'EMPLOYEE_NOT_FOUND');
    await this.audit.log({ actor: user, action: 'corporate.employee.update', entityType: 'corporate_account', entityId: id, after: { employeeId, ...dto }, meta });
    return { userId: employeeId, ...dto };
  }

  async policy(user: AuthUser, corporateId?: string) {
    const id = await this.accountFor(user, corporateId);
    const p = await this.db.one<{ allowed_products: string[]; max_fare_per_ride: number; allowed_weekdays: number[]; allowed_start: string; allowed_end: string; require_purpose: boolean }>(
      `SELECT allowed_products, max_fare_per_ride, allowed_weekdays, to_char(allowed_start,'HH24:MI') AS allowed_start, to_char(allowed_end,'HH24:MI') AS allowed_end, require_purpose FROM corporate_policies WHERE corporate_id = $1`, [id]);
    return p ? { allowedProducts: p.allowed_products, maxFarePerRide: p.max_fare_per_ride, allowedWeekdays: p.allowed_weekdays, allowedStart: p.allowed_start, allowedEnd: p.allowed_end, requirePurpose: p.require_purpose } : null;
  }

  async setPolicy(user: AuthUser, dto: PolicyDto, corporateId?: string, meta?: Parameters<AuditService['log']>[0]['meta']) {
    const id = await this.accountFor(user, corporateId);
    const before = await this.policy(user, id);
    await this.db.query(
      `INSERT INTO corporate_policies (corporate_id, allowed_products, max_fare_per_ride, allowed_weekdays, allowed_start, allowed_end, require_purpose, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (corporate_id) DO UPDATE SET allowed_products = EXCLUDED.allowed_products, max_fare_per_ride = EXCLUDED.max_fare_per_ride, allowed_weekdays = EXCLUDED.allowed_weekdays,
         allowed_start = EXCLUDED.allowed_start, allowed_end = EXCLUDED.allowed_end, require_purpose = EXCLUDED.require_purpose, updated_at = now()`,
      [id, dto.allowedProducts, dto.maxFarePerRide, [...new Set(dto.allowedWeekdays)].sort(), dto.allowedStart, dto.allowedEnd, dto.requirePurpose],
    );
    await this.audit.log({ actor: user, action: 'corporate.policy.update', entityType: 'corporate_account', entityId: id, before, after: dto, meta });
    return this.policy(user, id);
  }

  async setBudget(user: AuthUser, dto: BudgetDto, corporateId?: string, meta?: Parameters<AuditService['log']>[0]['meta']) {
    const id = await this.accountFor(user, corporateId);
    const before = await this.db.one(`SELECT monthly_budget FROM corporate_accounts WHERE id = $1`, [id]);
    await this.db.query(`UPDATE corporate_accounts SET monthly_budget = $2 WHERE id = $1`, [id, dto.monthlyBudget]);
    await this.audit.log({ actor: user, action: 'corporate.budget.update', entityType: 'corporate_account', entityId: id, before, after: dto, meta });
    return { monthlyBudget: dto.monthlyBudget };
  }

  async rides(user: AuthUser, q: PageQuery, corporateId?: string) {
    const id = await this.accountFor(user, corporateId);
    const [items, total] = await Promise.all([
      this.db.query(
        `SELECT r.id, u.full_name AS employee, r.status, r.product_code AS "productCode", r.pickup_address AS "pickupAddress", r.dropoff_address AS "dropoffAddress", r.trip_purpose AS purpose,
                ${FARE} AS fare, r.requested_at AS "requestedAt", r.completed_at AS "completedAt"
           FROM rides r JOIN users u ON u.id = r.passenger_id WHERE r.corporate_id = $1 ORDER BY r.requested_at DESC LIMIT $2 OFFSET $3`,
        [id, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM rides WHERE corporate_id = $1`, [id]),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  /** Itemised statement for a calendar month (Pakistan time). Amounts are the charged fares; no tax is calculated here. */
  async invoice(user: AuthUser, month: string, corporateId?: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AppError('VALIDATION_FAILED', 'month must be YYYY-MM');
    const id = await this.accountFor(user, corporateId);
    const start = `${month}-01T00:00:00+05:00`;
    const lines = await this.db.query<{ rideId: string; date: Date; employee: string; purpose: string | null; pickup: string; dropoff: string; fare: number; cancellationFee: number }>(
      `SELECT r.id AS "rideId", COALESCE(r.completed_at, r.cancelled_at) AS date, u.full_name AS employee, r.trip_purpose AS purpose, r.pickup_address AS pickup, r.dropoff_address AS dropoff,
              CASE WHEN r.status = 'COMPLETED' THEN ${FARE} ELSE 0 END AS fare, r.cancellation_fee AS "cancellationFee"
         FROM rides r JOIN users u ON u.id = r.passenger_id
        WHERE r.corporate_id = $1 AND (r.status = 'COMPLETED' OR (r.status = 'CANCELLED' AND r.cancellation_fee > 0))
          AND COALESCE(r.completed_at, r.cancelled_at) >= $2::timestamptz AND COALESCE(r.completed_at, r.cancelled_at) < ($2::timestamptz + interval '1 month') ORDER BY 2`,
      [id, start],
    );
    const acct = await this.db.one<{ name: string; billing_email: string }>(`SELECT name, billing_email FROM corporate_accounts WHERE id = $1`, [id]);
    const total = lines.reduce((s, l) => s + l.fare + l.cancellationFee, 0);
    const byEmployee = new Map<string, number>();
    for (const l of lines) byEmployee.set(l.employee, (byEmployee.get(l.employee) ?? 0) + l.fare + l.cancellationFee);
    return {
      invoiceNumber: `RAASTA-${month.replace('-', '')}-${id.slice(0, 6).toUpperCase()}`, month, company: acct!.name, billingEmail: acct!.billing_email, currency: 'PKR',
      lines, totals: { rides: lines.length, amount: total, byEmployee: [...byEmployee.entries()].map(([employee, amount]) => ({ employee, amount })) },
      notes: ['Amounts are the fares charged to the company account. Taxes are not calculated by this statement.'],
    };
  }

  /** Office commute: an administrator schedules a company-paid ride for an employee, who is notified. */
  async scheduleForEmployee(user: AuthUser, dto: CorporateScheduleDto, corporateId?: string) {
    const id = await this.accountFor(user, corporateId);
    const member = await this.db.one(`SELECT 1 FROM corporate_users WHERE corporate_id = $1 AND user_id = $2 AND active`, [id, dto.employeeId]);
    if (!member) throw AppError.notFound('Employee', 'EMPLOYEE_NOT_FOUND');
    const employee: AuthUser = { id: dto.employeeId, roles: ['PASSENGER'], sid: 'corporate' };
    const scheduled = await this.scheduling.create(employee, { pickup: dto.pickup, dropoff: dto.dropoff, productCode: dto.productCode, paymentMethod: 'CORPORATE', pickupAt: dto.pickupAt, corporateId: id, tripPurpose: dto.tripPurpose }, 'CORPORATE');
    await this.notifications.notify({ userId: dto.employeeId, type: 'CORPORATE_SCHEDULED', title: 'A company ride was scheduled for you', body: `Pickup ${dto.pickup.address.split(',')[0]} at ${new Date(dto.pickupAt).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}. You can cancel it in Scheduled rides.`, data: { corporateId: id } });
    return scheduled;
  }
}
