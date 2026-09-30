import { Injectable } from '@nestjs/common';
import { randomToken } from '../../common/crypto/crypto';
import { DatabaseService } from '../../common/db/database.service';
import { RedisService } from '../../common/redis/redis.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthUser } from '../../common/auth/auth.types';
import { haversineM, LatLng } from '../../common/geo/geo';
import { AiClient, NluResult } from '../ai/ai.client';
import { PredictionsService } from '../ai/predictions.service';
import { GeoService } from '../geo/geo.service';
import { PricingService, Quote, QuoteOption } from '../pricing/pricing.service';
import { RideViewService } from '../rides/ride-view.service';
import { RideRepository } from '../rides/ride.repository';
import { RidesService } from '../rides/rides.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { MobilityService } from './mobility.service';
import { bookSummary, Lang, lang, t } from './assistant.templates';

const PENDING_TTL_S = 600;
const MIN_CONFIDENCE = 0.55;
const ACTION_INTENTS = new Set(['BOOK_RIDE', 'SCHEDULE_RIDE', 'BOOK_USUAL', 'QUOTE', 'CHEAPEST', 'FASTEST']);

type PendingType = 'BOOK_RIDE' | 'SCHEDULE_RIDE' | 'CANCEL_RIDE';
interface PendingAction {
  userId: string;
  type: PendingType;
  channel: 'VOICE' | 'ASSISTANT';
  lang: Lang;
  payload: Record<string, unknown>;
}

interface PlaceRef extends LatLng {
  address: string;
}
type Resolved = { ok: true; place: PlaceRef } | { ok: false; reply: string; options?: Array<{ name: string; address: string | null; text: string }>; missing?: string };

export interface AssistantReply {
  reply: string;
  intent: string;
  language: Lang;
  confidence: number | null;
  missing: string[];
  options?: Array<{ name: string; address: string | null; text: string }>;
  data?: Record<string, unknown>;
  pendingAction?: { token: string; type: PendingType; summary: string; expiresInS: number };
  parsed?: { pickup: PlaceRef | null; dropoff: PlaceRef | null; when: string | null; productCode: string | null };
}

/**
 * Mobility assistant. The NLU only extracts intent and slots. Every fact in a reply (prices, ETAs, ride status)
 * comes from a real backend call, never from generated text. State-changing intents produce a single-use
 * pending action that needs an explicit /assistant/confirm; ambiguous or low-confidence input asks or does nothing.
 */
@Injectable()
export class AssistantService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly ai: AiClient,
    private readonly predictions: PredictionsService,
    private readonly geo: GeoService,
    private readonly pricing: PricingService,
    private readonly rides: RidesService,
    private readonly rideRepo: RideRepository,
    private readonly views: RideViewService,
    private readonly scheduling: SchedulingService,
    private readonly mobility: MobilityService,
  ) {}

  async message(user: AuthUser, text: string, opts: { loc?: LatLng; locale?: string; channel?: 'VOICE' | 'ASSISTANT' } = {}): Promise<AssistantReply> {
    const channel = opts.channel ?? 'ASSISTANT';
    const nlu = await this.ai.nlu(text, new Date(), 'Asia/Karachi', opts.locale);
    if (!nlu) {
      const l: Lang = opts.locale === 'ur' ? 'ur' : 'en';
      return { reply: t('unavailable', l), intent: 'UNAVAILABLE', language: l, confidence: null, missing: [] };
    }
    const l = lang(nlu.language);
    await this.predictions.log({
      kind: 'NLU', model: nlu.engine, version: 'n/a', entityType: 'user', entityId: user.id,
      features: { chars: text.length, language: nlu.language }, prediction: { intent: nlu.intent, confidence: nlu.confidence, missing: nlu.missing },
    }).catch(() => undefined);
    const base = { intent: nlu.intent, language: l, confidence: nlu.confidence, missing: [] as string[] };

    if (ACTION_INTENTS.has(nlu.intent) && nlu.confidence < MIN_CONFIDENCE) {
      return { ...base, intent: 'UNCLEAR', reply: t('unsure', l) };
    }
    switch (nlu.intent) {
      case 'BOOK_RIDE': case 'SCHEDULE_RIDE': case 'BOOK_USUAL': case 'QUOTE': case 'CHEAPEST': case 'FASTEST':
        return this.handleTrip(user, nlu, l, channel, opts.loc);
      case 'RIDE_STATUS': return { ...base, ...(await this.rideStatus(user, l)) };
      case 'WHY_FARE': return { ...base, ...(await this.whyFare(user, l)) };
      case 'CANCEL_RIDE': return { ...base, ...(await this.cancelIntent(user, l, channel)) };
      case 'RIDE_HISTORY': return { ...base, ...(await this.history(user, l)) };
      case 'SAFETY_HELP': return { ...base, reply: t('safety', l), data: { emergencyNumber: '15', openSafetyScreen: true } };
      case 'SUPPORT': return { ...base, reply: t('support', l) };
      default: return { ...base, intent: 'UNKNOWN', reply: `${t('unsure', l)} ${t('help', l)}` };
    }
  }

  // --------------------------------------------------------------- trip intents
  private async handleTrip(user: AuthUser, nlu: NluResult, l: Lang, channel: 'VOICE' | 'ASSISTANT', loc?: LatLng): Promise<AssistantReply> {
    const base = { intent: nlu.intent, language: l, confidence: nlu.confidence };
    const pickupText = nlu.slots.pickup ?? null;
    const dropoffText = nlu.slots.dropoff ?? null;
    let productCode = nlu.slots.productCode ?? null;
    let pickupFixed: PlaceRef | null = null;
    let dropoffFixed: PlaceRef | null = null;

    if (nlu.intent === 'BOOK_USUAL') {
      const routine = (await this.mobility.profile(user.id)).routines[0] as { pickup: PlaceRef; dropoff: PlaceRef; productCode: string } | undefined;
      if (!routine) return { ...base, missing: [], reply: l === 'en' ? 'I do not know a usual trip for you yet. Tell me where you want to go.' : t('ask_dropoff', l) };
      pickupFixed = routine.pickup; dropoffFixed = routine.dropoff; productCode ??= routine.productCode;
    }

    const near = loc ?? undefined;
    const pickup = pickupFixed ? ({ ok: true, place: pickupFixed } as Resolved) : pickupText ? await this.resolvePlace(user.id, pickupText, l, near, loc) : loc ? await this.fromLocation(loc) : ({ ok: false, reply: t('ask_pickup', l), missing: 'pickup' } as Resolved);
    if (!pickup.ok) return { ...base, reply: pickup.reply, options: pickup.options, missing: pickup.missing ? [pickup.missing] : ['pickup'] };
    const dropoff = dropoffFixed ? ({ ok: true, place: dropoffFixed } as Resolved) : dropoffText ? await this.resolvePlace(user.id, dropoffText, l, pickup.place) : ({ ok: false, reply: t('ask_dropoff', l), missing: 'dropoff' } as Resolved);
    if (!dropoff.ok) return { ...base, reply: dropoff.reply, options: dropoff.options, missing: dropoff.missing ? [dropoff.missing] : ['dropoff'] };

    const when = nlu.slots.datetime ? new Date(nlu.slots.datetime) : null;
    const scheduling = nlu.intent === 'SCHEDULE_RIDE' || (when && when.getTime() - Date.now() > 20 * 60_000);
    if (nlu.intent === 'SCHEDULE_RIDE' && (!when || Number.isNaN(when.getTime()))) {
      return { ...base, missing: ['datetime'], reply: t('ask_time', l), parsed: { pickup: pickup.place, dropoff: dropoff.place, when: null, productCode } };
    }

    let quote: Quote;
    try {
      quote = await this.pricing.quote(user.id, pickup.place, dropoff.place);
    } catch (err) {
      if (err instanceof AppError) return { ...base, missing: [], reply: err.message };
      throw err;
    }
    const option = this.pickOption(quote, productCode, nlu.slots.preference ?? (nlu.intent === 'CHEAPEST' ? 'CHEAPEST' : nlu.intent === 'FASTEST' ? 'FASTEST' : null));
    if (!option) return { ...base, missing: [], reply: l === 'en' ? 'No ride types are available for that trip right now.' : t('unsure', l) };
    const parsed = { pickup: pickup.place, dropoff: dropoff.place, when: when?.toISOString() ?? null, productCode: option.productCode };
    const data = { quoteId: quote.id, options: quote.options.map((o) => ({ productCode: o.productCode, name: o.name, fare: o.fare.recommended, minimum: o.fare.minimumReasonable, pickupEtaS: o.pickupEtaS, availability: o.availability })) };

    if (nlu.intent === 'QUOTE') {
      const lines = quote.options.filter((o) => o.availability !== 'NONE').map((o) => `${o.name} Rs ${o.fare.recommended}`).join(', ');
      return { ...base, missing: [], data, parsed, reply: l === 'en' ? `From ${short(pickup.place)} to ${short(dropoff.place)}: ${lines}.` : `${short(pickup.place)} → ${short(dropoff.place)}: ${lines}.` };
    }
    if (option.availability === 'NONE' && !scheduling) {
      return { ...base, missing: [], data, parsed, reply: l === 'en' ? `There are no ${option.name} drivers nearby right now. You can schedule the ride or try another ride type.` : t('unsure', l) };
    }
    const payment = await this.defaultPayment(user.id);
    const summary = bookSummary(l, {
      product: option.name, from: short(pickup.place), to: short(dropoff.place), fare: option.fare.recommended, low: option.fare.low, high: option.fare.high,
      pickupEtaMin: option.pickupEtaS ? Math.max(1, Math.round(option.pickupEtaS / 60)) : null, payment: payment.toLowerCase(), when: scheduling ? when : null,
    });
    const type: PendingType = scheduling ? 'SCHEDULE_RIDE' : 'BOOK_RIDE';
    const pending = await this.savePending({
      userId: user.id, type, channel, lang: l,
      payload: { quoteId: quote.id, productCode: option.productCode, fare: option.fare.recommended, paymentMethod: payment, pickup: pickup.place, dropoff: dropoff.place, pickupAt: when?.toISOString() ?? null },
    }, summary);
    return { ...base, missing: [], data, parsed, reply: `${summary} ${t('confirm_suffix', l)}`, pendingAction: pending };
  }

  private pickOption(quote: Quote, productCode: string | null, preference: 'CHEAPEST' | 'FASTEST' | null): QuoteOption | null {
    const byCode = productCode ? quote.options.find((o) => o.productCode === productCode) : null;
    if (byCode) return byCode;
    const kind = preference ?? 'BALANCED';
    const rec = quote.recommendations.find((r) => r.kind === kind) ?? quote.recommendations[0];
    return (rec && quote.options.find((o) => o.productCode === rec.productCode)) ?? quote.options.find((o) => o.availability !== 'NONE') ?? quote.options[0] ?? null;
  }

  private async defaultPayment(userId: string): Promise<'CASH' | 'WALLET'> {
    // Cash unless the user has already been spending from their wallet (never silently charge stored value).
    const r = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM rides WHERE passenger_id = $1 AND payment_method = 'WALLET' AND status = 'COMPLETED' AND requested_at > now() - interval '30 days'`, [userId]);
    return (r?.n ?? 0) >= 2 ? 'WALLET' : 'CASH';
  }

  // --------------------------------------------------------------- place resolution
  private async fromLocation(loc: LatLng): Promise<Resolved> {
    const r = await this.geo.reverse(loc);
    return { ok: true, place: { lat: loc.lat, lng: loc.lng, address: r.address || r.name } };
  }

  private async resolvePlace(userId: string, text: string, l: Lang, near?: LatLng, loc?: LatLng): Promise<Resolved> {
    const q = text.trim();
    const lower = q.toLowerCase();
    const saved = /^(home|ghar|گھر)$/.test(lower) ? 'HOME' : /^(work|office|daftar|دفتر)$/.test(lower) ? 'WORK' : null;
    if (saved) {
      const s = await this.db.one<{ name: string; address: string | null; lat: number; lng: number }>(
        `SELECT name, address, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM saved_places WHERE user_id = $1 AND label = $2`, [userId, saved]);
      if (s) return { ok: true, place: { lat: s.lat, lng: s.lng, address: s.address ?? s.name } };
      return { ok: false, reply: l === 'en' ? `You have not saved a ${saved.toLowerCase()} address yet. Tell me the place name instead.` : t('not_found', l, { q }) };
    }
    if (/^(here|current location|my location|yahan|yahaan|یہاں)$/.test(lower) && loc) return this.fromLocation(loc);
    const results = await this.geo.searchPlaces(q, near, undefined, 4);
    if (!results.length) return { ok: false, reply: t('not_found', l, { q }) };
    const top = results[0];
    const exact = top.name.toLowerCase() === lower;
    const rivals = results.slice(1).filter((r) => haversineM(r.location, top.location) > 1000 && r.name.toLowerCase().includes(lower));
    if (!exact && rivals.length) {
      return {
        ok: false,
        reply: t('which_place', l, { q }),
        options: [top, ...rivals].slice(0, 3).map((p) => ({ name: p.name, address: p.address, text: p.name })),
      };
    }
    return { ok: true, place: { lat: top.location.lat, lng: top.location.lng, address: top.address ?? top.name } };
  }

  // --------------------------------------------------------------- informational intents (real data only)
  private async rideStatus(user: AuthUser, l: Lang): Promise<Pick<AssistantReply, 'reply' | 'data'>> {
    const ride = await this.rideRepo.activeForPassenger(user.id);
    if (!ride) return { reply: t('no_active', l) };
    const v = (await this.views.build(ride, 'PASSENGER')) as { status: string; driver?: { firstName?: string; vehicle?: { color?: string; make?: string; model?: string; plateNumber?: string } }; pickupEtaS?: number | null };
    const d = v.driver;
    const car = d?.vehicle ? `${d.vehicle.color ?? ''} ${d.vehicle.make ?? ''} ${d.vehicle.model ?? ''} (${d.vehicle.plateNumber ?? ''})`.replace(/\s+/g, ' ').trim() : '';
    const status: Record<string, string> = {
      MATCHING: 'We are finding you a driver.',
      DRIVER_ASSIGNED: `${d?.firstName ?? 'Your driver'} is on the way in ${car}.`,
      DRIVER_ARRIVING: `${d?.firstName ?? 'Your driver'} is nearby in ${car}.`,
      DRIVER_ARRIVED: `${d?.firstName ?? 'Your driver'} has arrived in ${car}. Share your PIN to start.`,
      IN_PROGRESS: 'Your trip is in progress.',
    };
    return { reply: status[ride.status] ?? `Your ride is ${ride.status.toLowerCase().replace('_', ' ')}.`, data: { rideId: ride.id, status: ride.status } };
  }

  private async whyFare(user: AuthUser, l: Lang): Promise<Pick<AssistantReply, 'reply' | 'data'>> {
    const r = await this.db.one<{ id: string; quote_id: string | null; product_code: string; offered_fare: number }>(
      `SELECT id, quote_id, product_code, offered_fare FROM rides WHERE passenger_id = $1 AND quote_id IS NOT NULL ORDER BY requested_at DESC LIMIT 1`, [user.id]);
    if (!r?.quote_id) return { reply: l === 'en' ? 'I do not have a recent fare to explain. Get a quote first.' : t('no_active', l) };
    const q = await this.db.one<{ options: { options: QuoteOption[] } }>(`SELECT options FROM ride_quotes WHERE id = $1`, [r.quote_id]);
    const opt = q?.options.options.find((o) => o.productCode === r.product_code);
    if (!opt) return { reply: t('no_active', l) };
    return { reply: `Rs ${r.offered_fare}. ${opt.fare.explanation.join(' ')}`, data: { rideId: r.id, breakdown: opt.fare.breakdown, explanation: opt.fare.explanation } };
  }

  private async history(user: AuthUser, l: Lang): Promise<Pick<AssistantReply, 'reply' | 'data'>> {
    const rows = await this.db.query<{ id: string; status: string; pickup_address: string; dropoff_address: string; fare: number; requested_at: Date }>(
      `SELECT id, status, pickup_address, dropoff_address, COALESCE(final_fare, offered_fare - discount_amount) AS fare, requested_at FROM rides WHERE passenger_id = $1 ORDER BY requested_at DESC LIMIT 3`, [user.id]);
    if (!rows.length) return { reply: l === 'en' ? 'You have not taken any rides yet.' : t('no_active', l) };
    return {
      reply: rows.map((r) => `${r.requested_at.toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short' })}: ${r.pickup_address.split(',')[0]} to ${r.dropoff_address.split(',')[0]}, Rs ${r.fare} (${r.status.toLowerCase()})`).join('. '),
      data: { rides: rows.map((r) => ({ id: r.id, status: r.status, fare: r.fare })) },
    };
  }

  private async cancelIntent(user: AuthUser, l: Lang, channel: 'VOICE' | 'ASSISTANT'): Promise<Pick<AssistantReply, 'reply' | 'pendingAction'>> {
    const ride = await this.rideRepo.activeForPassenger(user.id);
    if (!ride) return { reply: t('no_active', l) };
    const cfg = await this.pricing.config(ride.city_id, ride.product_code);
    const secs = ride.assigned_at ? (Date.now() - ride.assigned_at.getTime()) / 1000 : 0;
    const fee = ride.driver_id && secs > cfg.freeCancelSeconds ? cfg.cancellationFee : 0;
    const summary = fee > 0 ? `Cancel your ride to ${ride.dropoff_address.split(',')[0]}? A cancellation fee of Rs ${fee} applies because your driver has been on the way for a while.` : `Cancel your ride to ${ride.dropoff_address.split(',')[0]}? There is no fee.`;
    const pending = await this.savePending({ userId: user.id, type: 'CANCEL_RIDE', channel, lang: l, payload: { rideId: ride.id, reason: 'CHANGED_MIND' } }, summary);
    return { reply: summary, pendingAction: pending };
  }

  // --------------------------------------------------------------- confirmation
  private async savePending(p: PendingAction, summary: string) {
    const token = randomToken(24);
    await this.redis.client.set(`assistant:pending:${token}`, JSON.stringify({ ...p, summary }), 'EX', PENDING_TTL_S);
    return { token, type: p.type, summary, expiresInS: PENDING_TTL_S };
  }

  /** Single-use: the token is consumed atomically before anything executes, so a double tap cannot double book. */
  async confirm(user: AuthUser, token: string, paymentOverride?: 'CASH' | 'WALLET' | 'CARD') {
    const raw = await this.redis.client.getdel(`assistant:pending:${token}`);
    if (!raw) throw AppError.conflict('ACTION_EXPIRED', 'This request expired or was already used. Please ask again.');
    const p = JSON.parse(raw) as PendingAction & { summary: string };
    if (p.userId !== user.id) throw AppError.forbidden();
    const pl = p.payload as { quoteId: string; productCode: string; fare: number; paymentMethod: 'CASH' | 'WALLET' | 'CARD'; pickup: PlaceRef; dropoff: PlaceRef; pickupAt: string | null; rideId?: string; reason?: string };
    const paymentMethod = paymentOverride ?? pl.paymentMethod;

    if (p.type === 'CANCEL_RIDE') {
      const res = await this.rides.cancelByPassenger(user, pl.rideId!, { reason: pl.reason ?? 'CHANGED_MIND' });
      return { executed: 'CANCEL_RIDE', ...res };
    }
    if (p.type === 'SCHEDULE_RIDE') {
      const scheduled = await this.scheduling.create(user, { pickup: pl.pickup, dropoff: pl.dropoff, productCode: pl.productCode, paymentMethod, pickupAt: pl.pickupAt! }, p.channel);
      return { executed: 'SCHEDULE_RIDE', scheduledRide: scheduled };
    }
    // BOOK_RIDE: use the quote the user saw; if it expired, re-quote and only proceed when the price did not rise materially
    let quoteId = pl.quoteId;
    let fare = pl.fare;
    const stored = await this.db.one<{ expires_at: Date }>(`SELECT expires_at FROM ride_quotes WHERE id = $1 AND passenger_id = $2`, [quoteId, user.id]);
    if (!stored || stored.expires_at.getTime() < Date.now()) {
      const fresh = await this.pricing.quote(user.id, pl.pickup, pl.dropoff);
      const opt = fresh.options.find((o) => o.productCode === pl.productCode);
      if (!opt) throw AppError.unprocessable('PRODUCT_UNAVAILABLE', 'That ride type is no longer available. Please ask again.');
      if (opt.fare.recommended > pl.fare * 1.05) {
        const summary = `The price changed to Rs ${opt.fare.recommended} (you were quoted Rs ${pl.fare}). Book at the new price?`;
        const pending = await this.savePending({ ...p, payload: { ...pl, quoteId: fresh.id, fare: opt.fare.recommended } }, summary);
        return { executed: null, priceChanged: true, reply: summary, pendingAction: pending };
      }
      quoteId = fresh.id;
      fare = Math.max(pl.fare, opt.fare.minimumReasonable);
    }
    const ride = await this.rides.request(user, { quoteId, productCode: pl.productCode, offeredFare: fare, paymentMethod });
    return { executed: 'BOOK_RIDE', ride };
  }

  // --------------------------------------------------------------- voice contract
  async voiceParse(user: AuthUser, transcript: string, opts: { loc?: LatLng; locale?: string }) {
    const r = await this.message(user, transcript, { ...opts, channel: 'VOICE' });
    return {
      language: r.language,
      intent: r.intent,
      confidence: r.confidence,
      pickup: r.parsed?.pickup ?? null,
      dropoff: r.parsed?.dropoff ?? null,
      when: r.parsed?.when ?? null,
      productCode: r.parsed?.productCode ?? null,
      missing: r.missing,
      options: r.options,
      confirmationText: r.reply,
      pendingAction: r.pendingAction,
      note: 'Nothing has been booked. Confirm the pending action to proceed.',
    };
  }
}

const short = (p: PlaceRef) => p.address.split(',').slice(0, 2).join(',').trim();
