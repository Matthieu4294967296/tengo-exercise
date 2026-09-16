import type { NormalizedNotice } from '../domain/notice.ts';
import { normalizeKey } from '../lib/text.ts';

/** One identity key a notice (and later a tender) is known by. */
export interface MatchKey {
  /** 'ext' = source+id, 'buyer_ref' = buyer+reference, 'buyer_title' = buyer+title. */
  kind: 'ext' | 'buyer_ref' | 'buyer_title';
  value: string;
  /** 1 = strongest (explicit id), 3 = weakest (title). */
  rank: 1 | 2 | 3;
}

export function keyId(key: MatchKey): string {
  return `${key.kind}:${key.value}`;
}

/**
 * Keys this notice can be found under, strongest first.
 * `ext` covers both the notice's own id and every cross-source link it mentions.
 */
export function computeMatchKeys(notice: NormalizedNotice): MatchKey[] {
  const keys: MatchKey[] = [
    { kind: 'ext', value: `${notice.source}:${notice.externalId}`, rank: 1 },
  ];

  for (const ref of notice.externalRefs) {
    keys.push({ kind: 'ext', value: `${ref.source}:${ref.externalId}`, rank: 1 });
  }

  const buyer = normalizeKey(notice.buyer.name);
  if (notice.buyerReference) {
    keys.push({
      kind: 'buyer_ref',
      value: `${buyer}|${normalizeKey(notice.buyerReference)}`,
      rank: 2,
    });
  }
  keys.push({
    kind: 'buyer_title',
    value: `${buyer}|${normalizeKey(notice.title)}`,
    rank: 3,
  });

  return keys;
}
