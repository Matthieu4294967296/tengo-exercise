# Tengo Backend Case

Starter repository for the Tengo backend case. The instructions are in the Notion page you received; this repository only gives you the inputs and a minimal setup.

## Quickstart

Requirements: Node 22, pnpm, Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up          # Postgres 16 on localhost:5432 (user/password/db: tengo/tengo/tenders)
pnpm ingest         # runs src/ingest.ts, currently a stub
pnpm start          # Express API on localhost:3000, routes return empty payloads for now
pnpm db:down        # stops Postgres and removes its volume
```

## Structure

```
fixtures/
  boamp/*.xml            BOAMP notices (schema 3.2.5, MAPA family)
  platform/*.html        notice pages from marches-publics.info
  platform/pages.json    original URL and fetch date of each page
src/
  ingest.ts              entry point of `pnpm ingest`
  server.ts              entry point of `pnpm start` (GET /tenders, GET /tenders/:id)
docker-compose.yml       Postgres 16
.env.example             DATABASE_URL
```

Everything else (dependencies, layout, scripts) is yours to change.
