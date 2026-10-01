import { Injectable } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../common/db/database.service';
import type { Role } from '../../common/auth/auth.types';

export interface UserRow {
  id: string;
  email: string | null;
  email_verified_at: Date | null;
  phone: string | null;
  phone_verified_at: Date | null;
  password_hash: string | null;
  full_name: string;
  avatar_key: string | null;
  gender: string | null;
  locale: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  referral_code: string | null;
  referred_by: string | null;
  personalization_enabled: boolean;
  safety_preferences: SafetyPreferences;
  notification_preferences: Record<string, boolean>;
  home_city_id: string | null;
  created_at: Date;
}

export interface SafetyPreferences {
  autoShareWithContacts: boolean;
  routeDeviationAlerts: boolean;
  preferFemaleDriver: boolean;
}

export interface PublicUser {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  avatarUrl: string | null;
  gender: string | null;
  locale: string;
  roles: Role[];
  referralCode: string | null;
  personalizationEnabled: boolean;
  safetyPreferences: SafetyPreferences;
  notificationPreferences: Record<string, boolean>;
  homeCityId: string | null;
  createdAt: string;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DatabaseService) {}

  findById(id: string, client?: Queryable) {
    return this.db.one<UserRow>(`SELECT * FROM users WHERE id = $1`, [id], client);
  }

  findByEmail(email: string) {
    return this.db.one<UserRow>(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
  }

  findByPhone(phone: string) {
    return this.db.one<UserRow>(`SELECT * FROM users WHERE phone = $1`, [phone]);
  }

  async roles(userId: string, client?: Queryable): Promise<Role[]> {
    const rows = await this.db.query<{ role: Role }>(`SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role`, [userId], client);
    return rows.map((r) => r.role);
  }

  toPublic(u: UserRow, roles: Role[]): PublicUser {
    return {
      id: u.id,
      fullName: u.full_name,
      email: u.email,
      phone: u.phone,
      emailVerified: !!u.email_verified_at,
      phoneVerified: !!u.phone_verified_at,
      avatarUrl: u.avatar_key ? `/api/v1/me/avatar/${encodeURIComponent(u.id)}` : null,
      gender: u.gender,
      locale: u.locale,
      roles,
      referralCode: u.referral_code,
      personalizationEnabled: u.personalization_enabled,
      safetyPreferences: u.safety_preferences,
      notificationPreferences: u.notification_preferences,
      homeCityId: u.home_city_id,
      createdAt: u.created_at.toISOString(),
    };
  }

  async publicById(id: string): Promise<PublicUser | null> {
    const u = await this.findById(id);
    if (!u) return null;
    return this.toPublic(u, await this.roles(id));
  }
}

/** First name only: what the other side of a ride gets to see. */
export const firstName = (full: string | null | undefined) => (full ?? '').trim().split(/\s+/)[0] || 'Rider';
