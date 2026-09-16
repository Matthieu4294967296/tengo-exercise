import { describe, expect, it } from 'vitest';
import { mergeNotices } from '../src/dedup/merge.ts';
import { fakeNotice } from './helpers.ts';

describe('mergeNotices', () => {
  it('lets BOAMP win on the deadline and the platform fill CPV', () => {
    const boamp = fakeNotice({
      source: 'boamp',
      externalId: '24-1',
      title: 'FOURNITURE DE CAPTEURS',
      responseDeadline: new Date('2024-07-15T10:00:00.000Z'),
      publicationDate: '2024-06-24',
    });
    const platform = fakeNotice({
      source: 'marches-publics.info',
      externalId: 'MPI-1',
      title: 'Fourniture de capteurs',
      responseDeadline: new Date('2024-07-16T10:00:00.000Z'),
      description: 'Détail du DCE',
      cpvCodes: [{ code: '35125100', label: 'Capteurs', isMain: true }],
    });

    const merged = mergeNotices([platform, boamp]);

    expect(merged.responseDeadline?.toISOString()).toBe('2024-07-15T10:00:00.000Z');
    expect(merged.publicationDate).toBe('2024-06-24');
    expect(merged.description).toBe('Détail du DCE');
    expect(merged.cpvCodes).toEqual([{ code: '35125100', label: 'Capteurs', isMain: true }]);
    expect(merged.conflicts.some((c) => c.field === 'responseDeadline')).toBe(true);
  });

  it('fills SIRET from a later platform notice', () => {
    const boamp = fakeNotice({ source: 'boamp', buyer: { name: 'Département du Doubs' } });
    const platform = fakeNotice({
      source: 'marches-publics.info',
      buyer: { name: 'DÉPARTEMENT DU DOUBS', siret: '22250001900013' },
    });

    const merged = mergeNotices([boamp, platform]);
    expect(merged.buyer.siret).toBe('22250001900013');
    expect(merged.buyer.name).toBe('Département du Doubs');
  });

  it('unions lots and fills CPV from the source that has it', () => {
    const boamp = fakeNotice({
      source: 'boamp',
      lots: [{ number: '1', title: "Produits d'entretien" }],
    });
    const platform = fakeNotice({
      source: 'marches-publics.info',
      lots: [{ number: '1', title: "Produits d'entretien", cpvCode: '39830000' }],
    });

    expect(mergeNotices([boamp, platform]).lots[0].cpvCode).toBe('39830000');
    expect(mergeNotices([platform, boamp]).lots[0].cpvCode).toBe('39830000');
  });
});
