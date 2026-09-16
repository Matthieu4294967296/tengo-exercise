-- Reverse order of creation, so foreign keys never block a drop.
DROP TABLE IF EXISTS tender_match_keys;
DROP TABLE IF EXISTS tender_sources;
DROP TABLE IF EXISTS tender_cpv_codes;
DROP TABLE IF EXISTS lots;
DROP TABLE IF EXISTS tenders;
DROP TABLE IF EXISTS buyers;
DROP TABLE IF EXISTS sources;
