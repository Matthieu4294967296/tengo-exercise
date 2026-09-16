import type { NormalizedNotice } from '../domain/notice.ts';
import { computeMatchKeys, keyId, type MatchKey } from './matchKeys.ts';
import { mergeNotices, type MergedTender } from './merge.ts';

export interface ClusteredTender extends MergedTender {
  notices: NormalizedNotice[];
  keys: MatchKey[];
}

export interface ClusterResult {
  tenders: ClusteredTender[];
  warnings: string[];
}

/**
 * Group notices that are the same real-world tender.
 */
export function clusterNotices(notices: NormalizedNotice[]): ClusterResult {
  const tenders: ClusteredTender[] = [];
  const index = new Map<string, number>();
  const warnings: string[] = [];

  for (const notice of notices) {
    const keys = computeMatchKeys(notice);
    const hits = unique(
      keys.map((key) => index.get(keyId(key))).filter((id): id is number => id !== undefined),
    );

    if (hits.length === 0) {
      addTender(tenders, index, [notice], keys);
      continue;
    }

    if (hits.length > 1) {
      const chosen = strongestHit(keys, index, hits);
      warnings.push(
        `notice ${notice.source}:${notice.externalId} matches tenders ${hits.join(', ')} (bridge); attaching to ${chosen}`,
      );
      attach(tenders, index, chosen, notice, keys);
      continue;
    }

    const tenderId = hits[0];
    const connecting = keys.filter((key) => index.get(keyId(key)) === tenderId);
    const best = Math.min(...connecting.map((key) => key.rank));
    if (best === 3 && deadlinesDisagree(tenders[tenderId], notice)) {
      warnings.push(
        `notice ${notice.source}:${notice.externalId} shares buyer+title with a tender but deadlines differ; keeping separate`,
      );
      addTender(tenders, index, [notice], keys);
      continue;
    }

    attach(tenders, index, tenderId, notice, keys);
  }

  return { tenders, warnings };
}

function addTender(
  tenders: ClusteredTender[],
  index: Map<string, number>,
  notices: NormalizedNotice[],
  keys: MatchKey[],
): void {
  const merged = mergeNotices(notices);
  const id = tenders.length;
  tenders.push({ ...merged, notices, keys });
  for (const key of keys) {
    if (!index.has(keyId(key))) index.set(keyId(key), id);
  }
}

function attach(
  tenders: ClusteredTender[],
  index: Map<string, number>,
  tenderId: number,
  notice: NormalizedNotice,
  keys: MatchKey[],
): void {
  const tender = tenders[tenderId];
  tender.notices.push(notice);
  const merged = mergeNotices(tender.notices);
  Object.assign(tender, merged, { notices: tender.notices, keys: [...tender.keys, ...keys] });
  for (const key of keys) {
    if (!index.has(keyId(key))) index.set(keyId(key), tenderId);
  }
}

function strongestHit(keys: MatchKey[], index: Map<string, number>, hits: number[]): number {
  const ranked = keys
    .map((key) => ({ key, tenderId: index.get(keyId(key)) }))
    .filter((row): row is { key: MatchKey; tenderId: number } => row.tenderId !== undefined)
    .sort((a, b) => a.key.rank - b.key.rank);
  return ranked[0]?.tenderId ?? hits[0];
}

function deadlinesDisagree(tender: ClusteredTender, notice: NormalizedNotice): boolean {
  const a = tender.responseDeadline;
  const b = notice.responseDeadline;
  if (!a || !b) return false;
  return a.getTime() !== b.getTime();
}

function unique(ids: number[]): number[] {
  return [...new Set(ids)];
}
