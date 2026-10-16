# Noctemblith PostgreSQL 18 schema baseline

## Scope and compatibility

This branch replaces the 350 historical TypeORM migration classes with a single
initial schema migration (`1792170000000-NoctemblithBaseline.js`) plus the SQL
snapshot (`initial-baseline.sql`). The original files remain available in Git
history. **This baseline is for a clean installation, not an automatic upgrade
of a DB containing the historical TypeORM `migrations` history.**

Do not run the new baseline against an existing populated Noctemblith DB: it
would attempt to create objects already present. Do not reset the Manafield
shared PostgreSQL server or other Modules' schemas. If a disposable Noctemblith
DB must be reset, confirm its name, owner, and backups before recreating only
that DB/schema, then migrate normally. No automatic DROP/CASCADE is supplied.

## Configuring schema ownership

The optional `db.schema` key in `.config/default.yml` sets the PostgreSQL schema
for the app and the migration DataSource. For standalone installations it may be
omitted; the connected role's `search_path` determines the default. For managed
installations, Manafield's Resource provider creates and grants a separate
schema, and the binding supplies the schema name. Noctemblith must use its
binding rather than its standalone DB defaults in managed mode.

```yaml
db:
  host: db
  port: 5432
  db: manafield
  schema: mf_noctemblith
  user: example_user
  pass: change_me
```

All configured schema names must be valid lowercase PostgreSQL identifiers.
Runtime PostgreSQL connections set their session `search_path` through startup
options so raw SQL and trigger functions resolve within the correct schema.
Never put credentials into Git or a public Instance Definition.

## How this baseline was generated and checked

- A disposable PostgreSQL 18.6 instance replayed all 350 original migration
  `up()` methods in chronological order against an empty DB.
- `pg_dump --schema-only --no-owner --no-privileges --no-comments` produced the
  reference schema including indexes, constraints, ENUMs, 32 sequences,
  permanent functions and triggers; the temporary replay progress table was
  excluded.
- The baseline was applied into an empty `public` schema and into a separately
  created `mf_noctemblith` schema in independent disposable DBs.
- Full normalized PG18 schema dumps matched the historical reference byte for
  byte in both cases, including indexes and constraints. This confirms schema
  structure parity for **new, empty installations**, not application E2E or
  data migration compatibility.
- Local static regression test: `cd packages/backend && node --test scripts/test-schema-baseline.mjs`.

Future migration scripts must not hard-code `public`, must support `db.schema`,
and must remain reversible where safe. PG18 end-to-end migration/boot tests and
migration-history reconciliation for already deployed DBs remain separate tasks.
