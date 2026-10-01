export type Lang = 'en' | 'roman-ur' | 'ur';

export const lang = (l?: string | null): Lang => (l === 'ur' ? 'ur' : l === 'roman-ur' ? 'roman-ur' : 'en');

const T = {
  ask_dropoff: {
    en: 'Where would you like to go?',
    'roman-ur': 'Aap kahan jana chahte hain?',
    ur: 'آپ کہاں جانا چاہتے ہیں؟',
  },
  ask_pickup: {
    en: 'Where should the driver pick you up? Share your location or tell me the place.',
    'roman-ur': 'Driver aap ko kahan se pick kare? Apni location share karein ya jagah bata dein.',
    ur: 'ڈرائیور آپ کو کہاں سے لے؟ اپنی لوکیشن شیئر کریں یا جگہ بتائیں۔',
  },
  ask_time: {
    en: 'What time should I schedule the ride for?',
    'roman-ur': 'Ride kis waqt ke liye schedule karun?',
    ur: 'رائیڈ کس وقت کے لیے شیڈول کروں؟',
  },
  which_place: {
    en: 'I found more than one match for "{q}". Which one did you mean?',
    'roman-ur': '"{q}" ke kai matches mile. Aap ka matlab kaunsa hai?',
    ur: '"{q}" کے کئی نتائج ملے۔ آپ کا مطلب کون سا ہے؟',
  },
  not_found: {
    en: 'I could not find "{q}". Try a landmark, mall or area name.',
    'roman-ur': '"{q}" nahi mila. Koi landmark, mall ya area ka naam try karein.',
    ur: '"{q}" نہیں ملا۔ کوئی لینڈ مارک، مال یا علاقے کا نام آزمائیں۔',
  },
  unsure: {
    en: 'I am not sure I understood that, so I have not done anything. Could you say it again, for example "Johar Town to Liberty Market"?',
    'roman-ur': 'Mujhe pakka samajh nahi aaya, is liye maine kuch nahi kiya. Dobara bata dein, jaise "Johar Town se Liberty Market".',
    ur: 'مجھے یقین سے سمجھ نہیں آیا، اس لیے میں نے کچھ نہیں کیا۔ دوبارہ بتائیں، جیسے "جوہر ٹاؤن سے لبرٹی مارکیٹ"۔',
  },
  unavailable: {
    en: 'The voice assistant is temporarily unavailable. You can still book using the map and search.',
    'roman-ur': 'Voice assistant abhi available nahi. Aap map aur search se ride book kar sakte hain.',
    ur: 'وائس اسسٹنٹ فی الحال دستیاب نہیں۔ آپ نقشے اور سرچ سے رائیڈ بک کر سکتے ہیں۔',
  },
  confirm_suffix: {
    en: 'Shall I book it? Nothing is booked until you confirm.',
    'roman-ur': 'Kya main book kar dun? Aap ke confirm karne tak kuch book nahi hota.',
    ur: 'کیا میں بک کر دوں؟ آپ کے تصدیق کرنے تک کچھ بک نہیں ہوتا۔',
  },
  no_active: {
    en: 'You do not have an active ride right now.',
    'roman-ur': 'Abhi aap ki koi active ride nahi hai.',
    ur: 'ابھی آپ کی کوئی فعال رائیڈ نہیں۔',
  },
  safety: {
    en: 'If you are in immediate danger, call 15 now. During a ride you can press SOS in the app to alert your emergency contacts and our safety team. I have not triggered anything automatically.',
    'roman-ur': 'Agar aap fori khatre mein hain to abhi 15 par call karein. Ride ke dauran app mein SOS dabayen, is se aap ke emergency contacts aur hamari safety team ko alert jata hai. Maine khud se kuch trigger nahi kiya.',
    ur: 'اگر آپ فوری خطرے میں ہیں تو ابھی 15 پر کال کریں۔ رائیڈ کے دوران ایپ میں SOS دبائیں، اس سے آپ کے ایمرجنسی کانٹیکٹس اور ہماری سیفٹی ٹیم کو الرٹ جاتا ہے۔ میں نے خود سے کچھ ٹرگر نہیں کیا۔',
  },
  support: {
    en: 'I can open a support ticket for you. Please describe the problem in the Help section and attach the ride if it is about a trip.',
    'roman-ur': 'Aap Help section mein masla likh kar ticket bana sakte hain, agar masla kisi ride ka hai to wo ride select kar lein.',
    ur: 'آپ ہیلپ سیکشن میں مسئلہ لکھ کر ٹکٹ بنا سکتے ہیں، اگر مسئلہ کسی رائیڈ کا ہے تو وہ رائیڈ منتخب کریں۔',
  },
  help: {
    en: 'I can get you a price, book or schedule a ride (always after you confirm), check your ride status, explain a fare, or show recent trips.',
    'roman-ur': 'Main price bata sakta hun, ride book ya schedule kar sakta hun (hamesha aap ke confirm karne ke baad), ride status, fare ki wajah aur purani rides dikha sakta hun.',
    ur: 'میں قیمت بتا سکتا ہوں، رائیڈ بک یا شیڈول کر سکتا ہوں (ہمیشہ آپ کی تصدیق کے بعد)، رائیڈ کی صورتحال، کرایے کی وجہ اور پرانی رائیڈز دکھا سکتا ہوں۔',
  },
} as const;

export function t(key: keyof typeof T, l: Lang, vars: Record<string, string> = {}): string {
  return Object.entries(vars).reduce<string>((s, [k, v]) => s.replace(`{${k}}`, v), T[key][l]);
}

const fmtTime = (d: Date, l: Lang) => d.toLocaleString(l === 'en' ? 'en-GB' : 'en-GB', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });

export function bookSummary(l: Lang, p: { product: string; from: string; to: string; fare: number; low: number; high: number; pickupEtaMin: number | null; payment: string; when?: Date | null }): string {
  const eta = p.pickupEtaMin !== null ? (l === 'en' ? `A driver is about ${p.pickupEtaMin} min away.` : l === 'roman-ur' ? `Driver taqreeban ${p.pickupEtaMin} minute door hai.` : `ڈرائیور تقریباً ${p.pickupEtaMin} منٹ کی دوری پر ہے۔`) : '';
  const when = p.when ? fmtTime(p.when, l) : '';
  if (l === 'roman-ur') return `${p.product} ride ${p.from} se ${p.to}${when ? ` (${when})` : ''}: Rs ${p.fare} (aam taur par Rs ${p.low}-${p.high}), ${p.payment} se payment. ${eta}`.trim();
  if (l === 'ur') return `${p.product} رائیڈ ${p.from} سے ${p.to}${when ? ` (${when})` : ''}: Rs ${p.fare} (عام طور پر Rs ${p.low}-${p.high})، ادائیگی ${p.payment}۔ ${eta}`.trim();
  return `${p.product} ride from ${p.from} to ${p.to}${when ? ` on ${when}` : ''}: Rs ${p.fare} (usually Rs ${p.low}-${p.high}), paying ${p.payment}. ${eta}`.trim();
}
