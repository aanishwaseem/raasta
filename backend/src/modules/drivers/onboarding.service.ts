import { Injectable } from '@nestjs/common';
import { config } from '../../config/config';
import { DatabaseService } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { encryptField } from '../../common/crypto/crypto';
import { StorageProvider, sniffContentType } from '../../common/providers/storage';
import { DocType, DocumentUploadDto, IdentityDto, VehicleDto } from './dto/drivers.dto';

const PERSONAL_DOCS: DocType[] = ['CNIC_FRONT', 'CNIC_BACK', 'DRIVING_LICENSE', 'PROFILE_PHOTO'];
const VEHICLE_DOCS: DocType[] = ['VEHICLE_REGISTRATION', 'VEHICLE_PHOTO'];

export interface ChecklistItem {
  key: string;
  label: string;
  status: 'MISSING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'DONE';
  note?: string | null;
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageProvider,
  ) {}

  async submitIdentity(driverId: string, dto: IdentityDto) {
    const d = await this.driver(driverId);
    if (['APPROVED', 'SUSPENDED'].includes(d.status)) throw AppError.conflict('ALREADY_REVIEWED', 'Identity can no longer be changed. Contact support.');
    const dob = new Date(dto.dateOfBirth);
    const age = (Date.now() - dob.getTime()) / (365.25 * 86400_000);
    if (age < 18 || age > 80) throw AppError.unprocessable('AGE_NOT_ELIGIBLE', 'Drivers must be between 18 and 80 years old');
    const cnic = dto.cnicNumber.replace(/-/g, '');
    const city = await this.db.one(`SELECT 1 FROM cities WHERE id = $1 AND active`, [dto.cityId]);
    if (!city) throw AppError.notFound('City');
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE drivers SET cnic_encrypted = $2, cnic_last4 = $3, license_number_encrypted = $4, date_of_birth = $5, city_id = $6,
                onboarding_step = CASE WHEN onboarding_step = 'IDENTITY' THEN 'DOCUMENTS' ELSE onboarding_step END,
                status = CASE WHEN status = 'REJECTED' THEN 'ONBOARDING' ELSE status END
          WHERE user_id = $1`,
        [driverId, encryptField(cnic), cnic.slice(-4), encryptField(dto.licenseNumber.trim().toUpperCase()), dto.dateOfBirth, dto.cityId],
      );
      if (dto.gender) await c.query(`UPDATE users SET gender = $2 WHERE id = $1`, [driverId, dto.gender]);
    });
    return this.profile(driverId);
  }

  async addVehicle(driverId: string, dto: VehicleDto) {
    const d = await this.driver(driverId);
    if (d.status === 'SUSPENDED') throw AppError.forbidden('Your account is suspended');
    if (dto.vehicleClass === 'BIKE' && dto.seats !== 1) throw AppError.unprocessable('INVALID_SEATS', 'A bike carries exactly one passenger');
    if (dto.vehicleClass !== 'BIKE' && dto.seats < 2) throw AppError.unprocessable('INVALID_SEATS', 'Cars must have at least 2 passenger seats');
    if (dto.year < new Date().getFullYear() - 25) throw AppError.unprocessable('VEHICLE_TOO_OLD', 'Vehicles older than 25 years are not accepted');
    const v = await this.db.one<{ id: string }>(
      `INSERT INTO vehicles (driver_id, vehicle_class, make, model, year, color, plate_number, seats)
       VALUES ($1,$2,$3,$4,$5,$6,upper($7),$8) RETURNING id`,
      [driverId, dto.vehicleClass, dto.make.trim(), dto.model.trim(), dto.year, dto.color.trim(), dto.plateNumber.trim(), dto.seats],
    );
    await this.db.query(
      `UPDATE drivers SET current_vehicle_id = COALESCE(current_vehicle_id, $2),
              onboarding_step = CASE WHEN onboarding_step IN ('IDENTITY','DOCUMENTS','VEHICLE') THEN 'VEHICLE' ELSE onboarding_step END
        WHERE user_id = $1`,
      [driverId, v!.id],
    );
    return this.vehicles(driverId);
  }

  vehicles(driverId: string) {
    return this.db.query(
      `SELECT v.id, v.vehicle_class AS "vehicleClass", v.make, v.model, v.year, v.color, v.plate_number AS "plateNumber", v.seats, v.status,
              (d.current_vehicle_id = v.id) AS current
         FROM vehicles v JOIN drivers d ON d.user_id = v.driver_id WHERE v.driver_id = $1 ORDER BY v.created_at`,
      [driverId],
    );
  }

  async uploadDocument(driverId: string, dto: DocumentUploadDto, file: { buffer: Buffer; size: number } | undefined) {
    await this.driver(driverId);
    if (!file) throw new AppError('VALIDATION_FAILED', 'Please attach the document file');
    if (file.size > config().MAX_UPLOAD_BYTES) throw new AppError('FILE_TOO_LARGE', 'The file is too large (max 8 MB)', 413);
    const type = sniffContentType(file.buffer);
    if (!type) throw new AppError('UNSUPPORTED_FILE', 'Please upload a JPEG, PNG, WebP or PDF file');
    const isVehicleDoc = VEHICLE_DOCS.includes(dto.docType) || dto.docType === 'INSURANCE' || dto.docType === 'ROUTE_PERMIT';
    let vehicleId: string | null = null;
    if (isVehicleDoc) {
      const v = await this.db.one<{ id: string }>(
        `SELECT id FROM vehicles WHERE driver_id = $1 AND id = COALESCE($2, (SELECT current_vehicle_id FROM drivers WHERE user_id = $1))`,
        [driverId, dto.vehicleId ?? null],
      );
      if (!v) throw AppError.unprocessable('VEHICLE_REQUIRED', 'Add your vehicle before uploading vehicle documents');
      vehicleId = v.id;
    }
    if (dto.expiresOn && new Date(dto.expiresOn) < new Date()) throw AppError.unprocessable('DOCUMENT_EXPIRED', 'This document has already expired');
    const key = await this.storage.put(`driver-docs/${driverId}`, file.buffer, type);
    await this.db.tx(async (c) => {
      // a new upload supersedes a previous pending/rejected one of the same type
      await c.query(
        `UPDATE driver_documents SET status = 'REJECTED', rejection_reason = COALESCE(rejection_reason, 'Superseded by a newer upload')
          WHERE driver_id = $1 AND doc_type = $2 AND vehicle_id IS NOT DISTINCT FROM $3 AND status = 'PENDING'`,
        [driverId, dto.docType, vehicleId],
      );
      await c.query(
        `INSERT INTO driver_documents (driver_id, vehicle_id, doc_type, storage_key, content_type, size_bytes, document_number, expires_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [driverId, vehicleId, dto.docType, key, type, file.size, dto.documentNumber ?? null, dto.expiresOn ?? null],
      );
    });
    return this.documents(driverId);
  }

  documents(driverId: string) {
    return this.db.query(
      `SELECT DISTINCT ON (doc_type, vehicle_id) id, doc_type AS "docType", vehicle_id AS "vehicleId", status, rejection_reason AS "rejectionReason",
              expires_on AS "expiresOn", created_at AS "uploadedAt", reviewed_at AS "reviewedAt"
         FROM driver_documents WHERE driver_id = $1
        ORDER BY doc_type, vehicle_id, created_at DESC`,
      [driverId],
    );
  }

  async submitForReview(driverId: string) {
    const checklist = await this.checklist(driverId);
    const blocking = checklist.filter((c) => c.key !== 'REVIEW' && c.key !== 'TRAINING' && ['MISSING', 'REJECTED', 'EXPIRED'].includes(c.status));
    if (blocking.length) {
      throw AppError.unprocessable('ONBOARDING_INCOMPLETE', 'Some steps are not complete yet', { missing: blocking.map((b) => b.key) });
    }
    const d = await this.driver(driverId);
    if (!['ONBOARDING', 'REJECTED'].includes(d.status)) throw AppError.conflict('ALREADY_SUBMITTED', 'Your application is already under review or approved');
    await this.db.query(`UPDATE drivers SET status = 'PENDING_REVIEW', onboarding_step = 'REVIEW' WHERE user_id = $1`, [driverId]);
    return this.profile(driverId);
  }

  async acknowledgeTraining(driverId: string, acknowledged: boolean) {
    if (!acknowledged) throw new AppError('VALIDATION_FAILED', 'Please confirm you have read the safety guidelines');
    const d = await this.driver(driverId);
    if (d.status !== 'APPROVED') throw AppError.unprocessable('DRIVER_NOT_APPROVED', 'Your application must be approved first');
    await this.db.tx(async (c) => {
      await c.query(`UPDATE drivers SET training_acknowledged_at = now(), onboarding_step = 'ACTIVE' WHERE user_id = $1`, [driverId]);
      await c.query(`INSERT INTO consents (user_id, kind, granted) VALUES ($1, 'DRIVER_CODE_OF_CONDUCT', true)`, [driverId]);
    });
    return this.profile(driverId);
  }

  async checklist(driverId: string): Promise<ChecklistItem[]> {
    const d = await this.driver(driverId);
    const docs = (await this.documents(driverId)) as { docType: DocType; vehicleId: string | null; status: string; rejectionReason: string | null }[];
    const vehicle = d.current_vehicle_id
      ? await this.db.one<{ status: string; vehicle_class: string }>(`SELECT status, vehicle_class FROM vehicles WHERE id=$1`, [d.current_vehicle_id])
      : null;
    const items: ChecklistItem[] = [{ key: 'IDENTITY', label: 'Identity (CNIC & licence)', status: d.cnic_last4 ? 'DONE' : 'MISSING' }];
    for (const t of PERSONAL_DOCS) {
      const doc = docs.find((x) => x.docType === t);
      items.push({ key: t, label: DOC_LABELS[t], status: (doc?.status as ChecklistItem['status']) ?? 'MISSING', note: doc?.rejectionReason });
    }
    items.push({ key: 'VEHICLE', label: 'Vehicle details', status: !vehicle ? 'MISSING' : vehicle.status === 'APPROVED' ? 'APPROVED' : vehicle.status === 'REJECTED' ? 'REJECTED' : 'PENDING' });
    for (const t of VEHICLE_DOCS) {
      const doc = docs.find((x) => x.docType === t && x.vehicleId === d.current_vehicle_id);
      items.push({ key: t, label: DOC_LABELS[t], status: (doc?.status as ChecklistItem['status']) ?? 'MISSING', note: doc?.rejectionReason });
    }
    items.push({
      key: 'REVIEW',
      label: 'Review by Raasta team',
      status: d.status === 'APPROVED' ? 'APPROVED' : d.status === 'PENDING_REVIEW' ? 'PENDING' : d.status === 'REJECTED' ? 'REJECTED' : 'MISSING',
      note: d.status === 'REJECTED' ? d.review_notes : null,
    });
    items.push({ key: 'TRAINING', label: 'Safety & code of conduct', status: d.training_acknowledged_at ? 'DONE' : 'MISSING' });
    return items;
  }

  async profile(driverId: string) {
    const d = await this.db.one(
      `SELECT d.user_id AS id, u.full_name AS "fullName", u.phone, d.status, d.onboarding_step AS "onboardingStep", d.city_id AS "cityId",
              d.cnic_last4 AS "cnicLast4", d.preferences, d.review_notes AS "reviewNotes", d.approved_at AS "approvedAt",
              d.current_vehicle_id AS "currentVehicleId"
         FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.user_id = $1`,
      [driverId],
    );
    if (!d) throw AppError.notFound('Driver');
    const [checklist, vehicles] = await Promise.all([this.checklist(driverId), this.vehicles(driverId)]);
    return { ...d, checklist, vehicles, canGoOnline: d.status === 'APPROVED' && d.onboardingStep === 'ACTIVE' };
  }

  async updatePreferences(driverId: string, prefs: Record<string, unknown>) {
    const clean = Object.fromEntries(Object.entries(prefs).filter(([, v]) => v !== undefined));
    await this.db.query(`UPDATE drivers SET preferences = preferences || $2::jsonb WHERE user_id = $1`, [driverId, JSON.stringify(clean)]);
    return this.profile(driverId);
  }

  private async driver(driverId: string) {
    const d = await this.db.one<{ status: string; onboarding_step: string; cnic_last4: string | null; current_vehicle_id: string | null; training_acknowledged_at: Date | null; review_notes: string | null }>(
      `SELECT status, onboarding_step, cnic_last4, current_vehicle_id, training_acknowledged_at, review_notes FROM drivers WHERE user_id = $1`,
      [driverId],
    );
    if (!d) throw AppError.forbidden('Driver profile not found');
    return d;
  }
}

export const DOC_LABELS: Record<DocType, string> = {
  CNIC_FRONT: 'CNIC (front)',
  CNIC_BACK: 'CNIC (back)',
  DRIVING_LICENSE: 'Driving licence',
  PROFILE_PHOTO: 'Profile photo',
  VEHICLE_REGISTRATION: 'Vehicle registration',
  VEHICLE_PHOTO: 'Vehicle photo',
  INSURANCE: 'Insurance',
  ROUTE_PERMIT: 'Route permit',
};
export const REQUIRED_PERSONAL_DOCS = PERSONAL_DOCS;
export const REQUIRED_VEHICLE_DOCS = VEHICLE_DOCS;
