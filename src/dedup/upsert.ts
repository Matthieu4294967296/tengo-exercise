import postgres from 'postgres';
import type { NormalizedNotice } from '../domain/notice.ts';
import { normalizeKey } from '../lib/text.ts';
import { sql } from '../db/client.ts';
import { computeMatchKeys, type MatchKey } from './matchKeys.ts';
import { mergeNotices, type MergedTender } from './merge.ts';

export interface UpsertResult {
  tenderId: number;
  created: boolean;
  warning?: string;
}

/**
 * Insert or merge one notice. Same rules as clusterNotices(), against the DB.
 */
export async function upsertNotice(notice: NormalizedNotice): Promise<UpsertResult> {
  return sql.begin(async (tx) => {
    const keys = computeMatchKeys(notice);
    const hits = await lookupTenders(tx, keys);

    if (hits.length === 0) {
      const tenderId = await insertTender(tx, notice, keys);
      return { tenderId, created: true };
    }

    if (hits.length > 1) {
      const chosen = strongestHit(hits);
      const warning = `notice ${notice.source}:${notice.externalId} matches tenders ${hits.map((h) => h.tenderId).join(', ')} (bridge); attaching to ${chosen}`;
      await attachNotice(tx, chosen, notice, keys);
      return { tenderId: chosen, created: false, warning };
    }

    const tenderId = hits[0].tenderId;
    const connecting = hits.filter((h) => h.tenderId === tenderId);
    const best = Math.min(...connecting.map((h) => h.rank));
    if (best === 3 && (await deadlinesDisagree(tx, tenderId, notice))) {
      const warning = `notice ${notice.source}:${notice.externalId} shares buyer+title but deadlines differ; keeping separate`;
      const createdId = await insertTender(tx, notice, keys);
      return { tenderId: createdId, created: true, warning };
    }

    await attachNotice(tx, tenderId, notice, keys);
    return { tenderId, created: false };
  });
}

type Tx = postgres.TransactionSql;

interface KeyHit {
  tenderId: number;
  rank: 1 | 2 | 3;
}

async function lookupTenders(tx: Tx, keys: MatchKey[]): Promise<KeyHit[]> {
  const byTender = new Map<number, KeyHit>();
  for (const key of keys) {
    const rows = await tx<{ tender_id: number }[]>`
      SELECT tender_id FROM tender_match_keys
      WHERE kind = ${key.kind} AND value = ${key.value}
    `;
    for (const row of rows) {
      const existing = byTender.get(row.tender_id);
      if (!existing || key.rank < existing.rank) {
        byTender.set(row.tender_id, { tenderId: row.tender_id, rank: key.rank });
      }
    }
  }
  return [...byTender.values()];
}

function strongestHit(hits: KeyHit[]): number {
  const byTender = new Map<number, number>();
  for (const hit of hits) {
    const current = byTender.get(hit.tenderId) ?? 99;
    if (hit.rank < current) byTender.set(hit.tenderId, hit.rank);
  }
  let bestId = hits[0].tenderId;
  let bestRank = 99;
  for (const [tenderId, rank] of byTender) {
    if (rank < bestRank) {
      bestRank = rank;
      bestId = tenderId;
    }
  }
  return bestId;
}

async function deadlinesDisagree(tx: Tx, tenderId: number, notice: NormalizedNotice): Promise<boolean> {
  if (!notice.responseDeadline) return false;
  const rows = await tx<{ response_deadline: Date | null }[]>`
    SELECT response_deadline FROM tenders WHERE id = ${tenderId}
  `;
  const existing = rows[0]?.response_deadline;
  if (!existing) return false;
  return existing.getTime() !== notice.responseDeadline.getTime();
}

async function insertTender(tx: Tx, notice: NormalizedNotice, keys: MatchKey[]): Promise<number> {
  const merged = mergeNotices([notice]);
  const buyerId = await upsertBuyer(tx, merged);
  const rows = await tx<{ id: number }[]>`
    INSERT INTO tenders (
      buyer_id, title, description, buyer_reference, market_type, procedure,
      publication_date, response_deadline, execution_place, duration
    ) VALUES (
      ${buyerId}, ${merged.title}, ${merged.description ?? null},
      ${merged.buyerReference ?? null}, ${merged.marketType ?? null}, ${merged.procedure ?? null},
      ${merged.publicationDate ?? null}, ${merged.responseDeadline ?? null},
      ${merged.executionPlace ?? null}, ${merged.duration ?? null}
    )
    RETURNING id
  `;
  const tenderId = rows[0].id;
  await writeChildren(tx, tenderId, merged, [notice], keys);
  return tenderId;
}

async function attachNotice(tx: Tx, tenderId: number, notice: NormalizedNotice, keys: MatchKey[]): Promise<void> {
  const existing = await loadNotices(tx, tenderId);
  const others = existing.filter(
    (n) => !(n.source === notice.source && n.externalId === notice.externalId),
  );
  const merged = mergeNotices([...others, notice]);
  const buyerId = await upsertBuyer(tx, merged);
  await tx`
    UPDATE tenders SET
      buyer_id = ${buyerId},
      title = ${merged.title},
      description = ${merged.description ?? null},
      buyer_reference = ${merged.buyerReference ?? null},
      market_type = ${merged.marketType ?? null},
      procedure = ${merged.procedure ?? null},
      publication_date = ${merged.publicationDate ?? null},
      response_deadline = ${merged.responseDeadline ?? null},
      execution_place = ${merged.executionPlace ?? null},
      duration = ${merged.duration ?? null},
      updated_at = now()
    WHERE id = ${tenderId}
  `;
  await writeChildren(tx, tenderId, merged, [...others, notice], keys);
}

async function writeChildren(
  tx: Tx,
  tenderId: number,
  merged: MergedTender,
  notices: NormalizedNotice[],
  keys: MatchKey[],
): Promise<void> {
  for (const key of keys) {
    await tx`
      INSERT INTO tender_match_keys (kind, value, tender_id)
      VALUES (${key.kind}, ${key.value}, ${tenderId})
      ON CONFLICT (kind, value) DO NOTHING
    `;
  }

  for (const notice of notices) {
    await tx`
      INSERT INTO tender_sources (
        tender_id, source_key, external_id, url, published_at, fetched_at, payload
      ) VALUES (
        ${tenderId}, ${notice.source}, ${notice.externalId}, ${notice.url},
        ${notice.publicationDate ?? null}, ${notice.fetchedAt ?? null},
        ${tx.json(JSON.parse(JSON.stringify(notice)))}
      )
      ON CONFLICT (source_key, external_id) DO UPDATE SET
        url = EXCLUDED.url,
        published_at = EXCLUDED.published_at,
        fetched_at = EXCLUDED.fetched_at,
        payload = EXCLUDED.payload
    `;
  }

  await tx`DELETE FROM lots WHERE tender_id = ${tenderId}`;
  for (const lot of merged.lots) {
    await tx`
      INSERT INTO lots (tender_id, number, title, description, cpv_code)
      VALUES (
        ${tenderId}, ${lot.number}, ${lot.title ?? null},
        ${lot.description ?? null}, ${lot.cpvCode ?? null}
      )
    `;
  }

  await tx`DELETE FROM tender_cpv_codes WHERE tender_id = ${tenderId}`;
  for (const cpv of merged.cpvCodes) {
    await tx`
      INSERT INTO tender_cpv_codes (tender_id, code, label, is_main)
      VALUES (${tenderId}, ${cpv.code}, ${cpv.label ?? null}, ${cpv.isMain})
    `;
  }
}

async function upsertBuyer(tx: Tx, merged: MergedTender): Promise<number> {
  const normalized = normalizeKey(merged.buyer.name);
  const rows = await tx<{ id: number }[]>`
    INSERT INTO buyers (
      name, normalized_name, siret, address, postal_code, city, email, phone, website
    ) VALUES (
      ${merged.buyer.name}, ${normalized}, ${merged.buyer.siret ?? null},
      ${merged.buyer.address ?? null}, ${merged.buyer.postalCode ?? null},
      ${merged.buyer.city ?? null}, ${merged.buyer.email ?? null},
      ${merged.buyer.phone ?? null}, ${merged.buyer.website ?? null}
    )
    ON CONFLICT (normalized_name) DO UPDATE SET
      siret = COALESCE(buyers.siret, EXCLUDED.siret),
      address = COALESCE(buyers.address, EXCLUDED.address),
      postal_code = COALESCE(buyers.postal_code, EXCLUDED.postal_code),
      city = COALESCE(buyers.city, EXCLUDED.city),
      email = COALESCE(buyers.email, EXCLUDED.email),
      phone = COALESCE(buyers.phone, EXCLUDED.phone),
      website = COALESCE(buyers.website, EXCLUDED.website)
    RETURNING id
  `;
  return rows[0].id;
}

async function loadNotices(tx: Tx, tenderId: number): Promise<NormalizedNotice[]> {
  const rows = await tx<{ payload: NormalizedNotice }[]>`
    SELECT payload FROM tender_sources WHERE tender_id = ${tenderId}
  `;
  return rows.map((row) => reviveNotice(row.payload));
}

function reviveNotice(payload: NormalizedNotice): NormalizedNotice {
  return {
    ...payload,
    responseDeadline: payload.responseDeadline ? new Date(payload.responseDeadline) : undefined,
    fetchedAt: payload.fetchedAt ? new Date(payload.fetchedAt) : undefined,
  };
}
