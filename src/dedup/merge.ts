import type { Buyer, CpvCode, Lot, NormalizedNotice } from '../domain/notice.ts';
import { normalizeKey } from '../lib/text.ts';
import { SOURCES } from '../sources/registry.ts';

export interface FieldConflict {
  field: string;
  existing: string;
  incoming: string;
  existingSource: string;
  incomingSource: string;
  winnerSource: string;
}

export interface MergedTender {
  buyer: Buyer;
  title: string;
  description?: string;
  buyerReference?: string;
  marketType?: NormalizedNotice['marketType'];
  procedure?: string;
  publicationDate?: string;
  responseDeadline?: Date;
  executionPlace?: string;
  duration?: string;
  cpvCodes: CpvCode[];
  lots: Lot[];
  conflicts: FieldConflict[];
}

// Official journal wins on facts a supplier is held to.
const PREFER_OFFICIAL = new Set([
  'title',
  'publicationDate',
  'responseDeadline',
  'procedure',
  'marketType',
  'buyerName',
  'buyerReference',
]);

// Buyer-authored pages win on descriptive richness (BOAMP often omits these).
const PREFER_RICH = new Set([
  'description',
  'executionPlace',
  'duration',
  'siret',
  'address',
  'postalCode',
  'city',
  'email',
  'phone',
  'website',
]);

/**
 * Merge several notices of the same tender into one view.
 * Precedence is per field, so the result does not depend on ingest order.
 */
export function mergeNotices(notices: NormalizedNotice[]): MergedTender {
  if (notices.length === 0) {
    throw new Error('mergeNotices requires at least one notice');
  }

  const conflicts: FieldConflict[] = [];
  const pick = (field: string, read: (n: NormalizedNotice) => string | undefined) =>
    pickValue(notices, field, read, conflicts);

  const deadline = pickDate(notices, conflicts);

  return {
    title: pick('title', (n) => n.title) ?? notices[0].title,
    description: pick('description', (n) => n.description),
    buyerReference: pick('buyerReference', (n) => n.buyerReference),
    marketType: pick('marketType', (n) => n.marketType) as MergedTender['marketType'],
    procedure: pick('procedure', (n) => n.procedure),
    publicationDate: pick('publicationDate', (n) => n.publicationDate),
    responseDeadline: deadline,
    executionPlace: pick('executionPlace', (n) => n.executionPlace),
    duration: pick('duration', (n) => n.duration),
    buyer: {
      name: pick('buyerName', (n) => n.buyer.name) ?? notices[0].buyer.name,
      siret: pick('siret', (n) => n.buyer.siret),
      address: pick('address', (n) => n.buyer.address),
      postalCode: pick('postalCode', (n) => n.buyer.postalCode),
      city: pick('city', (n) => n.buyer.city),
      email: pick('email', (n) => n.buyer.email),
      phone: pick('phone', (n) => n.buyer.phone),
      website: pick('website', (n) => n.buyer.website),
    },
    cpvCodes: mergeCpv(notices),
    lots: mergeLots(notices),
    conflicts,
  };
}

function trustRank(source: string): number {
  const def = Object.values(SOURCES).find((s) => s.key === source);
  return def?.trustRank ?? 100;
}

function preferOfficial(field: string): boolean {
  return PREFER_OFFICIAL.has(field);
}

function preferRich(field: string): boolean {
  return PREFER_RICH.has(field);
}

function pickValue(
  notices: NormalizedNotice[],
  field: string,
  read: (n: NormalizedNotice) => string | undefined,
  conflicts: FieldConflict[],
): string | undefined {
  const present = notices
    .map((n) => ({ notice: n, value: read(n) }))
    .filter((row): row is { notice: NormalizedNotice; value: string } => row.value !== undefined);

  if (present.length === 0) return undefined;

  const sorted = [...present].sort((a, b) => {
    if (preferOfficial(field)) return trustRank(a.notice.source) - trustRank(b.notice.source);
    if (preferRich(field)) return trustRank(b.notice.source) - trustRank(a.notice.source);
    return 0;
  });
  const winner = sorted[0];

  for (const row of present) {
    if (sameText(row.value, winner.value)) continue;
    conflicts.push({
      field,
      existing: winner.value,
      incoming: row.value,
      existingSource: winner.notice.source,
      incomingSource: row.notice.source,
      winnerSource: winner.notice.source,
    });
  }
  return winner.value;
}

function pickDate(notices: NormalizedNotice[], conflicts: FieldConflict[]): Date | undefined {
  const present = notices.filter((n) => n.responseDeadline);
  if (present.length === 0) return undefined;
  const sorted = [...present].sort((a, b) => trustRank(a.source) - trustRank(b.source));
  const winner = sorted[0];
  for (const n of present) {
    if (n.responseDeadline!.getTime() === winner.responseDeadline!.getTime()) continue;
    conflicts.push({
      field: 'responseDeadline',
      existing: winner.responseDeadline!.toISOString(),
      incoming: n.responseDeadline!.toISOString(),
      existingSource: winner.source,
      incomingSource: n.source,
      winnerSource: winner.source,
    });
  }
  return winner.responseDeadline;
}

function sameText(a: string, b: string): boolean {
  return normalizeKey(a) === normalizeKey(b);
}

function mergeCpv(notices: NormalizedNotice[]): CpvCode[] {
  const byCode = new Map<string, CpvCode>();
  for (const notice of notices) {
    for (const cpv of notice.cpvCodes) {
      const existing = byCode.get(cpv.code);
      if (!existing) {
        byCode.set(cpv.code, { ...cpv });
        continue;
      }
      existing.isMain = existing.isMain || cpv.isMain;
      existing.label = existing.label ?? cpv.label;
    }
  }
  return [...byCode.values()];
}

function mergeLots(notices: NormalizedNotice[]): Lot[] {
  const byNumber = new Map<string, Lot>();
  for (const notice of notices) {
    for (const lot of notice.lots) {
      const existing = byNumber.get(lot.number);
      if (!existing) {
        byNumber.set(lot.number, { ...lot });
        continue;
      }
      existing.title = existing.title ?? lot.title;
      existing.description = existing.description ?? lot.description;
      existing.cpvCode = existing.cpvCode ?? lot.cpvCode;
    }
  }
  return [...byNumber.values()];
}
