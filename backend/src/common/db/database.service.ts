import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { config } from '../../config/config';

// bigint (int8) -> number. Ledger sums stay far below 2^53 PKR.
types.setTypeParser(20, (v) => Number(v));
// numeric -> number
types.setTypeParser(1700, (v) => Number(v));

export type Queryable = Pick<PoolClient, 'query'>;

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: config().DATABASE_URL,
      max: config().DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
    });
    this.pool.on('error', (err) => this.logger.error(`Postgres pool error: ${err.message}`));
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = [], client?: Queryable): Promise<T[]> {
    const res = await (client ?? this.pool).query<T>(sql, params);
    return res.rows;
  }

  async one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = [], client?: Queryable): Promise<T | null> {
    const rows = await this.query<T>(sql, params, client);
    return rows[0] ?? null;
  }

  /** Runs fn inside a transaction; commits on success, rolls back on any error. */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/** SQL fragment for a geography point from lat/lng params: pass [lng, lat] positions. */
export const geoPoint = (lngParam: number, latParam: number) =>
  `ST_SetSRID(ST_MakePoint($${lngParam}, $${latParam}), 4326)::geography`;
