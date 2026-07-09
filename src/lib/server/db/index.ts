import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = new Database(env.DATABASE_URL);

// WAL improves concurrent reads/writes from multiple devices; enforce FKs.
client.pragma('journal_mode = WAL');
client.pragma('foreign_keys = ON');

export const db = drizzle(client, { schema });

// Apply migrations on boot so a fresh self-hosted container comes up with an
// up-to-date schema and no manual step. Idempotent. The `drizzle/` folder is
// copied into the production image (see Dockerfile).
if (existsSync('./drizzle')) {
	migrate(db, { migrationsFolder: './drizzle' });
}
