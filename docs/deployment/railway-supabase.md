# Deploying Presenton on Railway (with broker-marketplace's Supabase)

This guides deploying Presenton as a single Docker container on Railway, backed by
broker-marketplace's existing **Supabase Postgres** (dedicated `presenton` schema)
and **Supabase Storage**, authenticated via **Clerk** for embedding in an iframe.

Sections marked _(Phase N)_ are filled in as that workstream lands. This file is
the operator runbook; see `/Users/russellpetty/.claude/plans/` for the design.

---

## 1. One-time Supabase setup — Postgres schema + least-privilege role

Run this once in the Supabase **SQL Editor** of the project you're sharing with
broker-marketplace. It isolates Presenton's tables in a `presenton` schema with a
dedicated role, so Presenton's start-up migrations can never touch broker-marketplace's
`public` tables.

```sql
-- 1. Dedicated schema for all Presenton tables.
create schema if not exists presenton;

-- 2. Least-privilege role Presenton connects as (NOT postgres/service_role).
--    Replace the password; store it only in Railway secrets.
do $$
begin
  if not exists (select from pg_roles where rolname = 'presenton_app') then
    create role presenton_app login password 'REPLACE_WITH_STRONG_PASSWORD';
  end if;
end $$;

-- 3. Grants: full control of its own schema, nothing else sensitive.
grant connect on database postgres to presenton_app;
grant usage, create on schema presenton to presenton_app;
grant usage on schema public to presenton_app;  -- for built-in type resolution only

-- 4. Make the role own future objects it creates in its schema.
alter default privileges in schema presenton
  grant all on tables to presenton_app;
alter default privileges in schema presenton
  grant all on sequences to presenton_app;
```

Notes:
- Do **not** add `presenton` to Supabase → Project Settings → Data API → *Exposed schemas*.
  That keeps Presenton's tables invisible to Supabase's auto-generated REST/GraphQL API.
- Alembic creates the `alembic_version` table inside `presenton` too (configured via
  `version_table_schema`; see `servers/fastapi/alembic/env.py`).

## 2. Connection string (session pooler)

Use the **Session pooler** string (IPv4, persistent connections — matches Presenton's
SQLAlchemy connection pool). Do **not** use the Transaction pooler (port 6543): it
breaks asyncpg's prepared-statement cache.

Supabase → Project Settings → Database → Connection string → **Session pooler**, then
swap the user to the dedicated role and append `?sslmode=require` (Presenton only enables
TLS when it sees `sslmode`):

```
postgresql://presenton_app.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres?sslmode=require
```

This becomes the Railway `DATABASE_URL`. `db_utils.py` rewrites the scheme to
`postgresql+asyncpg://` at runtime and `postgresql+psycopg://` for Alembic automatically;
no manual scheme change needed.

## 3. Railway service

- New project → **Deploy from Dockerfile** (the repo's `Dockerfile`; `railway.json`
  already sets `builder: DOCKERFILE`, healthcheck `/`, restart on failure).
- No persistent Volume is required once Supabase Storage lands _(Phase 3)_ — the
  container is stateless. (For an early Phase-0 smoke test before Storage, local files
  under `/app_data` are ephemeral; that's fine for testing.)
- Railway injects `PORT`; `start.js` rewrites nginx's public `listen` directive to it
  (`configureNginxListenPort`). Internal services stay on 3000/8000/8001.
- Instance size: start at ~2 GB RAM (Chromium export + embeddings are memory-hungry).

## 4. Environment variables

### Database _(Phase 0)_
| Var | Value | Secret |
|-----|-------|--------|
| `DATABASE_URL` | Supabase session-pooler URL with `?sslmode=require` | ✅ |
| `DB_SCHEMA` | `presenton` | |
| `MIGRATE_DATABASE_ON_STARTUP` | `true` | |

### Core / providers _(Phase 0)_
| Var | Value | Secret |
|-----|-------|--------|
| `APP_DATA_DIRECTORY` | `/app_data` | |
| `CAN_CHANGE_KEYS` | `false` (lock keys server-side for a multi-user deploy) | |
| `START_OLLAMA` | `false` | |
| `MEM0_ENABLED` | `false` (Mem0 defaults to a local Ollama that isn't on Railway) | |
| `DISABLE_ANONYMOUS_TRACKING` | `true` | |
| `LLM` + provider key | e.g. `LLM=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL` | ✅ (key) |
| `IMAGE_PROVIDER` (+ key) | e.g. `gpt-image-1.5` / `pexels` + `PEXELS_API_KEY` | ✅ (key) |

Build arg: set `INSTALL_LIBREOFFICE=false` (export uses bundled Chromium/Puppeteer, not
LibreOffice) to shrink the image — verify no document-ingestion path you need shells out
to `soffice`.

### Auth (Clerk) _(Phase 1 — see below once implemented)_
`AUTH_MODE=clerk`, `CLERK_ISSUER`, `CLERK_JWKS_URL` (optional), `CLERK_AUDIENCE` /
`CLERK_AUTHORIZED_PARTIES` (optional), `INTERNAL_API_SECRET` (secret),
`NEXT_PUBLIC_PARENT_ORIGIN`, `ALLOWED_PARENT_ORIGIN`.

For an early smoke test **before** Clerk lands, set `DISABLE_AUTH=true` (behind network
controls) so the app renders with no login. Remove it once `AUTH_MODE=clerk` works.

### Storage (Supabase) _(Phase 3 — see below once implemented)_
`SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_REGION`, `SUPABASE_S3_ACCESS_KEY_ID` (secret),
`SUPABASE_S3_SECRET_ACCESS_KEY` (secret), bucket names.

## 5. Verify
1. Deploy; logs show Alembic running and "Migrations run successfully".
2. In Supabase, the `presenton` schema now contains Presenton's tables + `alembic_version`.
3. `https://<service>.up.railway.app/` returns 200 and renders the app.
4. Load that URL inside a test iframe to confirm it embeds (no `X-Frame-Options` blocks it).
