import type { Buyer, NormalizedNotice } from '../src/domain/notice.ts';

export function fakeNotice(overrides: Partial<NormalizedNotice> & { buyer?: Partial<Buyer> }): NormalizedNotice {
  const { buyer, ...rest } = overrides;
  return {
    source: 'boamp',
    externalId: '24-00000',
    url: 'https://example.test',
    externalRefs: [],
    buyer: { name: 'Ville Test', ...buyer },
    title: 'Fourniture de stylo',
    cpvCodes: [],
    lots: [],
    ...rest,
  };
}
