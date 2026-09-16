// SQL migration runner.
//
// Migrations live in /migrations as pairs of files:
//   0001_init.up.sql    applied by `pnpm db:migrate`
//   0001_init.down.sql  applied by `pnpm db:rollback` (reverts the last one)
// Applied versions are recorded in the `schema_migrations` table, so running
// `up` twice applies nothing the second time.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from './client.ts';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '..', '..', 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

/** All migration versions available on disk, e.g. ['0001_init'], sorted. */
async function availableVersions(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((file) => file.endsWith('.up.sql'))
    .map((file) => file.replace(/\.up\.sql$/, ''))
    .sort();
}

/** Versions already recorded in the database, sorted. */
async function appliedVersions(): Promise<string[]> {
  const rows = await sql<{ version: string }[]>`SELECT version FROM schema_migrations ORDER BY version`;
  return rows.map((row) => row.version);
}

async function readMigration(version: string, direction: 'up' | 'down'): Promise<string> {
  return readFile(path.join(MIGRATIONS_DIR, `${version}.${direction}.sql`), 'utf8');
}

/** Applies every migration not yet applied, in order. Returns the versions applied. */
export async function migrateUp(): Promise<string[]> {
  await ensureMigrationsTable();
  const applied = new Set(await appliedVersions());
  const pending = (await availableVersions()).filter((version) => !applied.has(version));

  for (const version of pending) {
    const body = await readMigration(version, 'up');
    // The migration and its bookkeeping row succeed or fail together.
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (version) VALUES (${version})`;
    });
  }
  return pending;
}

/** Reverts the most recently applied migration. Returns its version, or null if none. */
export async function migrateDown(): Promise<string | null> {
  await ensureMigrationsTable();
  const last = (await appliedVersions()).at(-1);
  if (!last) return null;

  const body = await readMigration(last, 'down');
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`DELETE FROM schema_migrations WHERE version = ${last}`;
  });
  return last;
}

// CLI entry point: `tsx src/db/migrate.ts up|down`.
const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename;

if (isMain) {
  const direction = process.argv[2];
  try {
    if (direction === 'up') {
      const applied = await migrateUp();
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply');
    } else if (direction === 'down') {
      const reverted = await migrateDown();
      console.log(reverted ? `Reverted: ${reverted}` : 'Nothing to revert');
    } else {
      console.error('Usage: tsx src/db/migrate.ts up|down');
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}
