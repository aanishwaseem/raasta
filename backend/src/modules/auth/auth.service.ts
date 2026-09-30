import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import type { PoolClient } from 'pg';
import { config } from '../../config/config';
import { DatabaseService } from '../../common/db/database.service';
import { RedisService } from '../../common/redis/redis.service';
import { EventBus } from '../../common/events/event-bus';
import { AuditService } from '../../common/audit/audit.service';
import { SmsProvider } from '../../common/providers/messaging';
import { AppError } from '../../common/errors/app-error';
import { hmac, normalizePkPhone, randomDigits, randomToken, safeEqualHex, sha256 } from '../../common/crypto/crypto';
import { signAccessToken } from '../../common/auth/jwt';
import { revokedSessionKey } from '../../common/auth/guards';
import type { Role } from '../../common/auth/auth.types';
import type { RequestMeta } from '../../common/auth/decorators';
import { PublicUser, UsersRepository } from '../users/users.repository';
import { DeviceDto, LoginDto, OAuthDto, OtpRequestDto, OtpVerifyDto, RegisterDto } from './dto/auth.dto';

export interface AuthResult {
  user: PublicUser;
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
  isNewUser: boolean;
}

const OTP_TTL_S = 300;
const OTP_MAX_ATTEMPTS = 5;
const REFRESH_REUSE_GRACE_MS = 10_000;

const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly dummyHash = argon2.hash('timing-equaliser', { type: argon2.argon2id, memoryCost: 19456, timeCost: 2 });

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly users: UsersRepository,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly sms: SmsProvider,
  ) {}

  // ------------------------------------------------------------------ registration & login
  async register(dto: RegisterDto, meta: RequestMeta): Promise<AuthResult> {
    const email = dto.email?.trim().toLowerCase() || null;
    const phone = dto.phone ? normalizePkPhone(dto.phone) : null;
    if (dto.phone && !phone) throw new AppError('INVALID_PHONE', 'Please enter a valid Pakistani mobile number');
    if (!email && !phone) throw new AppError('VALIDATION_FAILED', 'Email or phone number is required');
    if (email && (await this.users.findByEmail(email))) throw AppError.conflict('EMAIL_TAKEN', 'An account with this email already exists');
    if (phone && (await this.users.findByPhone(phone))) throw AppError.conflict('PHONE_TAKEN', 'An account with this phone number already exists');

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2 });
    const userId = await this.db.tx(async (c) => {
      const id = await this.createUser(c, { fullName: dto.fullName, email, phone, passwordHash, role: dto.role, referralCode: dto.referralCode });
      await c.query(`INSERT INTO consents (user_id, kind, granted) VALUES ($1, 'TERMS', true)`, [id]);
      return id;
    });
    this.events.emit('user.registered', { userId, deviceId: dto.device.deviceId });
    return this.completeLogin(userId, dto.device, meta, true);
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<AuthResult> {
    const identifier = dto.identifier.trim();
    const phone = normalizePkPhone(identifier);
    const user = identifier.includes('@') ? await this.users.findByEmail(identifier) : phone ? await this.users.findByPhone(phone) : null;
    // Always run a hash verification to keep timing uniform for unknown accounts.
    const hash = user?.password_hash ?? (await this.dummyHash);
    const ok = await argon2.verify(hash, dto.password).catch(() => false);
    if (!user || !ok) throw AppError.unauthenticated('Incorrect email/phone or password', 'INVALID_CREDENTIALS');
    this.assertActive(user.status);
    return this.completeLogin(user.id, dto.device, meta, false);
  }

  // ------------------------------------------------------------------ OTP
  async requestOtp(dto: OtpRequestDto): Promise<{ sent: true; expiresIn: number; devCode?: string }> {
    const phone = normalizePkPhone(dto.phone);
    if (!phone) throw new AppError('INVALID_PHONE', 'Please enter a valid Pakistani mobile number');
    const code = randomDigits(6);
    await this.db.query(
      `INSERT INTO otp_codes (phone, purpose, code_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [phone, dto.purpose, hmac(config().OTP_HMAC_SECRET, `${phone}:${code}`), OTP_TTL_S],
    );
    await this.sms.send(phone, `Your Raasta code is ${code}. It expires in 5 minutes. Never share it with anyone.`);
    return { sent: true, expiresIn: OTP_TTL_S, ...(config().OTP_DEV_ECHO ? { devCode: code } : {}) };
  }

  async verifyOtp(dto: OtpVerifyDto, meta: RequestMeta): Promise<AuthResult> {
    const phone = normalizePkPhone(dto.phone);
    if (!phone) throw new AppError('INVALID_PHONE', 'Please enter a valid Pakistani mobile number');
    const otp = await this.db.one<{ id: string; code_hash: string; attempts: number }>(
      `SELECT id, code_hash, attempts FROM otp_codes
        WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    if (!otp) throw new AppError('OTP_EXPIRED', 'This code has expired. Please request a new one.', 400);
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new AppError('OTP_LOCKED', 'Too many incorrect attempts. Please request a new code.', 429);
    const candidate = hmac(config().OTP_HMAC_SECRET, `${phone}:${dto.code}`);
    if (!safeEqualHex(candidate, otp.code_hash)) {
      await this.db.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
      throw new AppError('OTP_INVALID', 'That code is not correct', 400, { attemptsLeft: OTP_MAX_ATTEMPTS - otp.attempts - 1 });
    }

    let user = await this.users.findByPhone(phone);
    let isNew = false;
    if (!user) {
      if (!dto.fullName) {
        // do not consume: the client will resend with the name
        throw new AppError('NAME_REQUIRED', 'Please tell us your name to create your account', 400, { isNewUser: true });
      }
      const id = await this.db.tx(async (c) => {
        const uid = await this.createUser(c, { fullName: dto.fullName!, email: null, phone, passwordHash: null, role: dto.role ?? 'PASSENGER' });
        await c.query(`INSERT INTO consents (user_id, kind, granted) VALUES ($1, 'TERMS', true)`, [uid]);
        return uid;
      });
      this.events.emit('user.registered', { userId: id, deviceId: dto.device.deviceId });
      user = await this.users.findById(id);
      isNew = true;
    }
    this.assertActive(user!.status);
    await this.db.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [otp.id]);
    await this.db.query(`UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, now()) WHERE id = $1`, [user!.id]);
    return this.completeLogin(user!.id, dto.device, meta, isNew);
  }

  // ------------------------------------------------------------------ OAuth (Google / Apple ID tokens)
  async oauth(dto: OAuthDto, meta: RequestMeta): Promise<AuthResult> {
    const claims = await this.verifyIdToken(dto.provider, dto.idToken);
    const subject = String(claims.sub);
    const email = typeof claims.email === 'string' && claims.email_verified !== false ? claims.email.toLowerCase() : null;
    const linked = await this.db.one<{ user_id: string }>(`SELECT user_id FROM oauth_identities WHERE provider=$1 AND subject=$2`, [dto.provider, subject]);
    let userId = linked?.user_id;
    let isNew = false;
    if (!userId) {
      const existing = email ? await this.users.findByEmail(email) : null;
      if (existing) {
        userId = existing.id;
      } else {
        if (!email) throw new AppError('EMAIL_REQUIRED', 'Your account provider did not share a verified email address');
        const name = dto.fullName ?? (typeof claims.name === 'string' ? claims.name : email.split('@')[0]);
        userId = await this.db.tx((c) => this.createUser(c, { fullName: name, email, phone: null, passwordHash: null, role: dto.role ?? 'PASSENGER' }));
        isNew = true;
        this.events.emit('user.registered', { userId, deviceId: dto.device.deviceId });
      }
      await this.db.query(`INSERT INTO oauth_identities (user_id, provider, subject) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [userId, dto.provider, subject]);
      if (email) await this.db.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id=$1`, [userId]);
    }
    const u = await this.users.findById(userId);
    this.assertActive(u!.status);
    return this.completeLogin(userId, dto.device, meta, isNew);
  }

  private async verifyIdToken(provider: 'GOOGLE' | 'APPLE', token: string): Promise<JWTPayload> {
    const audiences = (provider === 'GOOGLE' ? config().GOOGLE_CLIENT_IDS : config().APPLE_CLIENT_IDS).split(',').map((s) => s.trim()).filter(Boolean);
    if (!audiences.length) throw new AppError('PROVIDER_NOT_CONFIGURED', `${provider === 'GOOGLE' ? 'Google' : 'Apple'} sign-in is not available yet`, 501);
    try {
      const { payload } = await jwtVerify(token, provider === 'GOOGLE' ? googleJwks : appleJwks, {
        issuer: provider === 'GOOGLE' ? ['https://accounts.google.com', 'accounts.google.com'] : 'https://appleid.apple.com',
        audience: audiences,
      });
      return payload;
    } catch {
      throw AppError.unauthenticated('Sign-in with this provider failed', 'INVALID_ID_TOKEN');
    }
  }

  // ------------------------------------------------------------------ tokens
  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthResult> {
    const hash = sha256(refreshToken);
    const s = await this.db.one<{ id: string; user_id: string; family_id: string; expires_at: Date; rotated_at: Date | null; revoked_at: Date | null; device_id: string | null; device_name: string | null; platform: string | null }>(
      `SELECT id, user_id, family_id, expires_at, rotated_at, revoked_at, device_id, device_name, platform FROM auth_sessions WHERE refresh_token_hash = $1`,
      [hash],
    );
    if (!s) throw AppError.unauthenticated('Please sign in again', 'INVALID_REFRESH_TOKEN');
    if (s.rotated_at) {
      if (Date.now() - s.rotated_at.getTime() < REFRESH_REUSE_GRACE_MS) {
        // A concurrent retry of the same refresh (flaky network). Do not treat as theft.
        throw AppError.conflict('REFRESH_IN_PROGRESS', 'Your session is being refreshed. Please retry with the newest token.');
      }
      await this.revokeFamily(s.family_id, 'REFRESH_TOKEN_REUSE');
      await this.audit.log({ action: 'security.refresh_token_reuse', entityType: 'user', entityId: s.user_id, meta });
      this.logger.warn(`Refresh token reuse detected for user ${s.user_id}; session family revoked`);
      throw AppError.unauthenticated('For your security, please sign in again', 'REFRESH_TOKEN_REUSED');
    }
    if (s.revoked_at || s.expires_at.getTime() < Date.now()) throw AppError.unauthenticated('Please sign in again', 'INVALID_REFRESH_TOKEN');
    const user = await this.users.findById(s.user_id);
    if (!user) throw AppError.unauthenticated();
    this.assertActive(user.status);

    const rotated = await this.db.one<{ id: string }>(
      `UPDATE auth_sessions SET rotated_at = now(), revoked_at = now(), revoked_reason = 'ROTATED'
        WHERE id = $1 AND rotated_at IS NULL RETURNING id`,
      [s.id],
    );
    if (!rotated) throw AppError.conflict('REFRESH_IN_PROGRESS', 'Your session is being refreshed. Please retry with the newest token.');
    const device: DeviceDto = { deviceId: s.device_id ?? 'unknown', deviceName: s.device_name ?? undefined, platform: s.platform ?? undefined };
    return this.completeLogin(user.id, device, meta, false, s.family_id);
  }

  async logout(sid: string): Promise<void> {
    await this.db.query(`UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'LOGOUT' WHERE id = $1 AND revoked_at IS NULL`, [sid]);
    await this.redis.client.set(revokedSessionKey(sid), '1', 'EX', config().JWT_ACCESS_TTL_SECONDS);
  }

  async listSessions(userId: string, currentSid: string) {
    const rows = await this.db.query<{ id: string; device_name: string | null; platform: string | null; ip: string | null; created_at: Date; last_used_at: Date }>(
      `SELECT id, device_name, platform, host(ip) AS ip, created_at, last_used_at FROM auth_sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_used_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      deviceName: r.device_name,
      platform: r.platform,
      ip: r.ip,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      current: r.id === currentSid,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const row = await this.db.one(`UPDATE auth_sessions SET revoked_at = now(), revoked_reason='USER_REVOKED' WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`, [sessionId, userId]);
    if (!row) throw AppError.notFound('Session');
    await this.redis.client.set(revokedSessionKey(sessionId), '1', 'EX', config().JWT_ACCESS_TTL_SECONDS);
  }

  /** Revoke every session of a user (suspension, deletion, password change). */
  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`,
      [userId, reason],
    );
    // also block sessions rotated within the access-token lifetime
    const recent = await this.db.query<{ id: string }>(
      `SELECT id FROM auth_sessions WHERE user_id = $1 AND revoked_at > now() - make_interval(secs => $2)`,
      [userId, config().JWT_ACCESS_TTL_SECONDS],
    );
    const pipeline = this.redis.client.pipeline();
    for (const r of [...rows, ...recent]) pipeline.set(revokedSessionKey(r.id), '1', 'EX', config().JWT_ACCESS_TTL_SECONDS);
    await pipeline.exec();
  }

  /**
   * Account deletion: PII is removed immediately; ride and financial records are retained with the
   * user reference anonymized (accounting / legal). Refused while a ride is live.
   */
  async deleteAccount(userId: string, meta: RequestMeta): Promise<void> {
    const live = await this.db.one(
      `SELECT 1 FROM rides WHERE (passenger_id = $1 OR driver_id = $1)
         AND status IN ('MATCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS')`,
      [userId],
    );
    if (live) throw AppError.conflict('ACTIVE_RIDE_EXISTS', 'Please finish or cancel your current ride first');
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE users SET full_name = 'Deleted user', email = NULL, phone = NULL, password_hash = NULL, avatar_key = NULL,
                gender = NULL, referral_code = NULL, status = 'DELETED', deleted_at = now(), personalization_enabled = false
          WHERE id = $1`,
        [userId],
      );
      await c.query(`DELETE FROM saved_places WHERE user_id = $1`, [userId]);
      await c.query(`DELETE FROM emergency_contacts WHERE user_id = $1`, [userId]);
      await c.query(`DELETE FROM oauth_identities WHERE user_id = $1`, [userId]);
      await c.query(`DELETE FROM mobility_profiles WHERE user_id = $1`, [userId]);
      await c.query(`DELETE FROM payment_methods WHERE user_id = $1`, [userId]);
      await c.query(`UPDATE recurring_rides SET active = false WHERE passenger_id = $1`, [userId]);
      await c.query(`UPDATE scheduled_rides SET status = 'CANCELLED' WHERE passenger_id = $1 AND status = 'PENDING'`, [userId]);
      await c.query(`UPDATE drivers SET cnic_encrypted = NULL, license_number_encrypted = NULL, status = 'SUSPENDED' WHERE user_id = $1`, [userId]);
      await this.audit.log({ actor: null, action: 'user.account_deleted', entityType: 'user', entityId: userId, meta }, c);
    });
    await this.revokeAllForUser(userId, 'ACCOUNT_DELETED');
  }

  private async revokeFamily(familyId: string, reason: string) {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, $2) WHERE family_id = $1 RETURNING id`,
      [familyId, reason],
    );
    const pipeline = this.redis.client.pipeline();
    for (const r of rows) pipeline.set(revokedSessionKey(r.id), '1', 'EX', config().JWT_ACCESS_TTL_SECONDS);
    await pipeline.exec();
  }

  private async completeLogin(userId: string, device: DeviceDto, meta: RequestMeta, isNew: boolean, familyId?: string): Promise<AuthResult> {
    const roles = await this.users.roles(userId);
    const refreshToken = randomToken(32);
    const session = await this.db.one<{ id: string }>(
      `INSERT INTO auth_sessions (user_id, family_id, refresh_token_hash, device_id, device_name, platform, ip, user_agent, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(days => $9)) RETURNING id`,
      [userId, familyId ?? randomUUID(), sha256(refreshToken), device.deviceId, device.deviceName ?? null, device.platform ?? null, meta.ip, meta.userAgent?.slice(0, 300) ?? null, config().REFRESH_TTL_DAYS],
    );
    const accessToken = await signAccessToken({ id: userId, roles, sid: session!.id });
    const user = await this.users.publicById(userId);
    return { user: user!, tokens: { accessToken, refreshToken, expiresIn: config().JWT_ACCESS_TTL_SECONDS }, isNewUser: isNew };
  }

  private async createUser(
    c: PoolClient,
    u: { fullName: string; email: string | null; phone: string | null; passwordHash: string | null; role: Role; referralCode?: string },
  ): Promise<string> {
    let referredBy: string | null = null;
    if (u.referralCode) {
      const ref = await this.db.one<{ id: string }>(`SELECT id FROM users WHERE referral_code = upper($1) AND status='ACTIVE'`, [u.referralCode.trim()], c);
      if (!ref) throw new AppError('INVALID_REFERRAL_CODE', 'This referral code is not valid');
      referredBy = ref.id;
    }
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO users (full_name, email, phone, password_hash, referral_code, referred_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [u.fullName.trim(), u.email, u.phone, u.passwordHash, `RST${randomDigits(3)}${randomToken(3).replace(/[^A-Za-z0-9]/g, 'X').toUpperCase().slice(0, 3)}`, referredBy],
      c,
    );
    const id = row!.id;
    await c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [id, u.role]);
    if (u.role === 'DRIVER') await c.query(`INSERT INTO drivers (user_id) VALUES ($1)`, [id]);
    return id;
  }

  private assertActive(status: string) {
    if (status === 'SUSPENDED') throw AppError.forbidden('Your account is suspended. Please contact support.');
    if (status === 'DELETED') throw AppError.unauthenticated('This account no longer exists', 'ACCOUNT_DELETED');
  }
}
