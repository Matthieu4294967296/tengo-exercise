import { sql } from '../db/client.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function parsePage(query: { limit?: string; offset?: string }): { limit: number; offset: number } {
  const limit = clampInt(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  return { limit, offset };
}

export async function listTenders(limit: number, offset: number) {
  const [{ count }] = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM tenders`;
  const rows = await sql<ListRow[]>`
    SELECT
      t.id,
      t.title,
      b.name AS buyer_name,
      t.publication_date,
      t.response_deadline,
      array_agg(s.display_name ORDER BY s.trust_rank, s.display_name) AS sources
    FROM tenders t
    JOIN buyers b ON b.id = t.buyer_id
    JOIN tender_sources ts ON ts.tender_id = t.id
    JOIN sources s ON s.key = ts.source_key
    GROUP BY t.id, b.name
    ORDER BY t.publication_date DESC NULLS LAST, t.id
    LIMIT ${limit} OFFSET ${offset}
  `;

  return {
    results: rows.map((row) => ({
      id: row.id,
      title: row.title,
      buyerName: row.buyer_name,
      publicationDate: dateToIso(row.publication_date),
      responseDeadline: dateTimeToIso(row.response_deadline),
      sources: row.sources,
    })),
    count,
  };
}

export async function getTender(id: number) {
  const tenders = await sql<DetailRow[]>`
    SELECT
      t.id,
      t.title,
      t.description,
      t.buyer_reference,
      t.market_type,
      t.procedure,
      t.publication_date,
      t.response_deadline,
      t.execution_place,
      t.duration,
      b.name AS buyer_name,
      b.siret AS buyer_siret,
      b.address AS buyer_address,
      b.postal_code AS buyer_postal_code,
      b.city AS buyer_city,
      b.email AS buyer_email,
      b.phone AS buyer_phone,
      b.website AS buyer_website
    FROM tenders t
    JOIN buyers b ON b.id = t.buyer_id
    WHERE t.id = ${id}
  `;
  const tender = tenders[0];
  if (!tender) return undefined;

  const [lots, cpvCodes, sources] = await Promise.all([
    sql<LotRow[]>`
      SELECT number, title, description, cpv_code
      FROM lots WHERE tender_id = ${id} ORDER BY number
    `,
    sql<CpvRow[]>`
      SELECT code, label, is_main
      FROM tender_cpv_codes WHERE tender_id = ${id}
      ORDER BY is_main DESC, code
    `,
    sql<SourceRow[]>`
      SELECT s.display_name, ts.external_id, ts.url, ts.published_at, ts.fetched_at
      FROM tender_sources ts
      JOIN sources s ON s.key = ts.source_key
      WHERE ts.tender_id = ${id}
      ORDER BY s.trust_rank, s.display_name
    `,
  ]);

  return {
    id: tender.id,
    title: tender.title,
    description: tender.description,
    buyerReference: tender.buyer_reference,
    marketType: tender.market_type,
    procedure: tender.procedure,
    publicationDate: dateToIso(tender.publication_date),
    responseDeadline: dateTimeToIso(tender.response_deadline),
    executionPlace: tender.execution_place,
    duration: tender.duration,
    buyer: {
      name: tender.buyer_name,
      siret: tender.buyer_siret,
      address: tender.buyer_address,
      postalCode: tender.buyer_postal_code,
      city: tender.buyer_city,
      email: tender.buyer_email,
      phone: tender.buyer_phone,
      website: tender.buyer_website,
    },
    lots: lots.map((lot) => ({
      number: lot.number,
      title: lot.title,
      description: lot.description,
      cpvCode: lot.cpv_code,
    })),
    cpvCodes: cpvCodes.map((cpv) => ({
      code: cpv.code,
      label: cpv.label,
      isMain: cpv.is_main,
    })),
    sources: sources.map((source) => ({
      source: source.display_name,
      externalId: source.external_id,
      url: source.url,
      publishedAt: dateToIso(source.published_at),
      fetchedAt: dateTimeToIso(source.fetched_at),
    })),
  };
}

interface ListRow {
  id: number;
  title: string;
  buyer_name: string;
  publication_date: Date | string | null;
  response_deadline: Date | string | null;
  sources: string[];
}

interface DetailRow {
  id: number;
  title: string;
  description: string | null;
  buyer_reference: string | null;
  market_type: string | null;
  procedure: string | null;
  publication_date: Date | string | null;
  response_deadline: Date | string | null;
  execution_place: string | null;
  duration: string | null;
  buyer_name: string;
  buyer_siret: string | null;
  buyer_address: string | null;
  buyer_postal_code: string | null;
  buyer_city: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  buyer_website: string | null;
}

interface LotRow {
  number: string;
  title: string | null;
  description: string | null;
  cpv_code: string | null;
}

interface CpvRow {
  code: string;
  label: string | null;
  is_main: boolean;
}

interface SourceRow {
  display_name: string;
  external_id: string;
  url: string;
  published_at: Date | string | null;
  fetched_at: Date | string | null;
}

/** DATE -> midnight UTC ISO, matching the spec example. */
function dateToIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const day = value.slice(0, 10);
    return `${day}T00:00:00.000Z`;
  }
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

function dateTimeToIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
