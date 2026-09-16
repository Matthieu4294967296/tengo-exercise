import { sql } from '../db/client.ts';
import { SOURCES } from './registry.ts';

/** Each adapter registers itself. Adding a source is adding code, not a migration. */
export async function registerSources(): Promise<void> {
  for (const source of Object.values(SOURCES)) {
    await sql`
      INSERT INTO sources (key, display_name, base_url, trust_rank)
      VALUES (${source.key}, ${source.displayName}, ${source.baseUrl}, ${source.trustRank})
      ON CONFLICT (key) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        base_url = EXCLUDED.base_url,
        trust_rank = EXCLUDED.trust_rank
    `;
  }
}
