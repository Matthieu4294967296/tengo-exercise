-- Known sources. Each adapter inserts its own row at ingest start, so adding a
-- source never requires a migration. `key` is a natural text key ('boamp',
-- 'marches-publics.info'): readable in the DB and usable directly by the API.
CREATE TABLE sources (
  key          TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  base_url     TEXT,
  -- Lower is more trusted. Default precedence between sources when the
  -- per-field rules in dedup/merge.ts do not say otherwise.
  trust_rank   INTEGER NOT NULL DEFAULT 100
);

-- One row per buyer, deduplicated on the normalized name (lowercase, accents
-- and punctuation removed). SIRET is stored when a source provides it but is
-- not the key: BOAMP MAPA notices never carry it.
CREATE TABLE buyers (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  siret           TEXT,
  address         TEXT,
  postal_code     TEXT,
  city            TEXT,
  email           TEXT,
  phone           TEXT,
  website         TEXT
);

-- The merged entity: one row per real-world tender, whatever the number of
-- sources it came from.
CREATE TABLE tenders (
  id                SERIAL PRIMARY KEY,
  buyer_id          INTEGER NOT NULL REFERENCES buyers(id),
  title             TEXT NOT NULL,
  description       TEXT,
  buyer_reference   TEXT,
  market_type       TEXT CHECK (market_type IN ('works', 'supplies', 'services')),
  procedure         TEXT,
  publication_date  DATE,
  response_deadline TIMESTAMPTZ,
  execution_place   TEXT,
  duration          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tenders_publication_date_idx ON tenders (publication_date DESC);

CREATE TABLE lots (
  id          SERIAL PRIMARY KEY,
  tender_id   INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  number      TEXT NOT NULL,
  title       TEXT,
  description TEXT,
  cpv_code    TEXT,
  UNIQUE (tender_id, number)
);

CREATE TABLE tender_cpv_codes (
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  code      TEXT NOT NULL,
  label     TEXT,
  is_main   BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (tender_id, code)
);

-- Provenance: one row per notice ingested. `payload` keeps the full normalized
-- extraction of that notice, so nothing parsed is lost when fields are merged.
CREATE TABLE tender_sources (
  id           SERIAL PRIMARY KEY,
  tender_id    INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  source_key   TEXT NOT NULL REFERENCES sources(key),
  external_id  TEXT NOT NULL,
  url          TEXT NOT NULL,
  published_at DATE,
  fetched_at   TIMESTAMPTZ,
  payload      JSONB NOT NULL,
  UNIQUE (source_key, external_id)
);

CREATE INDEX tender_sources_tender_id_idx ON tender_sources (tender_id);

-- The identity keys a tender is known by, e.g.
--   ('ext',         'boamp:24-47580')
--   ('buyer_ref',   'departement du doubs|2024dpl0027')
--   ('buyer_title', 'departement du doubs|acquisition de barrieres ...')
-- A notice whose keys hit an existing row joins that tender.
CREATE TABLE tender_match_keys (
  kind      TEXT NOT NULL,
  value     TEXT NOT NULL,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  PRIMARY KEY (kind, value)
);

CREATE INDEX tender_match_keys_tender_id_idx ON tender_match_keys (tender_id);
