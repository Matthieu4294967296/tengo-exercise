# Tengo Backend Case

Starter repository for the Tengo backend case. The instructions are in the Notion page you received; this repository only gives you the inputs and a minimal setup.

## Quickstart

Requirements: Node 22, pnpm, Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up          # Postgres 16 on localhost:5432 (tengo/tengo/tenders)
pnpm ingest         # parse fixtures, dedupe, write 13 tenders / 22 notices
pnpm start          # API on http://localhost:3000
pnpm test
pnpm typecheck
pnpm db:migrate     # apply pending SQL migrations
pnpm db:rollback    # revert the last migration
pnpm db:down        # stop Postgres and drop its volume
```

```bash
curl -s http://localhost:3000/tenders | jq .count          # 13
curl -s http://localhost:3000/tenders/1 | jq .sources
```

`pnpm ingest` is idempotent: a second run creates 0 new tenders.

## Architecture

Parsers never talk to the database. Matching never sees XML or HTML.

```
BOAMP XML  ──parse──┐
                    ├── NormalizedNotice ── match keys ── merge ── Postgres ── API
HTML pages ──parse──┘
```

- **Adapters** (`src/sources/`) turn each source format into `NormalizedNotice`.
- **Domain** (`src/domain/notice.ts`, `src/dedup/`) matches notices that are the same tender and merges their fields.
- **Postgres** stores one `tenders` row plus one `tender_sources` row per notice. `payload` JSONB keeps the full extraction.
- **API** reads tables only.

Matching prefers a duplicate over a false merge: if the only shared key is buyer+title and deadlines disagree, two tenders are kept.

## Data model

| Table | Role |
|---|---|
| `sources` | Known sources. Each adapter upserts its own row at ingest start. |
| `buyers` | Deduped on normalized name. SIRET is stored when present. |
| `tenders` | One row per real-world tender. |
| `lots`, `tender_cpv_codes` | Children of a tender. |
| `tender_sources` | Provenance: source, external id, URL, payload. Unique on `(source_key, external_id)`. |
| `tender_match_keys` | Identity keys. Primary key `(kind, value)`. |

Match keys, strongest first:

- `ext` — `boamp:24-47580` (own id and every `externalRefs` entry)
- `buyer_ref` — `departement du doubs|2024dpl0027`
- `buyer_title` — `departement du doubs|…title…`

Merge is per field: official-journal fields prefer BOAMP (`trust_rank`); descriptive fields (CPV, SIRET, description, lots) prefer the platform. See `src/dedup/merge.ts`.

## API

- `GET /tenders?limit=&offset=` — `{ results, count }`. `count` is the total. Ordered by `publication_date` descending.
- `GET /tenders/:id` — buyer, lots, CPV codes, sources with `externalId` and `url`. `400` if `:id` is not an integer, `404` if missing.

Publication dates are midnight UTC. Deadlines are instants (Paris local time converted at parse).

## Layout

```
migrations/0001_init.up.sql
migrations/0001_init.down.sql
src/ingest.ts                 pnpm ingest
src/server.ts                 pnpm start
src/api/tenders.ts
src/db/client.ts              pool; DATE kept as YYYY-MM-DD
src/db/migrate.ts             up / down
src/domain/notice.ts          NormalizedNotice
src/sources/registry.ts       SOURCES
src/sources/register.ts       upsert into sources
src/sources/boamp/parse.ts
src/sources/platform/parse.ts
src/dedup/matchKeys.ts
src/dedup/merge.ts
src/dedup/cluster.ts          in-memory grouping (tests)
src/dedup/upsert.ts           same rules against Postgres
src/lib/text.ts               normalizeKey, Paris → UTC
tests/
fixtures/boamp/*.xml
fixtures/platform/*.html
fixtures/platform/pages.json
```

## Known limits

- Contract duration in these fixtures is `<nbMois>` or a date range. `<nbJours>` on `<duree>` is not handled. Offer validity (`<validite>`) is ignored.
- A notice that matches two existing tenders is attached to the strongest key and logged, not used to merge those tenders.
- `clusterNotices` (tests) and `upsertNotice` (ingest) implement the same rules separately.
- `GET /tenders` has pagination only, no search filters.
