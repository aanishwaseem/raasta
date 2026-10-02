import { Injectable, Logger } from '@nestjs/common';
import { createSign } from 'crypto';
import { config } from '../../config/config';
import { DatabaseService } from '../db/database.service';
import { PushProvider } from './messaging';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Parses FCM_SERVICE_ACCOUNT_JSON, which may be raw JSON or base64 of it (easier to pass through env files). */
export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const j = JSON.parse(text) as ServiceAccount;
  if (!j.project_id || !j.client_email || !j.private_key) throw new Error('FCM_SERVICE_ACCOUNT_JSON must contain project_id, client_email and private_key');
  return j;
}

/** RS256 JWT with Node's crypto (no extra dependency): header.payload.signature, base64url, 55 minute lifetime. */
export function signRs256Jwt(claims: Record<string, unknown>, privateKeyPem: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ ...claims, iat, exp: iat + 55 * 60 })}`;
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(privateKeyPem).toString('base64url')}`;
}

/** Firebase Cloud Messaging (HTTP v1). Tokens that FCM reports as unregistered are deleted so we stop sending to them. */
@Injectable()
export class FcmPushProvider extends PushProvider {
  private readonly logger = new Logger('Push');
  private token: { value: string; exp: number } | null = null;
  private account: ServiceAccount | null = null;

  constructor(private readonly db: DatabaseService) {
    super();
  }

  private sa(): ServiceAccount {
    return (this.account ??= parseServiceAccount(config().FCM_SERVICE_ACCOUNT_JSON));
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const sa = this.sa();
    const assertion = signRs256Jwt({ iss: sa.client_email, sub: sa.client_email, aud: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/firebase.messaging' }, sa.private_key);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(6000),
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throw new Error(`FCM auth failed (${res.status})`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async send(userId: string, title: string, body: string, data: Record<string, unknown> = {}): Promise<void> {
    const devices = await this.db.query<{ token: string }>(`SELECT token FROM push_devices WHERE user_id = $1`, [userId]);
    if (!devices.length) return;
    const bearer = await this.accessToken();
    const strData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    await Promise.all(devices.map(async (d) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.sa().project_id}/messages:send`, {
        method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(6000),
        body: JSON.stringify({ message: { token: d.token, notification: { title, body }, data: strData, android: { priority: 'HIGH' } } }),
      });
      if (res.status === 404 || res.status === 400) {
        const txt = await res.text();
        if (/UNREGISTERED|INVALID_ARGUMENT/.test(txt)) await this.db.query(`DELETE FROM push_devices WHERE token = $1`, [d.token]);
        return;
      }
      if (!res.ok) this.logger.warn(`FCM responded ${res.status} for user ${userId}`);
    }));
  }
}
