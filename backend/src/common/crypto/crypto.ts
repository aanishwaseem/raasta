import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { config } from '../../config/config';

function key(): Buffer {
  const k = Buffer.from(config().DATA_ENCRYPTION_KEY, 'base64');
  if (k.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes (base64)');
  return k;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url parts). */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptField(enc: string): string {
  const [v, iv, tag, ct] = enc.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export const hmac = (secret: string, v: string) => createHmac('sha256', secret).update(v).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const randomDigits = (n: number) =>
  Array.from({ length: n }, () => randomInt(0, 10)).join('');

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (phone.length < 7) return '***';
  return `${phone.slice(0, 4)}******${phone.slice(-3)}`;
}

/** Normalise Pakistani mobile numbers to E.164 (+92XXXXXXXXXX). Returns null if not plausible. */
export function normalizePkPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  let d = digits.startsWith('+') ? digits.slice(1) : digits;
  if (d.startsWith('0092')) d = d.slice(2);
  if (d.startsWith('03') && d.length === 11) d = `92${d.slice(1)}`;
  if (d.startsWith('3') && d.length === 10) d = `92${d}`;
  if (/^923\d{9}$/.test(d)) return `+${d}`;
  // allow other international numbers for emergency contacts
  if (digits.startsWith('+') && /^\+\d{8,15}$/.test(digits)) return digits;
  return null;
}
