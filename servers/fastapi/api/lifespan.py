from contextlib import asynccontextmanager
import logging
import os

from fastapi import FastAPI

from migrations import migrate_database_on_startup
from services.database import create_db_and_tables, dispose_engines
from utils.get_env import get_app_data_directory_env, is_clerk_auth_enabled
from utils.model_availability import (
    check_llm_and_image_provider_api_or_model_availability,
)
from utils.simple_auth import (
    clear_stored_credentials,
    force_set_credentials,
    is_auth_configured,
    setup_initial_credentials,
)

logger = logging.getLogger(__name__)


def _configure_application_logging() -> None:
    """Honor LOG_LEVEL (default INFO) so template/export diagnostics are visible."""
    raw = (os.getenv("LOG_LEVEL") or "INFO").strip().upper()
    level = getattr(logging, raw, logging.INFO)
    logging.getLogger().setLevel(level)


def _is_truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _bootstrap_auth_from_env() -> None:
    """
    Bootstrap the single-user login from environment variables.

    Behaviour:
      - RESET_AUTH=true         -> wipe stored credentials (recovery path).
      - AUTH_USERNAME + AUTH_PASSWORD set:
          * if no credentials configured   -> create them (first-run preseed).
          * if AUTH_OVERRIDE_FROM_ENV=true -> overwrite existing credentials.
      - Otherwise do nothing; the login UI will run in setup-mode on first
        visit and in sign-in-mode afterwards.

    Any errors here are logged and swallowed so a bad env value can never
    brick the app — the operator can always fall back to the UI/reset flow.
    """
    try:
        if _is_truthy(os.getenv("RESET_AUTH")):
            clear_stored_credentials()
            logger.warning(
                "RESET_AUTH is set; cleared stored login credentials. "
                "The next visit will prompt for setup."
            )

        env_username = os.getenv("AUTH_USERNAME")
        env_password = os.getenv("AUTH_PASSWORD")
        if not env_username or not env_password:
            return

        override = _is_truthy(os.getenv("AUTH_OVERRIDE_FROM_ENV"))
        if is_auth_configured() and not override:
            return

        if is_auth_configured() and override:
            force_set_credentials(env_username, env_password)
            logger.warning(
                "AUTH_OVERRIDE_FROM_ENV is set; replaced stored credentials "
                "with values from AUTH_USERNAME/AUTH_PASSWORD."
            )
        else:
            setup_initial_credentials(env_username, env_password)
            logger.info(
                "Initialized login credentials from AUTH_USERNAME/AUTH_PASSWORD."
            )
    except Exception as exc:  # pragma: no cover - defensive, never fatal.
        logger.exception("Failed to bootstrap auth from environment: %s", exc)


@asynccontextmanager
async def app_lifespan(_: FastAPI):
    """
    Lifespan context manager for FastAPI application.
    Initializes the application data directory, runs Alembic migrations when
    MIGRATE_DATABASE_ON_STARTUP=true, creates any missing tables, bootstraps
    the single-user login from env vars (if provided), and checks LLM model
    availability.
    """
    _configure_application_logging()
    # Preserve Gemini thought-signatures across chat tool-call rounds (patches the
    # pinned llmai GoogleClient). Must run before any LLM client is created.
    try:
        from utils.llmai_google_patch import apply as apply_thought_signature_patch

        apply_thought_signature_patch()
    except Exception as exc:  # pragma: no cover - never fatal
        logger.warning("thought-signature patch not applied: %s", exc)
    os.makedirs(get_app_data_directory_env(), exist_ok=True)
    await migrate_database_on_startup()
    await create_db_and_tables()
    # Stateless container: repopulate uploaded fonts from Supabase Storage so the
    # renderer finds them locally. Best-effort — never block startup.
    from utils.get_env import is_supabase_storage_enabled

    if is_supabase_storage_enabled():
        try:
            from services import object_storage
            from api.v1.ppt.endpoints.fonts import get_fonts_directory

            synced = await object_storage.sync_prefix_to_dir("fonts", get_fonts_directory())
            logger.info("Synced %s font(s) from Supabase Storage", synced)
        except Exception as exc:  # pragma: no cover - best effort
            logger.warning("Font sync from storage skipped: %s", exc)
    # Clerk mode delegates identity to the parent app; there is no single-user
    # login to seed from AUTH_USERNAME/AUTH_PASSWORD.
    if not is_clerk_auth_enabled():
        _bootstrap_auth_from_env()
    await check_llm_and_image_provider_api_or_model_availability()
    yield
    # Shutdown: release all database connections to prevent stale/leaked pools.
    await dispose_engines()
