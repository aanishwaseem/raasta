/* eslint-disable no-console */
import * as argon2 from 'argon2';
import { Client } from 'pg';
import { config } from '../../config/config';
import { CITIES, PRODUCTS, TARIFFS } from './reference-data';

/**
 * Seeds reference data (cities, zones, places, products, tariffs) and clearly-marked TEST accounts.
 * All demo users/drivers/companies carry is_test_data = true and @raasta.test emails. Never run against production.
 */
const TEST_PASSWORD = process.env.SEED_TEST_PASSWORD ?? 'Passw0rd!test';

const rect = (lat: number, lng: number, d: number) =>
  `POLYGON((${lng - d} ${lat - d}, ${lng + d} ${lat - d}, ${lng + d} ${lat + d}, ${lng - d} ${lat + d}, ${lng - d} ${lat - d}))`;
const point = (lat: number, lng: number) => `SRID=4326;POINT(${lng} ${lat})`;

export async function seed(databaseUrl = config().DATABASE_URL, opts: { quiet?: boolean; testData?: boolean } = {}) {
  if (config().NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
  const log = (m: string) => !opts.quiet && console.log(m);
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  const hash = await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2 });
  try {
    await db.query('BEGIN');
    const cityIds: Record<string, string> = {};
    for (const c of CITIES) {
      const r = await db.query(
        `INSERT INTO cities (slug, name, name_ur, center, settings) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [c.slug, c.name, c.nameUr, point(c.center[0], c.center[1]), JSON.stringify({ safety: { deviationMeters: 500 } })],
      );
      const id = r.rows[0].id as string;
      cityIds[c.slug] = id;
      if (!(await db.query('SELECT 1 FROM service_areas WHERE city_id = $1', [id])).rowCount) {
        await db.query(`INSERT INTO service_areas (city_id, name, kind, boundary) VALUES ($1,$2,'SERVICE',ST_GeogFromText($3))`, [
          id,
          `${c.name} service area`,
          `SRID=4326;POLYGON((${c.bbox[1]} ${c.bbox[0]}, ${c.bbox[3]} ${c.bbox[0]}, ${c.bbox[3]} ${c.bbox[2]}, ${c.bbox[1]} ${c.bbox[2]}, ${c.bbox[1]} ${c.bbox[0]}))`,
        ]);
      }
      for (const [code, name, lat, lng] of c.zones) {
        await db.query(
          `INSERT INTO demand_zones (city_id, code, name, boundary, centroid) VALUES ($1,$2,$3,ST_GeogFromText($4),ST_GeogFromText($5))
           ON CONFLICT (city_id, code) DO NOTHING`,
          [id, code, name, `SRID=4326;${rect(lat, lng, 0.018)}`, point(lat, lng)],
        );
      }
      if (!(await db.query('SELECT 1 FROM places WHERE city_id = $1 LIMIT 1', [id])).rowCount) {
        for (const p of c.places) {
          await db.query(
            `INSERT INTO places (city_id, name, aliases, category, address, location, search_text, popularity)
             VALUES ($1,$2,$3,$4,$5,ST_GeogFromText($6),$7,$8)`,
            [id, p.name, p.aliases, p.category, p.address, point(p.lat, p.lng), [p.name, ...p.aliases, p.address].join(' ').toLowerCase(), p.popularity],
          );
        }
      }
      log(`city ${c.name}: ${c.zones.length} zones, ${c.places.length} places`);
    }
    for (const p of PRODUCTS) {
      await db.query(
        `INSERT INTO ride_products (code, name, description, vehicle_class, capacity, is_shared, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (code) DO NOTHING`,
        [p.code, p.name, p.description, p.vehicleClass, p.capacity, p.isShared, p.sort],
      );
      const t = TARIFFS[p.code];
      for (const cityId of Object.values(cityIds)) {
        await db.query(
          `INSERT INTO pricing_configs (city_id, product_code, base_fare, per_km, per_minute, minimum_fare, booking_fee, fuel_cost_per_km, shared_discount_pct, cancellation_fee, free_cancel_seconds)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,120) ON CONFLICT (city_id, product_code) DO NOTHING`,
          [cityId, p.code, t.base, t.perKm, t.perMin, t.min, t.booking, t.fuel, t.sharedDiscount ?? 0, p.code === 'BIKE' ? 50 : 100],
        );
      }
    }
    const pairs: Array<[string, string, number, number, number]> = [
      ['lahore', 'islamabad', 375, 270, 1600],
      ['islamabad', 'lahore', 375, 270, 1600],
      ['lahore', 'karachi', 1210, 960, 4500],
    ];
    for (const [o, d, km, min, fare] of pairs) {
      await db.query(
        `INSERT INTO intercity_routes (origin_city_id, dest_city_id, distance_km, typical_duration_min, suggested_seat_fare)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (origin_city_id, dest_city_id) DO NOTHING`,
        [cityIds[o], cityIds[d], km, min, fare],
      );
    }
    await db.query(
      `INSERT INTO promotions (code, name, kind, discount_type, discount_value, max_discount, min_fare, starts_at, ends_at, usage_limit_per_user, new_users_only)
       SELECT 'WELCOME100','Welcome: Rs 100 off your first ride (TEST PROMO)','FIRST_RIDE','FLAT',100,100,200, now() - interval '1 day', now() + interval '365 days',1,true
        WHERE NOT EXISTS (SELECT 1 FROM promotions WHERE code = 'WELCOME100')`,
    );
    await db.query(
      `INSERT INTO promotions (code, name, kind, discount_type, discount_value, max_discount, min_fare, starts_at, ends_at, usage_limit_per_user)
       SELECT 'SAVE15','15% off up to Rs 150 (TEST PROMO)','PROMO','PERCENT',15,150,250, now() - interval '1 day', now() + interval '365 days',5
        WHERE NOT EXISTS (SELECT 1 FROM promotions WHERE code = 'SAVE15')`,
    );

    if (opts.testData !== false) await seedTestData(db, cityIds, hash, log);
    await db.query('COMMIT');
    log('seed complete');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

async function user(db: Client, o: { name: string; email: string; phone: string; roles: string[]; hash: string; gender?: string; cityId: string; referral: string }): Promise<string> {
  const existing = await db.query('SELECT id FROM users WHERE lower(email) = lower($1)', [o.email]);
  if (existing.rowCount) return existing.rows[0].id;
  const r = await db.query(
    `INSERT INTO users (full_name, email, email_verified_at, phone, phone_verified_at, password_hash, gender, home_city_id, referral_code, is_test_data)
     VALUES ($1,$2,now(),$3,now(),$4,$5,$6,$7,true) RETURNING id`,
    [o.name, o.email, o.phone, o.hash, o.gender ?? 'UNDISCLOSED', o.cityId, o.referral],
  );
  const id = r.rows[0].id as string;
  for (const role of o.roles) await db.query('INSERT INTO user_roles (user_id, role) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, role]);
  return id;
}

async function seedTestData(db: Client, cityIds: Record<string, string>, hash: string, log: (m: string) => void) {
  const lhr = cityIds.lahore;
  await user(db, { name: 'Test Admin', email: 'admin@raasta.test', phone: '+923000000001', roles: ['ADMIN'], hash, cityId: lhr, referral: 'TADMIN01' });
  await user(db, { name: 'Test Support', email: 'support@raasta.test', phone: '+923000000002', roles: ['SUPPORT'], hash, cityId: lhr, referral: 'TSUPP001' });
  const corpAdmin = await user(db, { name: 'Test Company Admin', email: 'corpadmin@raasta.test', phone: '+923000000003', roles: ['PASSENGER', 'CORPORATE_ADMIN'], hash, cityId: lhr, referral: 'TCORP001' });
  const ali = await user(db, { name: 'Ayesha Khan', email: 'ayesha@raasta.test', phone: '+923001110001', roles: ['PASSENGER'], hash, gender: 'FEMALE', cityId: lhr, referral: 'TAYESHA1' });
  const bilal = await user(db, { name: 'Bilal Ahmed', email: 'bilal@raasta.test', phone: '+923001110002', roles: ['PASSENGER'], hash, gender: 'MALE', cityId: lhr, referral: 'TBILAL01' });
  await user(db, { name: 'Sana Malik', email: 'sana@raasta.test', phone: '+923001110003', roles: ['PASSENGER'], hash, gender: 'FEMALE', cityId: lhr, referral: 'TSANA001' });

  const corp = await db.query(`SELECT id FROM corporate_accounts WHERE name = 'Test Software House (TEST DATA)'`);
  if (!corp.rowCount) {
    const r = await db.query(
      `INSERT INTO corporate_accounts (name, industry, billing_email, city_id, monthly_budget, is_test_data) VALUES ('Test Software House (TEST DATA)','SOFTWARE','billing@raasta.test',$1,200000,true) RETURNING id`,
      [lhr],
    );
    const corpId: string = r.rows[0].id;
    await db.query(`INSERT INTO corporate_policies (corporate_id, allowed_products, max_fare_per_ride, require_purpose) VALUES ($1,'{ECONOMY,COMFORT}',2500,true)`, [corpId]);
    await db.query(`INSERT INTO corporate_users (corporate_id, user_id, role, monthly_limit) VALUES ($1,$2,'ADMIN',0),($1,$3,'EMPLOYEE',30000)`, [corpId, corpAdmin, ali]);
  }

  const drivers: Array<[string, string, string, string, string, string, string, string]> = [
    // name, email, phone, make, model, plate, class, gender
    ['Usman Tariq', 'usman@raasta.test', '+923002220001', 'Suzuki', 'Cultus', 'LEA-19-1001', 'ECONOMY', 'MALE'],
    ['Hamza Raza', 'hamza@raasta.test', '+923002220002', 'Suzuki', 'Alto', 'LEB-20-2002', 'ECONOMY', 'MALE'],
    ['Farah Nadeem', 'farah@raasta.test', '+923002220003', 'Toyota', 'Yaris', 'LED-21-3003', 'COMFORT', 'FEMALE'],
    ['Kamran Ali', 'kamran@raasta.test', '+923002220004', 'Honda', 'City', 'LEC-22-4004', 'COMFORT', 'MALE'],
    ['Imran Sheikh', 'imran@raasta.test', '+923002220005', 'Toyota', 'Hiace', 'LEE-18-5005', 'XL', 'MALE'],
    ['Adeel Hussain', 'adeel@raasta.test', '+923002220006', 'Honda', 'CD70', 'LEF-23-6006', 'BIKE', 'MALE'],
  ];
  for (const [name, email, phone, make, model, plate, vclass, gender] of drivers) {
    const id = await user(db, { name, email, phone, roles: ['DRIVER'], hash, gender, cityId: lhr, referral: `TD${plate.slice(-4)}` });
    await db.query('INSERT INTO drivers (user_id, city_id, is_test_data) VALUES ($1,$2,true) ON CONFLICT DO NOTHING', [id, lhr]);
    const has = await db.query('SELECT 1 FROM vehicles WHERE driver_id = $1', [id]);
    if (has.rowCount) continue;
    const seats = vclass === 'BIKE' ? 1 : vclass === 'XL' ? 8 : 4;
    const v = await db.query(
      `INSERT INTO vehicles (driver_id, vehicle_class, make, model, year, color, plate_number, seats, status) VALUES ($1,$2,$3,$4,2021,'White',$5,$6,'APPROVED') RETURNING id`,
      [id, vclass, make, model, plate, seats],
    );
    await db.query(
      `UPDATE drivers SET city_id = $2, status = 'APPROVED', onboarding_step = 'ACTIVE', current_vehicle_id = $3, approved_at = now(), training_acknowledged_at = now(), is_test_data = true,
              cnic_last4 = '0000' WHERE user_id = $1`,
      [id, lhr, v.rows[0].id],
    );
    await db.query(`INSERT INTO driver_stats (driver_id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
  }
  // wallet top-up for the test passenger, posted as a balanced immutable ledger transaction
  const w = async (type: string, owner: string | null) => {
    const r = await db.query(
      `INSERT INTO wallets (owner_type, owner_id) VALUES ($1,$2) ON CONFLICT (owner_type, owner_id, currency) DO UPDATE SET owner_type = EXCLUDED.owner_type RETURNING id`,
      [type, owner],
    );
    return r.rows[0].id as string;
  };
  const gateway = await w('PAYMENT_GATEWAY', null);
  const bilalWallet = await w('PASSENGER', bilal);
  const tx = await db.query(
    `INSERT INTO ledger_transactions (kind, idempotency_key, description) VALUES ('TOPUP','seed-topup-bilal','Seed: TEST wallet funds') ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
  );
  if (tx.rowCount) {
    await db.query(`INSERT INTO wallet_transactions (transaction_id, wallet_id, bucket, amount) VALUES ($1,$2,'AVAILABLE',-5000),($1,$3,'AVAILABLE',5000)`, [tx.rows[0].id, gateway, bilalWallet]);
  }
  log(`test data: 3 staff, 3 passengers, ${drivers.length} drivers, 1 company (password "${TEST_PASSWORD}")`);
}

if (require.main === module) {
  seed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
