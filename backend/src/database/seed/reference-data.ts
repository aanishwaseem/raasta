/** Reference geography and catalogue data. Coordinates are approximate neighbourhood centres. */
export interface CitySeed {
  slug: string;
  name: string;
  nameUr: string;
  center: [number, number]; // lat, lng
  bbox: [number, number, number, number]; // minLat, minLng, maxLat, maxLng
  zones: Array<[string, string, number, number]>; // code, name, lat, lng
  places: Array<{ name: string; aliases: string[]; category: string; lat: number; lng: number; address: string; popularity: number }>;
}

export const CITIES: CitySeed[] = [
  {
    slug: 'lahore',
    name: 'Lahore',
    nameUr: 'لاہور',
    center: [31.5204, 74.3587],
    bbox: [31.3, 74.15, 31.7, 74.55],
    zones: [
      ['LHR-GULBERG', 'Gulberg', 31.5102, 74.3441],
      ['LHR-JOHAR', 'Johar Town', 31.4697, 74.2728],
      ['LHR-DHA', 'DHA Phase 5', 31.4697, 74.4011],
      ['LHR-MODEL', 'Model Town', 31.4832, 74.3236],
      ['LHR-DOWNTOWN', 'Mall Road & Anarkali', 31.5597, 74.3265],
      ['LHR-AIRPORT', 'Allama Iqbal Airport', 31.5216, 74.4036],
      ['LHR-WAPDA', 'WAPDA Town', 31.4358, 74.2694],
      ['LHR-BAHRIA', 'Bahria Town', 31.3686, 74.1866],
    ],
    places: [
      { name: 'Liberty Market', aliases: ['liberty', 'لبرٹی مارکیٹ'], category: 'MARKET', lat: 31.5102, lng: 74.3441, address: 'Liberty Market, Gulberg III, Lahore', popularity: 95 },
      { name: 'Emporium Mall', aliases: ['emporium', 'ایمپوریم مال'], category: 'MALL', lat: 31.4672, lng: 74.2651, address: 'Emporium Mall, Abdul Haq Rd, Johar Town, Lahore', popularity: 90 },
      { name: 'Packages Mall', aliases: ['packages', 'پیکجز مال'], category: 'MALL', lat: 31.4708, lng: 74.3552, address: 'Packages Mall, Walton Rd, Lahore', popularity: 85 },
      { name: 'Allama Iqbal International Airport', aliases: ['airport', 'lahore airport', 'ائیرپورٹ', 'ہوائی اڈہ'], category: 'AIRPORT', lat: 31.5216, lng: 74.4036, address: 'Allama Iqbal International Airport, Lahore', popularity: 92 },
      { name: 'Lahore Railway Station', aliases: ['railway station', 'station', 'ریلوے اسٹیشن'], category: 'TRANSIT', lat: 31.5776, lng: 74.3358, address: 'Lahore Junction Railway Station', popularity: 80 },
      { name: 'Badshahi Mosque', aliases: ['badshahi', 'بادشاہی مسجد'], category: 'LANDMARK', lat: 31.588, lng: 74.3104, address: 'Badshahi Mosque, Walled City, Lahore', popularity: 70 },
      { name: 'Lahore Fort', aliases: ['fort', 'shahi qila', 'شاہی قلعہ'], category: 'LANDMARK', lat: 31.5889, lng: 74.3155, address: 'Lahore Fort, Walled City', popularity: 60 },
      { name: 'Minar-e-Pakistan', aliases: ['minar', 'minar e pakistan', 'مینار پاکستان'], category: 'LANDMARK', lat: 31.5925, lng: 74.3095, address: 'Iqbal Park, Lahore', popularity: 65 },
      { name: 'Gaddafi Stadium', aliases: ['gaddafi', 'stadium', 'قذافی اسٹیڈیم'], category: 'LANDMARK', lat: 31.5131, lng: 74.3338, address: 'Gaddafi Stadium, Ferozepur Rd, Lahore', popularity: 55 },
      { name: 'Lahore University of Management Sciences (LUMS)', aliases: ['lums', 'لمز'], category: 'UNIVERSITY', lat: 31.4704, lng: 74.4095, address: 'LUMS, DHA Phase 5, Lahore', popularity: 75 },
      { name: 'University of the Punjab', aliases: ['punjab university', 'pu', 'پنجاب یونیورسٹی'], category: 'UNIVERSITY', lat: 31.5009, lng: 74.3052, address: 'Quaid-e-Azam Campus, Lahore', popularity: 70 },
      { name: 'Johar Town', aliases: ['johar', 'جوہر ٹاؤن'], category: 'AREA', lat: 31.4697, lng: 74.2728, address: 'Johar Town, Lahore', popularity: 88 },
      { name: 'Gulberg III', aliases: ['gulberg', 'گلبرگ'], category: 'AREA', lat: 31.5125, lng: 74.3475, address: 'Gulberg III, Lahore', popularity: 90 },
      { name: 'DHA Phase 5', aliases: ['dha', 'defence', 'ڈیفنس', 'ڈی ایچ اے'], category: 'AREA', lat: 31.4697, lng: 74.4011, address: 'DHA Phase 5, Lahore', popularity: 86 },
      { name: 'Model Town', aliases: ['model town', 'ماڈل ٹاؤن'], category: 'AREA', lat: 31.4832, lng: 74.3236, address: 'Model Town, Lahore', popularity: 72 },
      { name: 'Mall Road', aliases: ['the mall', 'مال روڈ'], category: 'AREA', lat: 31.5597, lng: 74.3265, address: 'Mall Road, Lahore', popularity: 68 },
      { name: 'Anarkali Bazaar', aliases: ['anarkali', 'انارکلی'], category: 'MARKET', lat: 31.5669, lng: 74.3089, address: 'Anarkali Bazaar, Lahore', popularity: 58 },
      { name: 'Wapda Town', aliases: ['wapda', 'واپڈا ٹاؤن'], category: 'AREA', lat: 31.4358, lng: 74.2694, address: 'WAPDA Town, Lahore', popularity: 62 },
      { name: 'Bahria Town Lahore', aliases: ['bahria', 'بحریہ ٹاؤن'], category: 'AREA', lat: 31.3686, lng: 74.1866, address: 'Bahria Town, Lahore', popularity: 66 },
      { name: 'Ichhra', aliases: ['اچھرہ'], category: 'AREA', lat: 31.5316, lng: 74.3175, address: 'Ichhra, Lahore', popularity: 50 },
      { name: 'Arfa Software Technology Park', aliases: ['arfa tower', 'arfa', 'ارفع ٹاور'], category: 'OFFICE', lat: 31.4943, lng: 74.3387, address: 'Arfa Software Technology Park, Ferozepur Rd, Lahore', popularity: 74 },
      { name: 'Lahore General Hospital', aliases: ['general hospital', 'جنرل ہسپتال'], category: 'HOSPITAL', lat: 31.5113, lng: 74.3221, address: 'Lahore General Hospital, Jail Rd', popularity: 52 },
      { name: 'Shaukat Khanum Hospital', aliases: ['shaukat khanum', 'skmch', 'شوکت خانم'], category: 'HOSPITAL', lat: 31.4445, lng: 74.2651, address: 'Shaukat Khanum Memorial Cancer Hospital, Johar Town', popularity: 64 },
      { name: 'Expo Centre Lahore', aliases: ['expo centre', 'expo', 'ایکسپو سینٹر'], category: 'LANDMARK', lat: 31.4585, lng: 74.3001, address: 'Expo Centre, Johar Town, Lahore', popularity: 57 },
    ],
  },
  {
    slug: 'karachi',
    name: 'Karachi',
    nameUr: 'کراچی',
    center: [24.8607, 67.0011],
    bbox: [24.75, 66.85, 25.05, 67.3],
    zones: [
      ['KHI-CLIFTON', 'Clifton', 24.8138, 67.0299],
      ['KHI-DHA', 'DHA', 24.8, 67.0629],
      ['KHI-SADDAR', 'Saddar', 24.8608, 67.0104],
      ['KHI-GULSHAN', 'Gulshan-e-Iqbal', 24.9215, 67.0927],
      ['KHI-AIRPORT', 'Jinnah Airport', 24.9065, 67.1608],
    ],
    places: [
      { name: 'Jinnah International Airport', aliases: ['karachi airport', 'airport', 'ائیرپورٹ'], category: 'AIRPORT', lat: 24.9065, lng: 67.1608, address: 'Jinnah International Airport, Karachi', popularity: 92 },
      { name: 'Dolmen Mall Clifton', aliases: ['dolmen', 'dolmen clifton', 'ڈولمین مال'], category: 'MALL', lat: 24.8, lng: 67.0295, address: 'Dolmen Mall, Clifton, Karachi', popularity: 88 },
      { name: 'Clifton', aliases: ['کلفٹن'], category: 'AREA', lat: 24.8138, lng: 67.0299, address: 'Clifton, Karachi', popularity: 86 },
      { name: 'Saddar', aliases: ['صدر'], category: 'AREA', lat: 24.8608, lng: 67.0104, address: 'Saddar, Karachi', popularity: 70 },
      { name: 'Karachi Cantt Station', aliases: ['cantt station', 'کینٹ اسٹیشن'], category: 'TRANSIT', lat: 24.8536, lng: 67.0362, address: 'Karachi Cantonment Railway Station', popularity: 60 },
      { name: 'Gulshan-e-Iqbal', aliases: ['gulshan', 'گلشن اقبال'], category: 'AREA', lat: 24.9215, lng: 67.0927, address: 'Gulshan-e-Iqbal, Karachi', popularity: 75 },
      { name: 'Quaid-e-Azam Mausoleum', aliases: ['mazar e quaid', 'مزار قائد'], category: 'LANDMARK', lat: 24.8755, lng: 67.0389, address: 'Mazar-e-Quaid, Karachi', popularity: 62 },
      { name: 'Port Grand', aliases: ['port grand'], category: 'LANDMARK', lat: 24.8463, lng: 66.9989, address: 'Port Grand, Native Jetty, Karachi', popularity: 50 },
    ],
  },
  {
    slug: 'islamabad',
    name: 'Islamabad',
    nameUr: 'اسلام آباد',
    center: [33.6844, 73.0479],
    bbox: [33.45, 72.8, 33.8, 73.25],
    zones: [
      ['ISB-BLUEAREA', 'Blue Area', 33.7103, 73.0551],
      ['ISB-F7', 'F-7 Markaz', 33.7215, 73.0563],
      ['ISB-G11', 'G-11', 33.6687, 72.9809],
      ['ISB-RWP', 'Rawalpindi Saddar', 33.5973, 73.0479],
    ],
    places: [
      { name: 'Islamabad International Airport', aliases: ['islamabad airport', 'airport', 'ائیرپورٹ'], category: 'AIRPORT', lat: 33.5605, lng: 72.8495, address: 'Islamabad International Airport', popularity: 90 },
      { name: 'Centaurus Mall', aliases: ['centaurus', 'سینٹورس'], category: 'MALL', lat: 33.7085, lng: 73.0507, address: 'Centaurus Mall, Jinnah Avenue, Islamabad', popularity: 88 },
      { name: 'Faisal Mosque', aliases: ['faisal masjid', 'فیصل مسجد'], category: 'LANDMARK', lat: 33.7295, lng: 73.0372, address: 'Faisal Mosque, Islamabad', popularity: 80 },
      { name: 'F-7 Markaz', aliases: ['f7', 'ایف سیون'], category: 'AREA', lat: 33.7215, lng: 73.0563, address: 'F-7 Markaz, Islamabad', popularity: 78 },
      { name: 'Blue Area', aliases: ['blue area', 'بلیو ایریا'], category: 'AREA', lat: 33.7103, lng: 73.0551, address: 'Blue Area, Islamabad', popularity: 82 },
      { name: 'Pakistan Monument', aliases: ['monument'], category: 'LANDMARK', lat: 33.6931, lng: 73.0683, address: 'Pakistan Monument, Islamabad', popularity: 60 },
      { name: 'Saddar Rawalpindi', aliases: ['rawalpindi', 'راولپنڈی'], category: 'AREA', lat: 33.5973, lng: 73.0479, address: 'Saddar, Rawalpindi', popularity: 65 },
      { name: 'Giga Mall', aliases: ['giga', 'گیگا مال'], category: 'MALL', lat: 33.5184, lng: 73.1029, address: 'Giga Mall, DHA II', popularity: 55 },
    ],
  },
];

export const PRODUCTS = [
  { code: 'BIKE', name: 'Bike', description: 'Fast and affordable for one rider', vehicleClass: 'BIKE', capacity: 1, isShared: false, sort: 1 },
  { code: 'ECONOMY', name: 'Economy', description: 'Everyday affordable car rides', vehicleClass: 'ECONOMY', capacity: 4, isShared: false, sort: 2 },
  { code: 'COMFORT', name: 'Comfort', description: 'Newer cars with air conditioning', vehicleClass: 'COMFORT', capacity: 4, isShared: false, sort: 3 },
  { code: 'XL', name: 'XL', description: 'Extra space for groups up to 6', vehicleClass: 'XL', capacity: 6, isShared: false, sort: 4 },
  { code: 'SHARED', name: 'Shared', description: 'Share the ride and split the cost', vehicleClass: 'ECONOMY', capacity: 3, isShared: true, sort: 5 },
] as const;

// Illustrative starting tariffs (PKR). These are configuration, not market research: admins tune them per city.
export const TARIFFS: Record<string, { base: number; perKm: number; perMin: number; min: number; booking: number; fuel: number; sharedDiscount?: number }> = {
  BIKE: { base: 40, perKm: 18, perMin: 1.2, min: 100, booking: 10, fuel: 7 },
  ECONOMY: { base: 80, perKm: 32, perMin: 2.5, min: 200, booking: 15, fuel: 14 },
  COMFORT: { base: 110, perKm: 42, perMin: 3.2, min: 280, booking: 20, fuel: 16 },
  XL: { base: 140, perKm: 52, perMin: 3.8, min: 350, booking: 25, fuel: 20 },
  SHARED: { base: 80, perKm: 32, perMin: 2.5, min: 160, booking: 10, fuel: 14, sharedDiscount: 25 },
};
