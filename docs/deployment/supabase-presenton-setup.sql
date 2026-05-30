-- Presenton ⇄ Supabase one-time setup.
-- Run once in the broker-marketplace `marketplace` project (SQL Editor, or as a
-- Supabase migration). Isolates Presenton's tables in a dedicated `presenton`
-- schema owned by a least-privilege role, so Presenton's start-up Alembic
-- migrations can never touch broker-marketplace's `public` tables.
--
-- Replace REPLACE_WITH_STRONG_PASSWORD before running; store the same value in
-- Railway's DATABASE_URL (never commit the real password).

-- 1. Dedicated login role Presenton connects as (NOT postgres / service_role).
do $$
begin
  if not exists (select from pg_roles where rolname = 'presenton_app') then
    create role presenton_app login password 'REPLACE_WITH_STRONG_PASSWORD';
  end if;
end $$;

-- 2. Dedicated schema. Owned by `postgres` (Supabase's SQL Editor role can't
--    SET ROLE to presenton_app, so AUTHORIZATION isn't usable here); the role
--    gets CREATE+USAGE on it and owns every table it creates inside it.
create schema if not exists presenton;
grant usage, create on schema presenton to presenton_app;

-- 3. Minimal extra grants (no access to broker-marketplace's `public` data).
grant connect on database postgres to presenton_app;
grant usage on schema public to presenton_app;  -- built-in type resolution only

-- Do NOT add `presenton` to Supabase → Settings → Data API → Exposed schemas:
-- that keeps Presenton's tables out of the auto-generated REST/GraphQL API.
