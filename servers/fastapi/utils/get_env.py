import os


def _is_truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_can_change_keys_env():
    return os.getenv("CAN_CHANGE_KEYS")


def get_database_url_env():
    return os.getenv("DATABASE_URL")


def get_db_schema_env():
    """Optional Postgres schema that all Presenton tables live in.

    Set this (e.g. DB_SCHEMA=presenton) to isolate Presenton's tables when
    sharing a Postgres database/project with another app (e.g. a Supabase
    project also used by broker-marketplace). Ignored for SQLite. The schema
    must already exist or the DB role must be able to create it (see
    alembic/env.py)."""
    value = os.getenv("DB_SCHEMA")
    return value.strip() if value and value.strip() else None


def get_app_data_directory_env():
    return os.getenv("APP_DATA_DIRECTORY")


def get_fastapi_public_base_url() -> str | None:
    """
    Public origin where FastAPI serves /app_data and /static (no trailing slash).

    Uses NEXT_PUBLIC_FAST_API (same value Electron and the export runtime inject for the UI).
    When unset, callers keep path-only URLs for same-origin / reverse-proxy setups (e.g. Docker).
    """
    v = (os.getenv("NEXT_PUBLIC_FAST_API") or "").strip().rstrip("/")
    return v or None


def get_temp_directory_env():
    return os.getenv("TEMP_DIRECTORY")


def get_storage_backend_env() -> str:
    """'local' (default, filesystem under APP_DATA_DIRECTORY) or 'supabase'
    (Supabase Storage). Gates services/object_storage.py."""
    return (os.getenv("STORAGE_BACKEND") or "local").strip().lower()


def is_supabase_storage_enabled() -> bool:
    return get_storage_backend_env() == "supabase"


def get_supabase_url_env():
    value = os.getenv("SUPABASE_URL")
    return value.strip().rstrip("/") if value and value.strip() else None


def get_supabase_service_role_key_env():
    value = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    return value.strip() if value and value.strip() else None


def get_supabase_storage_bucket_env() -> str:
    value = os.getenv("SUPABASE_STORAGE_BUCKET")
    return value.strip() if value and value.strip() else "presentations"


def get_internal_app_base_url() -> str:
    """Loopback base URL for server-side fetches of nginx/Next.js-served pages
    (template `/schema`, `/api/template`, `/api/template/custom`).

    Defaults via NEXT_PUBLIC_URL, which start.js pins to nginx's internal port
    (matching $PORT on Railway). The bare `http://127.0.0.1` fallback only works
    when nginx listens on port 80."""
    return (os.getenv("NEXT_PUBLIC_URL") or "").strip().rstrip("/") or "http://127.0.0.1"


def get_user_config_path_env():
    return os.getenv("USER_CONFIG_PATH")


def get_disable_auth_env():
    return os.getenv("DISABLE_AUTH")


def is_disable_auth_enabled():
    return _is_truthy(get_disable_auth_env())


# --- Clerk auth (iframe embedding) -----------------------------------------
# When AUTH_MODE=clerk, Presenton trusts a Clerk-issued JWT (verified against
# the Clerk instance's JWKS) instead of its built-in single-user login. See
# utils/clerk_auth.py and api/middlewares.py.


def get_auth_mode_env():
    return os.getenv("AUTH_MODE")


def is_clerk_auth_enabled() -> bool:
    return (get_auth_mode_env() or "").strip().lower() == "clerk"


def get_clerk_issuer_env():
    """First configured Clerk issuer (back-compat). Prefer get_clerk_issuers()."""
    issuers = get_clerk_issuers()
    return issuers[0] if issuers else None


def get_clerk_issuers() -> list[str]:
    """Allow-list of trusted Clerk issuers (comma-separated CLERK_ISSUER).

    Supports embedding from multiple Clerk instances (e.g. a dev instance for the
    local broker app and a prod custom-domain instance). Each token is verified
    against the JWKS of its own `iss`, but only if `iss` is in this list."""
    raw = os.getenv("CLERK_ISSUER") or ""
    return [i.strip().rstrip("/") for i in raw.split(",") if i.strip()]


def get_clerk_jwks_url_env():
    """Explicit JWKS URL; defaults to {CLERK_ISSUER}/.well-known/jwks.json when unset."""
    value = os.getenv("CLERK_JWKS_URL")
    return value.strip() if value and value.strip() else None


def get_clerk_audience_env():
    value = os.getenv("CLERK_AUDIENCE")
    return value.strip() if value and value.strip() else None


def get_clerk_authorized_parties_env():
    """Optional allow-list of `azp` values (comma-separated), or None."""
    raw = os.getenv("CLERK_AUTHORIZED_PARTIES")
    if not raw:
        return None
    parties = [p.strip() for p in raw.split(",") if p.strip()]
    return parties or None


def get_internal_api_secret_env():
    """Shared secret for trusted service-to-service calls (MCP, export renderer,
    template SSR) that have no Clerk user token. See api/middlewares.py."""
    value = os.getenv("INTERNAL_API_SECRET")
    return value.strip() if value and value.strip() else None


def get_llm_provider_env():
    return os.getenv("LLM")


def get_anthropic_api_key_env():
    return os.getenv("ANTHROPIC_API_KEY")


def get_anthropic_model_env():
    return os.getenv("ANTHROPIC_MODEL")


def get_ollama_url_env():
    return os.getenv("OLLAMA_URL")


def get_custom_llm_url_env():
    return os.getenv("CUSTOM_LLM_URL")


def get_openai_api_key_env():
    return os.getenv("OPENAI_API_KEY")


def get_openai_model_env():
    return os.getenv("OPENAI_MODEL")


def get_google_api_key_env():
    return os.getenv("GOOGLE_API_KEY")


def get_google_model_env():
    return os.getenv("GOOGLE_MODEL")


def get_vertex_api_key_env():
    return os.getenv("VERTEX_API_KEY")


def get_vertex_model_env():
    return os.getenv("VERTEX_MODEL")


def get_vertex_project_env():
    return os.getenv("VERTEX_PROJECT")


def get_vertex_location_env():
    return os.getenv("VERTEX_LOCATION")


def get_vertex_base_url_env():
    return os.getenv("VERTEX_BASE_URL")


def get_azure_openai_api_key_env():
    return os.getenv("AZURE_OPENAI_API_KEY")


def get_azure_openai_model_env():
    return os.getenv("AZURE_OPENAI_MODEL")


def get_azure_openai_endpoint_env():
    return os.getenv("AZURE_OPENAI_ENDPOINT")


def get_azure_openai_base_url_env():
    return os.getenv("AZURE_OPENAI_BASE_URL")


def get_azure_openai_api_version_env():
    return os.getenv("AZURE_OPENAI_API_VERSION")


def get_azure_openai_deployment_env():
    return os.getenv("AZURE_OPENAI_DEPLOYMENT")


def get_bedrock_region_env():
    return os.getenv("BEDROCK_REGION")


def get_bedrock_api_key_env():
    return os.getenv("BEDROCK_API_KEY")


def get_bedrock_aws_access_key_id_env():
    return os.getenv("BEDROCK_AWS_ACCESS_KEY_ID")


def get_bedrock_aws_secret_access_key_env():
    return os.getenv("BEDROCK_AWS_SECRET_ACCESS_KEY")


def get_bedrock_aws_session_token_env():
    return os.getenv("BEDROCK_AWS_SESSION_TOKEN")


def get_bedrock_profile_name_env():
    return os.getenv("BEDROCK_PROFILE_NAME")


def get_bedrock_model_env():
    return os.getenv("BEDROCK_MODEL")


def get_openrouter_api_key_env():
    return os.getenv("OPENROUTER_API_KEY")


def get_openrouter_model_env():
    return os.getenv("OPENROUTER_MODEL")


def get_openrouter_base_url_env():
    return os.getenv("OPENROUTER_BASE_URL")


def get_fireworks_api_key_env():
    return os.getenv("FIREWORKS_API_KEY")


def get_fireworks_model_env():
    return os.getenv("FIREWORKS_MODEL")


def get_fireworks_base_url_env():
    return os.getenv("FIREWORKS_BASE_URL")


def get_together_api_key_env():
    return os.getenv("TOGETHER_API_KEY")


def get_together_model_env():
    return os.getenv("TOGETHER_MODEL")


def get_together_base_url_env():
    return os.getenv("TOGETHER_BASE_URL")


def get_cerebras_api_key_env():
    return os.getenv("CEREBRAS_API_KEY")


def get_cerebras_model_env():
    return os.getenv("CEREBRAS_MODEL")


def get_cerebras_base_url_env():
    return os.getenv("CEREBRAS_BASE_URL")


def get_litellm_base_url_env():
    return os.getenv("LITELLM_BASE_URL")


def get_litellm_api_key_env():
    return os.getenv("LITELLM_API_KEY")


def get_litellm_model_env():
    return os.getenv("LITELLM_MODEL")


def get_lmstudio_base_url_env():
    return os.getenv("LMSTUDIO_BASE_URL")


def get_lmstudio_api_key_env():
    return os.getenv("LMSTUDIO_API_KEY")


def get_lmstudio_model_env():
    return os.getenv("LMSTUDIO_MODEL")


def get_custom_llm_api_key_env():
    return os.getenv("CUSTOM_LLM_API_KEY")


def get_ollama_model_env():
    return os.getenv("OLLAMA_MODEL")


def get_custom_model_env():
    return os.getenv("CUSTOM_MODEL")


def get_pexels_api_key_env():
    return os.getenv("PEXELS_API_KEY")


def get_disable_image_generation_env():
    return os.getenv("DISABLE_IMAGE_GENERATION")


def get_image_provider_env():
    return os.getenv("IMAGE_PROVIDER")


def get_pixabay_api_key_env():
    return os.getenv("PIXABAY_API_KEY")


def get_disable_thinking_env():
    return os.getenv("DISABLE_THINKING")


def get_extended_reasoning_env():
    return os.getenv("EXTENDED_REASONING")


def get_web_grounding_env():
    return os.getenv("WEB_GROUNDING")


def get_comfyui_url_env():
    return os.getenv("COMFYUI_URL")


def get_comfyui_workflow_env():
    return os.getenv("COMFYUI_WORKFLOW")


# Dalle 3 Quality
def get_dall_e_3_quality_env():
    return os.getenv("DALL_E_3_QUALITY")


# Gpt Image 1.5 Quality
def get_gpt_image_1_5_quality_env():
    return os.getenv("GPT_IMAGE_1_5_QUALITY")


# Codex OAuth
def get_codex_access_token_env():
    return os.getenv("CODEX_ACCESS_TOKEN")


def get_codex_refresh_token_env():
    return os.getenv("CODEX_REFRESH_TOKEN")


def get_codex_token_expires_env():
    return os.getenv("CODEX_TOKEN_EXPIRES")


def get_codex_account_id_env():
    return os.getenv("CODEX_ACCOUNT_ID")


def get_codex_username_env():
    return os.getenv("CODEX_USERNAME")


def get_codex_email_env():
    return os.getenv("CODEX_EMAIL")


def get_codex_is_pro_env():
    return os.getenv("CODEX_IS_PRO")


def get_codex_model_env():
    return os.getenv("CODEX_MODEL")


def get_migrate_database_on_startup_env():
    return os.getenv("MIGRATE_DATABASE_ON_STARTUP")


def get_sentry_dsn_env():
    return os.getenv("SENTRY_DSN")


def get_sentry_traces_sample_rate_env():
    return os.getenv("SENTRY_TRACES_SAMPLE_RATE")


def get_sentry_send_default_pii_env():
    return os.getenv("SENTRY_SEND_DEFAULT_PII")


# Open WebUI Image Provider
def get_open_webui_image_url_env():
    return os.getenv("OPEN_WEBUI_IMAGE_URL")


def get_open_webui_image_api_key_env():
    return os.getenv("OPEN_WEBUI_IMAGE_API_KEY")


# OpenAI Compatible Image Provider
def get_openai_compat_image_base_url_env():
    return os.getenv("OPENAI_COMPAT_IMAGE_BASE_URL")


def get_openai_compat_image_api_key_env():
    return os.getenv("OPENAI_COMPAT_IMAGE_API_KEY")


def get_openai_compat_image_model_env():
    return os.getenv("OPENAI_COMPAT_IMAGE_MODEL")
