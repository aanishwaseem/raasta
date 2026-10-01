import { Injectable } from '@nestjs/common';
import { DatabaseService, geoPoint } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { normalizePkPhone } from '../../common/crypto/crypto';
import { latLngSql } from '../../common/dto';
import { StorageProvider, sniffContentType } from '../../common/providers/storage';
import { config } from '../../config/config';
import { UsersRepository } from './users.repository';
import {
  ConsentDto,
  EmergencyContactDto,
  PreferencesDto,
  SavedPlaceDto,
  UpdateEmergencyContactDto,
  UpdateMeDto,
  UpdateSavedPlaceDto,
} from './dto/users.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly users: UsersRepository,
    private readonly storage: StorageProvider,
  ) {}

  async me(userId: string) {
    const user = await this.users.publicById(userId);
    if (!user) throw AppError.notFound('User');
    const corporateProfiles = await this.db.query(
      `SELECT ca.id, ca.name, cu.role, cu.monthly_limit AS "monthlyLimit"
         FROM corporate_users cu JOIN corporate_accounts ca ON ca.id = cu.corporate_id
        WHERE cu.user_id = $1 AND cu.active AND ca.status = 'ACTIVE'`,
      [userId],
    );
    const driver = user.roles.includes('DRIVER')
      ? await this.db.one(`SELECT status, onboarding_step AS "onboardingStep" FROM drivers WHERE user_id = $1`, [userId])
      : null;
    return { ...user, corporateProfiles, driver };
  }

  async update(userId: string, dto: UpdateMeDto) {
    if (dto.email) {
      const taken = await this.db.one(`SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2`, [dto.email, userId]);
      if (taken) throw AppError.conflict('EMAIL_TAKEN', 'An account with this email already exists');
    }
    await this.db.query(
      `UPDATE users SET
         full_name = COALESCE($2, full_name),
         email = COALESCE(lower($3), email),
         email_verified_at = CASE WHEN $3::text IS NOT NULL AND lower($3) IS DISTINCT FROM email THEN NULL ELSE email_verified_at END,
         locale = COALESCE($4, locale),
         gender = COALESCE($5, gender),
         home_city_id = COALESCE($6, home_city_id)
       WHERE id = $1`,
      [userId, dto.fullName ?? null, dto.email ?? null, dto.locale ?? null, dto.gender ?? null, dto.homeCityId ?? null],
    );
    return this.me(userId);
  }

  async setAvatar(userId: string, file: { buffer: Buffer; size: number } | undefined) {
    if (!file) throw new AppError('VALIDATION_FAILED', 'Please attach an image');
    if (file.size > config().MAX_UPLOAD_BYTES) throw new AppError('FILE_TOO_LARGE', 'The image is too large', 413);
    const type = sniffContentType(file.buffer);
    if (!type || !type.startsWith('image/')) throw new AppError('UNSUPPORTED_FILE', 'Please upload a JPEG, PNG or WebP image');
    const key = await this.storage.put(`avatars/${userId}`, file.buffer, type);
    const prev = await this.db.one<{ avatar_key: string | null }>(`SELECT avatar_key FROM users WHERE id=$1`, [userId]);
    await this.db.query(`UPDATE users SET avatar_key = $2 WHERE id = $1`, [userId, key]);
    if (prev?.avatar_key) await this.storage.delete(prev.avatar_key).catch(() => undefined);
    return this.me(userId);
  }

  async avatar(userId: string): Promise<{ data: Buffer; type: string }> {
    const row = await this.db.one<{ avatar_key: string | null }>(`SELECT avatar_key FROM users WHERE id=$1 AND status <> 'DELETED'`, [userId]);
    if (!row?.avatar_key) throw AppError.notFound('Avatar');
    const data = await this.storage.get(row.avatar_key);
    return { data, type: sniffContentType(data) ?? 'application/octet-stream' };
  }

  // ------------------------------------------------------------ saved places
  listPlaces(userId: string) {
    return this.db.query(
      `SELECT id, label, name, address, ${latLngSql('location')}, created_at AS "createdAt"
         FROM saved_places WHERE user_id = $1 ORDER BY CASE label WHEN 'HOME' THEN 0 WHEN 'WORK' THEN 1 ELSE 2 END, created_at`,
      [userId],
    );
  }

  async addPlace(userId: string, dto: SavedPlaceDto) {
    const count = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM saved_places WHERE user_id=$1`, [userId]);
    if ((count?.n ?? 0) >= 30) throw AppError.unprocessable('LIMIT_REACHED', 'You can save up to 30 places');
    if (dto.label !== 'FAVORITE') {
      // HOME / WORK are unique: replace the previous one
      await this.db.query(`DELETE FROM saved_places WHERE user_id = $1 AND label = $2`, [userId, dto.label]);
    }
    return this.db.one(
      `INSERT INTO saved_places (user_id, label, name, address, location) VALUES ($1,$2,$3,$4, ${geoPoint(5, 6)})
       RETURNING id, label, name, address, ${latLngSql('location')}`,
      [userId, dto.label, dto.name, dto.address ?? null, dto.lng, dto.lat],
    );
  }

  async updatePlace(userId: string, id: string, dto: UpdateSavedPlaceDto) {
    const row = await this.db.one(
      `UPDATE saved_places SET name = COALESCE($3, name), address = COALESCE($4, address),
              location = CASE WHEN $5::float8 IS NULL THEN location ELSE ${geoPoint(5, 6)} END
        WHERE id = $1 AND user_id = $2
        RETURNING id, label, name, address, ${latLngSql('location')}`,
      [id, userId, dto.name ?? null, dto.address ?? null, dto.location?.lng ?? null, dto.location?.lat ?? null],
    );
    if (!row) throw AppError.notFound('Saved place');
    return row;
  }

  async deletePlace(userId: string, id: string) {
    const row = await this.db.one(`DELETE FROM saved_places WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
    if (!row) throw AppError.notFound('Saved place');
  }

  // ------------------------------------------------------------ emergency contacts
  listContacts(userId: string) {
    return this.db.query(
      `SELECT id, name, phone, relationship, share_by_default AS "shareByDefault" FROM emergency_contacts WHERE user_id=$1 ORDER BY created_at`,
      [userId],
    );
  }

  async addContact(userId: string, dto: EmergencyContactDto) {
    const phone = normalizePkPhone(dto.phone);
    if (!phone) throw new AppError('INVALID_PHONE', 'Please enter a valid phone number');
    const count = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM emergency_contacts WHERE user_id=$1`, [userId]);
    if ((count?.n ?? 0) >= 5) throw AppError.unprocessable('LIMIT_REACHED', 'You can add up to 5 trusted contacts');
    return this.db.one(
      `INSERT INTO emergency_contacts (user_id, name, phone, relationship, share_by_default) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, phone, relationship, share_by_default AS "shareByDefault"`,
      [userId, dto.name, phone, dto.relationship ?? null, dto.shareByDefault ?? false],
    );
  }

  async updateContact(userId: string, id: string, dto: UpdateEmergencyContactDto) {
    const phone = dto.phone ? normalizePkPhone(dto.phone) : null;
    if (dto.phone && !phone) throw new AppError('INVALID_PHONE', 'Please enter a valid phone number');
    const row = await this.db.one(
      `UPDATE emergency_contacts SET name = COALESCE($3, name), phone = COALESCE($4, phone),
              relationship = COALESCE($5, relationship), share_by_default = COALESCE($6, share_by_default)
        WHERE id = $1 AND user_id = $2
        RETURNING id, name, phone, relationship, share_by_default AS "shareByDefault"`,
      [id, userId, dto.name ?? null, phone, dto.relationship ?? null, dto.shareByDefault ?? null],
    );
    if (!row) throw AppError.notFound('Contact');
    return row;
  }

  async deleteContact(userId: string, id: string) {
    const row = await this.db.one(`DELETE FROM emergency_contacts WHERE id=$1 AND user_id=$2 RETURNING id`, [id, userId]);
    if (!row) throw AppError.notFound('Contact');
  }

  // ------------------------------------------------------------ preferences & consent
  async preferences(userId: string) {
    const u = await this.users.findById(userId);
    if (!u) throw AppError.notFound('User');
    return {
      safety: u.safety_preferences,
      notifications: u.notification_preferences,
      personalizationEnabled: u.personalization_enabled,
    };
  }

  async updatePreferences(userId: string, dto: PreferencesDto) {
    await this.db.query(
      `UPDATE users SET safety_preferences = safety_preferences || $2::jsonb,
                        notification_preferences = notification_preferences || $3::jsonb
        WHERE id = $1`,
      [userId, JSON.stringify(stripUndefined(dto.safety ?? {})), JSON.stringify(stripUndefined(dto.notifications ?? {}))],
    );
    return this.preferences(userId);
  }

  async recordConsent(userId: string, dto: ConsentDto) {
    await this.db.query(`INSERT INTO consents (user_id, kind, granted) VALUES ($1,$2,$3)`, [userId, dto.kind, dto.granted]);
    if (dto.kind === 'PERSONALIZATION') {
      await this.db.query(`UPDATE users SET personalization_enabled = $2 WHERE id = $1`, [userId, dto.granted]);
    }
    return { kind: dto.kind, granted: dto.granted };
  }

  async consents(userId: string) {
    return this.db.query(
      `SELECT DISTINCT ON (kind) kind, granted, created_at AS "updatedAt" FROM consents WHERE user_id=$1 ORDER BY kind, created_at DESC`,
      [userId],
    );
  }

  /** Personal data export (GDPR-style). Excludes internal risk data. */
  async export(userId: string) {
    const [profile, places, contacts, rides, payments, ratingsGiven, consents] = await Promise.all([
      this.me(userId),
      this.listPlaces(userId),
      this.listContacts(userId),
      this.db.query(
        `SELECT id, status, product_code AS "productCode", pickup_address AS "pickupAddress", dropoff_address AS "dropoffAddress",
                final_fare AS "finalFare", payment_method AS "paymentMethod", requested_at AS "requestedAt", completed_at AS "completedAt"
           FROM rides WHERE passenger_id = $1 OR driver_id = $1 ORDER BY requested_at DESC`,
        [userId],
      ),
      this.db.query(`SELECT id, purpose, method, amount, status, created_at AS "createdAt" FROM payments WHERE payer_user_id=$1 ORDER BY created_at DESC`, [userId]),
      this.db.query(`SELECT ride_id AS "rideId", stars, tags, comment, created_at AS "createdAt" FROM ratings WHERE rater_id=$1`, [userId]),
      this.consents(userId),
    ]);
    return { exportedAt: new Date().toISOString(), profile, savedPlaces: places, emergencyContacts: contacts, rides, payments, ratingsGiven, consents };
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
