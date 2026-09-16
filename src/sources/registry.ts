// The one place that knows which sources exist.
//
// Adding a source = adding an entry here plus a parser under src/sources/<key>/.
// The `sources` table is filled from this object at ingest start, so no
// migration is needed for a new source.

export interface SourceDefinition {
  /** Stable identifier, used as `sources.key` and in match keys. */
  key: string;
  /** What the API shows in the `sources` array. */
  displayName: string;
  baseUrl: string;
  /** Lower is more trusted. Default precedence when merging fields. */
  trustRank: number;
}

export const SOURCES = {
  boamp: {
    key: 'boamp',
    displayName: 'BOAMP',
    baseUrl: 'https://www.boamp.fr',
    trustRank: 1,
  },
  'marches-publics.info': {
    key: 'marches-publics.info',
    displayName: 'marches-publics.info',
    baseUrl: 'https://www.marches-publics.info',
    trustRank: 2,
  },
} as const satisfies Record<string, SourceDefinition>;

/** 'boamp' | 'marches-publics.info' | ... derived from the object above. */
export type SourceKey = keyof typeof SOURCES;

export function isKnownSource(key: string): key is SourceKey {
  return key in SOURCES;
}
