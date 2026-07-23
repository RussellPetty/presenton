import logging
import os

from sqlalchemy import func, select, update

from api.v1.auth.users import PASSWORD_HELPER
from models.sql.user import User
from models.sql.async_task import AsyncTaskModel
from models.sql.async_presentation_generation_status import (
    AsyncPresentationGenerationTaskModel,
)
from models.sql.chat_history_message import ChatHistoryMessageModel
from models.sql.image_asset import ImageAsset
from models.sql.key_value import KeyValueSqlModel
from models.sql.presentation import PresentationModel
from models.sql.presentation_layout_code import PresentationLayoutCodeModel
from models.sql.slide import SlideModel
from models.sql.template import TemplateModel
from models.sql.template_create_info import TemplateCreateInfoModel
from models.sql.template_v2 import TemplateV2
from models.sql.webhook_subscription import WebhookSubscription
from services.database import async_session_maker
from utils.simple_auth import get_legacy_admin_credentials


logger = logging.getLogger(__name__)


def _truthy(value: str | None) -> bool:
    return bool(value and value.strip().lower() in {"1", "true", "yes", "on"})


async def bootstrap_database_admin() -> None:
    """Migrate the old single-admin account or initialize it from environment."""
    async with async_session_maker() as session:
        admin = await session.scalar(
            select(User).where(User.is_superuser.is_(True)).limit(1)
        )
        env_password = os.getenv("AUTH_PASSWORD")
        if admin is not None:
            if _truthy(os.getenv("AUTH_OVERRIDE_FROM_ENV")) and env_password:
                admin.hashed_password = PASSWORD_HELPER.hash(env_password)
                admin.auth_version += 1
                await session.commit()
                logger.warning("Reset bootstrap admin password from environment.")
            await _backfill_legacy_ownership(session, admin)
            return

        account_count = int(
            await session.scalar(select(func.count()).select_from(User)) or 0
        )
        if account_count:
            raise RuntimeError(
                "User accounts exist but no bootstrap administrator is configured"
            )

        legacy_username, legacy_hash = get_legacy_admin_credentials()
        username = legacy_username or (os.getenv("AUTH_USERNAME") or "").strip()
        if not username:
            return

        if legacy_hash:
            password_hash = legacy_hash
        elif env_password:
            password_hash = PASSWORD_HELPER.hash(env_password)
        else:
            return

        admin = User(
            username=username,
            hashed_password=password_hash,
            is_active=True,
            is_verified=True,
            is_superuser=True,
            auth_version=1,
        )
        session.add(admin)
        await session.commit()
        await session.refresh(admin)
        await _backfill_legacy_ownership(session, admin)
        logger.info("Migrated the bootstrap administrator into the user database.")


async def _backfill_legacy_ownership(session, admin: User) -> None:
    owned_models = (
        PresentationModel,
        SlideModel,
        PresentationLayoutCodeModel,
        TemplateModel,
        AsyncTaskModel,
        AsyncPresentationGenerationTaskModel,
        ChatHistoryMessageModel,
        ImageAsset,
        TemplateCreateInfoModel,
        WebhookSubscription,
    )
    for model in owned_models:
        await session.execute(
            update(model)
            .where(model.owner_id.is_(None))
            .values(owner_id=admin.id)
        )
    # Built-in templates intentionally remain shared; only custom templates
    # migrate into the bootstrap admin's private workspace.
    await session.execute(
        update(TemplateV2)
        .where(TemplateV2.owner_id.is_(None), TemplateV2.is_default.is_(False))
        .values(owner_id=admin.id)
    )
    await session.execute(
        update(KeyValueSqlModel)
        .where(KeyValueSqlModel.key == "presentation_custom_themes")
        .values(key=f"presentation_custom_themes:{admin.id}")
    )
    await session.commit()
