import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from './db/client.ts';
import { migrateUp } from './db/migrate.ts';
import { upsertNotice } from './dedup/upsert.ts';
import type { NormalizedNotice } from './domain/notice.ts';
import { parseBoampXml } from './sources/boamp/parse.ts';
import { parsePlatformHtml, type PlatformPageMeta } from './sources/platform/parse.ts';
import { registerSources } from './sources/register.ts';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '..', 'fixtures');

async function main(): Promise<void> {
  const applied = await migrateUp();
  if (applied.length) console.log(`Migrations applied: ${applied.join(', ')}`);
  await registerSources();

  const notices = await loadNotices();
  let created = 0;
  let merged = 0;
  let failed = 0;

  for (const notice of notices) {
    try {
      const result = await upsertNotice(notice);
      if (result.warning) console.warn(result.warning);
      if (result.created) created += 1;
      else merged += 1;
    } catch (error) {
      failed += 1;
      console.error(`Failed ${notice.source}:${notice.externalId}`, error);
    }
  }

  const [{ tenders }] = await sql<{ tenders: number }[]>`SELECT COUNT(*)::int AS tenders FROM tenders`;
  const [{ notices: noticeCount }] = await sql<{ notices: number }[]>`
    SELECT COUNT(*)::int AS notices FROM tender_sources
  `;
  const [{ both }] = await sql<{ both: number }[]>`
    SELECT COUNT(*)::int AS both FROM (
      SELECT tender_id FROM tender_sources GROUP BY tender_id HAVING COUNT(*) > 1
    ) t
  `;

  console.log(
    `Ingested ${noticeCount} notices into ${tenders} tenders (${both} from more than one source).`,
  );
  console.log(`This run: ${created} created, ${merged} attached to an existing tender, ${failed} failed.`);
}

async function loadNotices(): Promise<NormalizedNotice[]> {
  const notices: NormalizedNotice[] = [];

  const boampDir = path.join(FIXTURES_DIR, 'boamp');
  const xmlFiles = (await readdir(boampDir)).filter((file) => file.endsWith('.xml')).sort();
  for (const file of xmlFiles) {
    notices.push(parseBoampXml(await readFile(path.join(boampDir, file), 'utf8')));
  }

  const platformDir = path.join(FIXTURES_DIR, 'platform');
  const pagesJson = JSON.parse(await readFile(path.join(platformDir, 'pages.json'), 'utf8')) as {
    pages: PlatformPageMeta[];
  };
  for (const page of pagesJson.pages) {
    notices.push(parsePlatformHtml(await readFile(path.join(platformDir, page.file), 'utf8'), page));
  }

  console.log(`BOAMP notices: ${xmlFiles.length}`);
  console.log(`Platform pages: ${pagesJson.pages.length}`);
  return notices;
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
