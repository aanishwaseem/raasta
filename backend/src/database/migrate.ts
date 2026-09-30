/* eslint-disable no-console */
import { promises as fs } from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { createHash } from 'crypto';
import { config } from '../config/config';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

/**
 * Forward-only SQL migrator. Each file runs in its own transaction and is recorded with a checksum;
 * editing an already-applied file is an error (write a new migration instead).
 */
export async function migrate(databaseUrl = config().DATABASE_URL, opts: { reset?: boolean; quiet?: boolean } = {}): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    if (opts.reset) {
      if (config().NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Map(
      (await client.query<{ filename: string; checksum: string }>('SELECT filename, checksum FROM schema_migrations')).rows.map((r) => [
        r.filename,
        r.checksum,
      ]),
    );
    const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prev = done.get(file);
      if (prev) {
        if (prev !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        applied.push(file);
        if (!opts.quiet) console.log(`applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
    if (!opts.quiet) console.log(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date');
    return applied;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  migrate(undefined, { reset: process.argv.includes('--reset') }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
