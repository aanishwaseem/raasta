import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config/config';
import { SmsProvider } from './messaging';

async function post(url: string, init: RequestInit, what: string): Promise<void> {
  let lastErr = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(6000) });
      if (res.ok) return;
      lastErr = `${what} responded ${res.status}`;
      if (res.status < 500) break; // client errors will not improve on retry
    } catch (e) {
      lastErr = `${what} unreachable: ${(e as Error).message}`;
    }
  }
  throw new Error(lastErr);
}

/** Twilio Programmable Messaging. Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (or a messaging service SID). */
@Injectable()
export class TwilioSmsProvider extends SmsProvider {
  private readonly logger = new Logger('SMS');
  async send(to: string, body: string): Promise<void> {
    const c = config();
    const form = new URLSearchParams({ To: to, Body: body });
    if (c.TWILIO_FROM.startsWith('MG')) form.set('MessagingServiceSid', c.TWILIO_FROM);
    else form.set('From', c.TWILIO_FROM);
    await post(`https://api.twilio.com/2010-04-01/Accounts/${c.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${c.TWILIO_ACCOUNT_SID}:${c.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    }, 'Twilio');
    this.logger.log(`sent via twilio to ${to.slice(0, 5)}***`);
  }
}

/**
 * Generic JSON gateway for local Pakistani SMS aggregators: POST { to, text, sender } to SMS_HTTP_URL
 * with an optional Authorization header value from SMS_HTTP_AUTH. Adapt the payload in one place if a vendor differs.
 */
@Injectable()
export class HttpSmsProvider extends SmsProvider {
  private readonly logger = new Logger('SMS');
  async send(to: string, body: string): Promise<void> {
    const c = config();
    await post(c.SMS_HTTP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(c.SMS_HTTP_AUTH ? { authorization: c.SMS_HTTP_AUTH } : {}) },
      body: JSON.stringify({ to, text: body, sender: c.SMS_SENDER_ID }),
    }, 'SMS gateway');
    this.logger.log(`sent via http gateway to ${to.slice(0, 5)}***`);
  }
}
