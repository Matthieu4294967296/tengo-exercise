import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePlatformHtml, type PlatformPageMeta } from '../src/sources/platform/parse.ts';

const PLATFORM_DIR = path.resolve(import.meta.dirname, '..', 'fixtures', 'platform');
const pagesJson = JSON.parse(await readFile(path.join(PLATFORM_DIR, 'pages.json'), 'utf8')) as {
  pages: PlatformPageMeta[];
};

function metaFor(file: string): PlatformPageMeta {
  const meta = pagesJson.pages.find((page) => page.file === file);
  if (!meta) throw new Error(`pages.json has no entry for ${file}`);
  return meta;
}

async function parseFile(file: string) {
  const html = await readFile(path.join(PLATFORM_DIR, file), 'utf8');
  return parsePlatformHtml(html, metaFor(file));
}

describe('parsePlatformHtml', () => {
  it('parses a page with lots and several CPV codes (Chavenay)', async () => {
    const notice = await parseFile('MPI-pub-2024110345.html');

    expect(notice.source).toBe('marches-publics.info');
    expect(notice.externalId).toBe('MPI-pub-2024110345');
    expect(notice.url).toBe('https://www.marches-publics.info/Annonces/MPI-pub-2024110345.htm');
    expect(notice.externalRefs).toEqual([{ source: 'boamp', externalId: '24-47259' }]);
    expect(notice.buyer.name).toBe('COMMUNE DE CHAVENAY');
    expect(notice.buyer.siret).toBe('21780152100014');
    expect(notice.buyerReference).toBe('202401');
    expect(notice.marketType).toBe('supplies');
    expect(notice.procedure).toBe('Procédure adaptée');
    expect(notice.publicationDate).toBe('2024-04-19');
    expect(notice.responseDeadline?.toISOString()).toBe('2024-05-17T10:00:00.000Z');
    expect(notice.cpvCodes[0]).toMatchObject({ code: '39224300', isMain: true });
    expect(notice.cpvCodes.map((c) => c.code)).toEqual(['39224300', '33761000', '39830000', '39831200']);
    expect(notice.lots).toHaveLength(2);
    expect(notice.lots[0]).toMatchObject({
      number: '1',
      title: "Produits d'entretien, d'hygiène",
      cpvCode: '39830000',
    });
  });

  it('parses a simple Doubs page with a BOAMP link', async () => {
    const notice = await parseFile('MPI-pub-2024113207.html');

    expect(notice.buyer.name).toBe('DÉPARTEMENT DU DOUBS');
    expect(notice.buyer.siret).toBe('22250001900013');
    expect(notice.buyer.website).toBe('https://www.doubs.fr/');
    expect(notice.buyerReference).toBe('2024DPL0027');
    expect(notice.duration).toBe('1 mois');
    expect(notice.cpvCodes).toEqual([
      { code: '34928300', label: 'Barrières de sécurité', isMain: true },
    ]);
    expect(notice.lots).toEqual([]);
    expect(notice.externalRefs).toEqual([{ source: 'boamp', externalId: '24-47580' }]);
  });

  it('parses the Montluçon page that has no reference and no BOAMP link', async () => {
    const notice = await parseFile('MPI-pub-2024142269.html');

    expect(notice.buyer.name).toBe('VILLE DE MONTLUCON');
    expect(notice.buyerReference).toBeUndefined();
    expect(notice.externalRefs).toEqual([]);
    expect(notice.title).toMatch(/AMELIORATION THERMIQUE/);
    expect(notice.marketType).toBe('services');
    expect(notice.responseDeadline?.toISOString()).toBe('2024-06-18T10:00:00.000Z');
    expect(notice.publicationDate).toBe('2024-05-21');
  });

  it('parses every fixture with the required fields', async () => {
    for (const page of pagesJson.pages) {
      const notice = await parseFile(page.file);
      expect(notice.externalId, page.file).toBe(page.file.replace('.html', ''));
      expect(notice.title, page.file).toBeTruthy();
      expect(notice.buyer.name, page.file).toBeTruthy();
      expect(notice.responseDeadline, page.file).toBeInstanceOf(Date);
      expect(notice.publicationDate, page.file).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
