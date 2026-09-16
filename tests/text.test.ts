import { describe, expect, it } from 'vitest';
import {
  cleanOptional,
  cleanText,
  normalizeKey,
  parisToUtc,
  parseFrenchDate,
  parseFrenchDateTime,
  parseParisIsoDateTime,
} from '../src/lib/text.ts';

describe('cleanText', () => {
  it('collapses whitespace and newlines', () => {
    expect(cleanText('  ACQUISITION DE\n   BARRIERES  ')).toBe('ACQUISITION DE BARRIERES');
  });

  it('cleanOptional returns undefined for empty or missing input', () => {
    expect(cleanOptional(undefined)).toBeUndefined();
    expect(cleanOptional('   ')).toBeUndefined();
    expect(cleanOptional(' x ')).toBe('x');
  });
});

describe('normalizeKey', () => {
  it('makes the two spellings of a buyer name identical', () => {
    expect(normalizeKey('Département du Doubs')).toBe(normalizeKey('DÉPARTEMENT DU DOUBS'));
    expect(normalizeKey('Département du Doubs')).toBe('departement du doubs');
  });

  it('ignores punctuation and stray spaces in titles', () => {
    expect(normalizeKey("MISSION DE MAITRISE D'OEUVRE POUR L' AMELIORATION THERMIQUE - ECOLE")).toBe(
      'mission de maitrise d oeuvre pour l amelioration thermique ecole',
    );
  });
});

describe('Paris time to UTC', () => {
  it('uses +02:00 in summer', () => {
    // The case's example: 15/07/24 at 12h00 Paris is 10:00Z.
    expect(parisToUtc(2024, 7, 15, 12, 0).toISOString()).toBe('2024-07-15T10:00:00.000Z');
  });

  it('uses +01:00 in winter', () => {
    expect(parisToUtc(2024, 1, 15, 12, 0).toISOString()).toBe('2024-01-15T11:00:00.000Z');
  });

  it('parses the BOAMP ISO-like format', () => {
    expect(parseParisIsoDateTime('2024-05-27T12:00:00')?.toISOString()).toBe('2024-05-27T10:00:00.000Z');
    expect(parseParisIsoDateTime('not a date')).toBeUndefined();
  });

  it('parses the marches-publics.info format', () => {
    expect(parseFrenchDateTime('27/05/24 à 12h00')?.toISOString()).toBe('2024-05-27T10:00:00.000Z');
    expect(parseFrenchDateTime('Remise des offres le 17/06/24 à 23h59 au plus tard.')?.toISOString()).toBe(
      '2024-06-17T21:59:00.000Z',
    );
    expect(parseFrenchDateTime('no time here')).toBeUndefined();
  });

  it('parses a French calendar date to YYYY-MM-DD', () => {
    expect(parseFrenchDate('Envoi le 22/04/24 à la publication')).toBe('2024-04-22');
    expect(parseFrenchDate('22/04/2024')).toBe('2024-04-22');
    expect(parseFrenchDate('nothing')).toBeUndefined();
  });
});
