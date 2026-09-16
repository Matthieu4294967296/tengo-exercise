import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { clusterNotices } from '../src/dedup/cluster.ts';
import { computeMatchKeys } from '../src/dedup/matchKeys.ts';
import { parseBoampXml } from '../src/sources/boamp/parse.ts';
import { parsePlatformHtml, type PlatformPageMeta } from '../src/sources/platform/parse.ts';
import { fakeNotice } from './helpers.ts';
import type { NormalizedNotice } from '../src/domain/notice.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const pagesJson = JSON.parse(
  await readFile(path.join(ROOT, 'fixtures/platform/pages.json'), 'utf8'),
) as { pages: PlatformPageMeta[] };

async function loadAllNotices(): Promise<NormalizedNotice[]> {
  const boampDir = path.join(ROOT, 'fixtures/boamp');
  const platformDir = path.join(ROOT, 'fixtures/platform');
  const xmlFiles = (await readdir(boampDir)).filter((file) => file.endsWith('.xml'));
  const notices: NormalizedNotice[] = [];
  for (const file of xmlFiles) {
    notices.push(parseBoampXml(await readFile(path.join(boampDir, file), 'utf8')));
  }
  for (const page of pagesJson.pages) {
    notices.push(parsePlatformHtml(await readFile(path.join(platformDir, page.file), 'utf8'), page));
  }
  return notices;
}

function fingerprint(notices: NormalizedNotice[]): string[] {
  const { tenders } = clusterNotices(notices);
  return tenders
    .map((tender) =>
      tender.notices
        .map((n) => `${n.source}:${n.externalId}`)
        .sort()
        .join('+'),
    )
    .sort();
}

describe('computeMatchKeys', () => {
  it('includes own id and linked ids as ext keys', () => {
    const keys = computeMatchKeys(
      fakeNotice({
        source: 'marches-publics.info',
        externalId: 'MPI-pub-1',
        buyer: { name: 'Département du Doubs' },
        buyerReference: '2024DPL0027',
        title: 'Barrières',
        externalRefs: [{ source: 'boamp', externalId: '24-47580' }],
      }),
    );
    expect(keys.map((k) => `${k.kind}:${k.value}`)).toEqual([
      'ext:marches-publics.info:MPI-pub-1',
      'ext:boamp:24-47580',
      'buyer_ref:departement du doubs|2024dpl0027',
      'buyer_title:departement du doubs|barrieres',
    ]);
  });
});

describe('clusterNotices', () => {
  it('merges the fixtures into 13 tenders, 9 of them from both sources', async () => {
    const notices = await loadAllNotices();
    expect(notices).toHaveLength(22);

    const { tenders } = clusterNotices(notices);
    expect(tenders).toHaveLength(13);
    expect(tenders.filter((t) => t.notices.length === 2)).toHaveLength(9);
    expect(tenders.filter((t) => t.notices.length === 1)).toHaveLength(4);

    const chavenay = tenders.find((t) => t.notices.some((n) => n.externalId === '24-47259'));
    expect(chavenay?.notices.map((n) => n.source).sort()).toEqual(['boamp', 'marches-publics.info']);
    expect(chavenay?.lots).toHaveLength(2);
    expect(chavenay?.cpvCodes.length).toBeGreaterThan(0);

    const montluconHard = tenders.find((t) => t.notices.some((n) => n.externalId === '24-58591'));
    expect(montluconHard?.notices).toHaveLength(2);

    const mosaics = tenders.find((t) => t.notices.some((n) => n.externalId === '24-62726'));
    expect(mosaics?.notices).toHaveLength(2);
  });

  it('gives the same grouping and merged fields regardless of ingest order', async () => {
    const notices = await loadAllNotices();
    const boampFirst = notices.filter((n) => n.source === 'boamp');
    const platformFirst = notices.filter((n) => n.source === 'marches-publics.info');
    const restBoamp = notices.filter((n) => n.source === 'boamp');
    const restPlatform = notices.filter((n) => n.source === 'marches-publics.info');

    const a = fingerprint([...boampFirst, ...restPlatform]);
    const b = fingerprint([...platformFirst, ...restBoamp]);
    const c = fingerprint(shuffle(notices, 42));

    expect(a).toEqual(b);
    expect(a).toEqual(c);

    const mergedA = clusterNotices([...boampFirst, ...restPlatform]).tenders.map(snapshot);
    const mergedB = clusterNotices([...platformFirst, ...restBoamp]).tenders.map(snapshot);
    expect(mergedA.sort()).toEqual(mergedB.sort());
  });

  it('does not merge two tenders that only share buyer+title if deadlines differ', () => {
    const a = fakeNotice({
      source: 'boamp',
      externalId: '24-1',
      buyer: { name: 'Ville X' },
      title: 'Travaux de voirie',
      responseDeadline: new Date('2024-06-01T10:00:00.000Z'),
    });
    const b = fakeNotice({
      source: 'marches-publics.info',
      externalId: 'MPI-1',
      buyer: { name: 'VILLE X' },
      title: 'Travaux de voirie',
      responseDeadline: new Date('2024-07-01T10:00:00.000Z'),
    });

    const { tenders, warnings } = clusterNotices([a, b]);
    expect(tenders).toHaveLength(2);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

function snapshot(tender: ReturnType<typeof clusterNotices>['tenders'][number]): string {
  const ids = tender.notices
    .map((n) => `${n.source}:${n.externalId}`)
    .sort()
    .join('+');
  return [
    ids,
    tender.title,
    tender.publicationDate,
    tender.responseDeadline?.toISOString(),
    tender.buyer.siret,
    tender.cpvCodes.map((c) => c.code).sort().join(','),
  ].join('|');
}

function shuffle<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
