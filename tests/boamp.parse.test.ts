import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBoampXml } from '../src/sources/boamp/parse.ts';

const BOAMP_DIR = path.resolve(import.meta.dirname, '..', 'fixtures', 'boamp');

async function readFixture(name: string): Promise<string> {
  return readFile(path.join(BOAMP_DIR, name), 'utf8');
}

describe('parseBoampXml', () => {
  it('parses a notice with lots (Chavenay, 24-47259)', async () => {
    const notice = parseBoampXml(await readFixture('24-47259.xml'));

    expect(notice.source).toBe('boamp');
    expect(notice.externalId).toBe('24-47259');
    expect(notice.url).toBe('https://www.boamp.fr/avis/detail/24-47259/officiel');
    expect(notice.externalRefs).toEqual([]);
    expect(notice.buyer.name).toBe('Commune de Chavenay');
    expect(notice.buyer.postalCode).toBe('78450');
    expect(notice.buyer.email).toBe('mairie@chavenay.fr');
    expect(notice.buyer.website).toBeUndefined(); // coord.url is the buyer-profile, not a website
    expect(notice.title).toMatch(/produits d'entretien/i);
    expect(notice.buyerReference).toBe('202401');
    expect(notice.marketType).toBe('supplies');
    expect(notice.procedure).toBe('Procédure adaptée');
    expect(notice.publicationDate).toBe('2024-04-19');
    expect(notice.responseDeadline?.toISOString()).toBe('2024-05-17T10:00:00.000Z');
    expect(notice.lots).toHaveLength(2);
    expect(notice.lots[0]).toMatchObject({ number: '1', title: "Produits d'entretien, d'hygiène" });
    expect(notice.lots[1]).toMatchObject({ number: '2', title: 'Petits matériels' });
    expect(notice.cpvCodes).toEqual([]);
  });

  it('parses a notice without lots (Doubs, 24-47580)', async () => {
    const notice = parseBoampXml(await readFixture('24-47580.xml'));

    expect(notice.externalId).toBe('24-47580');
    expect(notice.buyer.name).toBe('Département du Doubs');
    expect(notice.buyerReference).toBe('2024DPL0027');
    expect(notice.marketType).toBe('supplies');
    expect(notice.duration).toBe('1 mois');
    expect(notice.lots).toEqual([]);
    expect(notice.publicationDate).toBe('2024-04-22');
    expect(notice.responseDeadline?.toISOString()).toBe('2024-05-27T10:00:00.000Z');
  });

  it('maps travaux and services, and duration as a date range', async () => {
    const travaux = parseBoampXml(await readFixture('24-62726.xml'));
    expect(travaux.marketType).toBe('works');
    expect(travaux.buyerReference).toBe('2024DPL0025');

    const services = parseBoampXml(await readFixture('24-58591.xml'));
    expect(services.marketType).toBe('services');
    expect(services.duration).toBeUndefined();
    expect(services.buyer.website).toBe('http://www.montlucon.com');

    const range = parseBoampXml(await readFixture('24-71872.xml'));
    expect(range.duration).toBe('2024-09-30 - 2026-01-02');
  });

  it('parses every fixture without throwing and with the required fields', async () => {
    const files = (await readdir(BOAMP_DIR)).filter((file) => file.endsWith('.xml'));
    expect(files).toHaveLength(11);

    for (const file of files) {
      const notice = parseBoampXml(await readFixture(file));
      expect(notice.externalId, file).toBe(file.replace('.xml', ''));
      expect(notice.title, file).toBeTruthy();
      expect(notice.buyer.name, file).toBeTruthy();
      expect(notice.publicationDate, file).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(notice.responseDeadline, file).toBeInstanceOf(Date);
    }
  });
});
