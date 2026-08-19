# Rebuild on upstream (`feat/rebuild-v2-clerk-supabase`)

Our previous fork (`feat/railway-clerk-supabase`) branched from upstream on
2026-05-30 and ended up 1033 commits behind. A trial merge produced 70
conflicted files and deleted 253 files, 207 of them our template library, so
merging was not viable. This branch instead starts from `upstream/main` and
re-applies our customizations deliberately.

## Why this was cheaper than merging

Upstream built, properly, three things the old fork hand-rolled:

| Old fork | Upstream today |
|---|---|
| Parallel `user_id TEXT` column and per-endpoint scoping | `owner_id` on 11 tables, filtered on every SELECT by a `do_orm_execute` event keyed on a ContextVar |
| Clerk threaded through `api/middlewares.py` | One chokepoint: `resolve_request_principal()` |
| `#exportToken=…&exportUserId=…` URL-fragment hack | `auth/internal.py` mints an owner-scoped session JWT |

So the Clerk graft is now a branch in one function plus a find-or-create, and
tenant isolation comes for free.

## What we changed

- **`utils/clerk_auth.py`** — verify RS256 Clerk JWTs against the issuing
  instance's JWKS, restricted to the `CLERK_ISSUER` allow-list. Ported
  unchanged from the old fork.
- **`api/v1/auth/principal.py`** — in `AUTH_MODE=clerk`, resolve identity from
  a bearer token. Clerk subjects are auto-provisioned as `clerk:<sub>` User
  rows; the prefix namespaces them so a Clerk subject can never bind to a
  locally created account, which could be a superuser.
  `INTERNAL_API_SECRET` (compared with `compare_digest`) authenticates
  service-to-service calls and may act as a user via `X-Presenton-User-Id` —
  but impersonation does not confer admin.
- **`api/middlewares.py`** — skip the "login setup required" gate, never proxy
  to Presenton Cloud, and mint the export session cookie for Clerk principals.
- **`api/v1/auth/bootstrap.py`** — no local administrator in Clerk mode.
- **`services/object_storage.py` + `utils/export_utils.py`** — exports offload
  to Supabase Storage and return a signed URL, keyed by owner UUID taken from
  the same ContextVar that scopes queries. Upstream has no storage abstraction
  at all, so this is entirely ours.
- **`servers/nextjs/utils/clerkToken.ts`** — the postMessage bridge, plus a
  narrowly scoped `fetch` interceptor that attaches the bearer to same-origin
  `/api/` calls. SSE uses `withSseToken()` because EventSource cannot set
  headers.
- **Telemetry removed.** Upstream hardcodes its own Mixpanel token and its
  enable check failed open. `utils/mixpanel.ts` is now a no-op shim; the event
  enum and signatures are kept so the ~75 call sites still compile and could be
  pointed at our own PostHog in one file.
- **Deploy config** — `railway.json`, no BuildKit cache mounts, and nginx bound
  to the injected `$PORT`.

## Verified end to end

Local SQLite + Clerk mode, both servers running:

- unauthenticated 401, bad secret 401, forged `__internal_service__` 401
- `?token=` rejected everywhere except the two SSE routes
- cross-tenant read returns 404; per-owner list counts isolate correctly
- impersonated caller refused on admin-only routes (403), service account allowed
- generate + export produces a real 3-page PDF and a 3-slide PPTX
- with `STORAGE_BACKEND=supabase`, the export returns a signed URL that
  downloads and the local copy is removed
- 634 backend unit tests pass; `tsc --noEmit` clean


## Model + image configuration

Text and imagery both run through the Cursor-subscription proxy
(`llm.broker-marketplace.com`), so there is one gateway and one bill.

```bash
# text
LLM=custom
CUSTOM_LLM_URL=https://llm.broker-marketplace.com/v1
CUSTOM_LLM_API_KEY=<sk-cursor-...>
CUSTOM_MODEL=cursor-grok-4.6-low

# imagery, same gateway via its OpenAI-compatible images endpoint
IMAGE_PROVIDER=openai_compatible
OPENAI_COMPAT_IMAGE_BASE_URL=https://llm.broker-marketplace.com/v1
OPENAI_COMPAT_IMAGE_API_KEY=<sk-cursor-...>
OPENAI_COMPAT_IMAGE_MODEL=cursor-grok-4.6-low

# the gateway caps concurrent requests (a 5th in-flight call gets 429) and
# presenton fans a whole batch of slides out at once
LLM_MAX_CONCURRENCY=3
LLM_RATE_LIMIT_MAX_RETRIES=4
```

Two things about this gateway are worth knowing before changing the model:

- It wraps `cursor-agent`, so `response_format=json_schema` is a strong hint
  rather than a guarantee — the model narrates before its JSON. That is handled
  by `utils/llm_json_compat.py`; do not remove it when switching providers.
- Image generation returns 1536x1024 PNGs regardless of the requested `size`,
  which makes exports noticeably larger than with stock photography.

`gemini_flash` / `nanobanana_pro` remain configured and working as fallbacks
(`GEMINI_IMAGE_MODEL`, `NANOBANANA_IMAGE_MODEL`), defaulting to current models
rather than upstream's two-generations-old pin.

## Adversarial review

An adversarial security review of this branch (Codex, gpt-5.6-sol, max
reasoning) found ten issues. Everything critical and high is fixed and
re-verified; see the commit log for each. The headline one was reproduced end
to end before fixing: on a fresh Clerk-mode database, `/api/v1/auth/setup` was
still reachable and its only guard is "no accounts exist yet", so an
unauthenticated caller could create the first account as a superuser, log in,
and use the resulting cookie against `/api/v1/admin/users` — and by naming that
account `clerk:<victim-sub>`, pre-bind a Clerk identity onto it.

Still open, deliberately:

- **Unsanitized `html_content` on the export page.** Upstream renders it
  without sanitizing, so a slide can run script inside the headless exporter.
  We bounded the damage by cutting the export credential's life to 15 minutes,
  but this wants DOMPurify plus a CSP on `/pdf-maker`.
- **No per-tenant quotas or rate limits.** `/derive` spawns a browser and a
  converter per call with no semaphore, and deleting a presentation does not
  delete its stored exports.
- **SQLite provisioning can surface `SQLITE_BUSY`** as a 500 under concurrent
  first requests. The Postgres path (rollback, re-read) is sound, and
  production is Postgres.
- **Password hashing runs on the event loop** during first-sight provisioning.

## Known gaps

1. **The template library does not come across.** `V1ContentRender.tsx:215`
   returns a blank white div for any non-TemplateV2 slide, and upstream ships
   no V1→V2 converter (`scripts/convert-template.mjs` normalizes
   already-V2-shaped JSON). Our 193 `.tsx` layouts across 13 families are not
   portable; this branch has upstream's 8 V2 families. Families with no
   equivalent: `neo-general`, `neo-modern`, `neo-standard`, `neo-swift`,
   `Code`, `Education`, `pitch-deck`, `ProductOverview`, `Report`.
2. **Brand theming is not reimplemented.** `utils/brand_theme.py` and the
   per-slide logo badge were built on V1 React templates. On V2 a slide is a
   konva element tree, so this needs designing rather than porting.
3. **The chat assistant's branding/partner enforcement** is not re-applied;
   upstream rewrote chat around V2 "smart" tools.
4. **Auto-provisioning is unbounded.** Any valid token from an allow-listed
   issuer creates a User row. `CLERK_ISSUER` currently includes a
   `*.clerk.accounts.dev` dev instance that permits open signup — review that
   before this branch goes anywhere near production.
5. Local macOS export needs `PUPPETEER_CACHE_DIR` set and Chrome for Testing
   installed; `TempFileService` cleanup also chokes on `.app` symlinks if Chrome
   is ever downloaded under `TEMP_DIRECTORY`.

## Running it locally

```bash
export APP_DATA_DIRECTORY=~/presenton-local/app_data
export TEMP_DIRECTORY=~/presenton-local/temp
export AUTH_MODE=clerk DISABLE_AUTH=false CAN_CHANGE_KEYS=false
export INTERNAL_API_SECRET=<local-only value>
export CLERK_ISSUER=<comma-separated issuers>
export LLM=google GOOGLE_API_KEY=... GOOGLE_MODEL=gemini-3.1-flash-lite
export NEXT_PUBLIC_URL=http://127.0.0.1:3000 NEXT_PUBLIC_FAST_API=http://127.0.0.1:8000
export PUPPETEER_CACHE_DIR=~/presenton-local/puppeteer-cache

cd servers/fastapi && uv sync && ./.venv/bin/python server.py --port 8000
cd servers/nextjs && npm install && npm run dev
node scripts/sync-presentation-export.cjs     # platform-aware
```

The database defaults to SQLite under `APP_DATA_DIRECTORY`; no Postgres needed.
