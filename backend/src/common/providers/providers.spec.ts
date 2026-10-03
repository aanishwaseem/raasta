import { generateKeyPairSync } from 'crypto';
import { resetConfigForTests } from '../../config/config';
import { FcmPushProvider, parseServiceAccount } from './fcm.provider';
import { HttpSmsProvider, TwilioSmsProvider } from './sms.providers';

const setEnv = (e: Record<string, string>) => { Object.assign(process.env, e); resetConfigForTests(); };
const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });

describe('SMS and push providers (network mocked)', () => {
  afterEach(() => { jest.restoreAllMocks(); resetConfigForTests(); });

  it('twilio sends a form-encoded message with basic auth', async () => {
    setEnv({ TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+15550001111' });
    const f = jest.spyOn(global, 'fetch').mockResolvedValue(ok());
    await new TwilioSmsProvider().send('+923001234567', 'code 123456');
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain('/Accounts/ACtest/Messages.json');
    expect((init!.headers as Record<string, string>).authorization).toMatch(/^Basic /);
    expect(String(init!.body)).toContain('To=%2B923001234567');
  });

  it('http gateway posts JSON, retries once on 5xx and then throws a useful error', async () => {
    setEnv({ SMS_HTTP_URL: 'https://sms.example.test/send', SMS_HTTP_AUTH: 'Bearer abc' });
    const f = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 503 }));
    await expect(new HttpSmsProvider().send('+923001234567', 'hi')).rejects.toThrow(/503/);
    expect(f).toHaveBeenCalledTimes(2);
    f.mockReset().mockResolvedValue(new Response('no', { status: 401 }));
    await expect(new HttpSmsProvider().send('+923001234567', 'hi')).rejects.toThrow(/401/);
    expect(f).toHaveBeenCalledTimes(1); // client errors are not retried
  });

  it('parses the FCM service account from raw or base64 JSON and rejects incomplete ones', () => {
    const sa = JSON.stringify({ project_id: 'p', client_email: 'a@b.iam', private_key: 'k' });
    expect(parseServiceAccount(sa).project_id).toBe('p');
    expect(parseServiceAccount(Buffer.from(sa).toString('base64')).client_email).toBe('a@b.iam');
    expect(() => parseServiceAccount('{"project_id":"p"}')).toThrow(/must contain/);
  });

  it('fcm exchanges a signed JWT for a token, sends to each device and prunes unregistered tokens', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    setEnv({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'proj', client_email: 'svc@proj.iam', private_key: privateKey }) });
    const queries: string[] = [];
    const db = { query: jest.fn(async (sql: string) => { queries.push(sql); return sql.startsWith('SELECT') ? [{ token: 'good-token-aaaaaaaaaaaa' }, { token: 'dead-token-bbbbbbbbbbbb' }] : []; }) };
    const f = jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com')) return ok({ access_token: 'at', expires_in: 3600 });
      return JSON.parse(String(init!.body)).message.token.startsWith('dead') ? new Response('{"error":{"status":"UNREGISTERED"}}', { status: 404 }) : ok();
    });
    await new FcmPushProvider(db as never).send('user-1', 'Driver found', 'On the way', { rideId: 'r1', n: 3 });
    const sends = f.mock.calls.filter(([u]) => String(u).includes('fcm.googleapis.com'));
    expect(sends).toHaveLength(2);
    expect(JSON.parse(String(sends[0][1]!.body)).message.data).toEqual({ rideId: 'r1', n: '3' }); // FCM data must be strings
    expect(queries.some((q) => q.startsWith('DELETE FROM push_devices'))).toBe(true);
  });
});
