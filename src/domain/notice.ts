// The single shape every source adapter should produce.
//
// Parsers (BOAMP XML, marches-publics.info HTML, ...) turn their own format
// into a NormalizedNotice. Everything downstream (matching, merging, storage,
// API) works on this type only and never sees XML or HTML.
//
// Convention: a field is optional (`?`) when a source may legitimately not
// provide it. Optional fields are `undefined` when absent, never `null` or ''.

/** Closed vocabulary fixed by the Code de la commande publique. */
export type MarketType = 'works' | 'supplies' | 'services';

export interface Buyer {
  name: string;
  siret?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  email?: string;
  phone?: string;
  website?: string;
}

export interface CpvCode {
  /** 8 digits, e.g. '45262522'. */
  code: string;
  label?: string;
  isMain: boolean;
}

export interface Lot {
  /** As printed by the source: '1', '2'... */
  number: string;
  title?: string;
  description?: string;
  cpvCode?: string;
}

/** "This same tender is also published on `source` under `externalId`." */
export interface ExternalRef {
  source: string;
  externalId: string;
}

export interface NormalizedNotice {
  // --- Provenance -------------------------------------------------------
  /** Key of the source in the registry, e.g. 'boamp'. */
  source: string;
  /** Id of the notice on that source, e.g. '24-47580' or 'MPI-pub-2024113207'. */
  externalId: string;
  url: string;
  /** When we fetched it, if known. */
  fetchedAt?: Date;
  /** Links this source gives to the same tender on other sources. */
  externalRefs: ExternalRef[];

  // --- Tender content ---------------------------------------------------
  buyer: Buyer;
  title: string;
  description?: string;
  /** The buyer's own reference, e.g. '2024DPL0027'. */
  buyerReference?: string;
  marketType?: MarketType;
  /** Free text for now, e.g. 'Procédure adaptée'. */
  procedure?: string;
  /** 'YYYY-MM-DD'. A calendar date, not an instant. */
  publicationDate?: string;
  /** An instant (UTC). Sources give Paris local time; adapters convert. */
  responseDeadline?: Date;
  executionPlace?: string;
  /** Free text, e.g. '12 mois'. */
  duration?: string;
  cpvCodes: CpvCode[];
  lots: Lot[];
}
