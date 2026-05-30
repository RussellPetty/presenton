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

## Current validation deployment (broker-marketplace / production)

Live record of the running setup (secrets live only in Railway, never here):

| Item | Value |
|------|-------|
| Railway project | `broker-marketplace` (`ec2ff9b6-…`), env `production` |
| Railway service | `presenton` (`a4788576-…`) |
| Public URL | https://presenton-production-60a3.up.railway.app |
| Public port | `PORT=8080` (nginx) |
| Supabase project | `marketplace` (`ykpmcgklarfoqsorbdgf`), schema `presenton`, role `presenton_app` |
| DB host | `aws-1-us-east-2.pooler.supabase.com:5432` (session pooler) |
| LLM | `LLM=google`, `GOOGLE_MODEL=gemini-3.1-flash-lite` (key reused from the `Production!` service) |
| Images | `IMAGE_PROVIDER=pexels` (key reused from `Production!`) |
| `NEXT_PUBLIC_URL` | `http://127.0.0.1:8080` (internal nginx port for server-side export/schema fetches; start.js also defaults it) |
| Auth | `DISABLE_AUTH=true` for this validation pass; flip to `AUTH_MODE=clerk` after the frontend bridge lands |
| Clerk issuer (for later) | `https://clerk.broker-marketplace.com` |

**✅ Validated 2026-05-30:** end-to-end deploy works — Alembic migrations created all
tables in the `presenton` schema, FastAPI serves DB-backed endpoints, and a full
3-slide deck generated via Gemini 3.1 Flash Lite + Pexels + Chromium PPTX export and
persisted to Supabase (`presenton.presentations`/`slides`). Deploy-specific fixes
required (all committed): Dockerfile cache mounts removed (Railway builder), `$PORT`
nginx bind, `sslmode=require` → encrypt-without-verify (Supabase pooler cert), and
internal fetches (`/schema`, `/api/template*`) routed to the nginx port instead of
hardcoded `:80`.

Validation pass is `CAN_CHANGE_KEYS=true` (skips strict model checks at boot); switch to `false` once confirmed. To move to real auth: build the frontend token bridge (Phase 1 frontend), create a Clerk JWT template, then set `AUTH_MODE=clerk`, `CLERK_ISSUER`, `NEXT_PUBLIC_PARENT_ORIGIN`, and remove `DISABLE_AUTH`.

## Phase 3 — Supabase Storage (stateless container)

**Foundation: DONE + validated.** `servers/fastapi/services/object_storage.py` does
upload/sign/download/delete via the Storage REST API + service-role key (reuses
broker-marketplace's Supabase creds — no S3 keys), against the private `presentations`
bucket with per-user keys (`{user_id}/{category}/{name}`). Round-trip verified against the
live bucket. Gated by `STORAGE_BACKEND` (default `local` → filesystem unchanged).

Enable env (Railway `presenton` service): `STORAGE_BACKEND=supabase`,
`SUPABASE_URL=${{Production.SUPABASE_URL}}`, `SUPABASE_SERVICE_ROLE_KEY` (secret),
`SUPABASE_STORAGE_BUCKET=presentations`.

**Remaining rewire (one focused, gated pass — touches the working export/image pipeline,
so do it carefully + validate against the bucket):**

1. **Serving model (private bucket):** add a FastAPI proxy endpoint
   `GET /api/v1/ppt/assets/{user_id}/{category}/{name}` that ownership-checks (path
   `user_id` == caller, or internal-service) and streams the object from Storage. Stable
   URLs (no signed-URL expiry) that work for the browser **and** the headless export
   renderer (internal auth). (Signed URLs are fine for one-shot export downloads.)
2. **Images** (`api/v1/ppt/endpoints/images.py` + `utils/process_slides.py`): when supabase,
   upload generated/uploaded images to `{user_id}/images/{uuid}` and reference them via the
   proxy URL in slide content; teach `utils/asset_directory_utils.py` URL normalization to
   pass the proxy path through.
3. **Exports** (`utils/export_utils.py` + `api/v1/ppt/endpoints/presentation.py` + the Next.js
   `app/api/export-presentation/file` route): thread `user_id` into `export_presentation`;
   after the export, upload the pptx/pdf to `{user_id}/exports/{name}` and store the key on
   `PresentationModel.file_paths`; add a FastAPI download endpoint that ownership-checks and
   mints a short-lived signed URL (the Next.js route proxies to it).
4. **Fonts** (`api/v1/ppt/endpoints/fonts.py`): store in Storage; download into the local font
   dir at render time (fonts are consumed server-side by Chromium/LiteParse).
5. **nginx**: in supabase mode the `/app_data/*` static + `auth_request` blocks are unused
   (assets flow through the proxy/Storage); leave or remove.
6. **Validate** (have the creds + bucket): deploy with `STORAGE_BACKEND=supabase`; generate +
   export a deck; confirm images render, the export downloads, and both survive a container
   **restart** (the point of statelessness). Then drop the Railway volume / raise `numReplicas`.

## 5. Verify
1. Deploy; logs show Alembic running and "Migrations run successfully".
2. In Supabase, the `presenton` schema now contains Presenton's tables + `alembic_version`.
3. `https://<service>.up.railway.app/` returns 200 and renders the app.
4. Load that URL inside a test iframe to confirm it embeds (no `X-Frame-Options` blocks it).
