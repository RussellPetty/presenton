from datetime import datetime
import secrets
from typing import Any, Optional

from sqlalchemy import JSON, Column, DateTime, String
from sqlmodel import Field, SQLModel

from enums.async_task_status import AsyncTaskStatus
from utils.datetime_utils import get_current_utc_datetime


class AsyncTaskModel(SQLModel, table=True):
    __tablename__ = "async_tasks"

    id: str = Field(
        default_factory=lambda: f"task-{secrets.token_hex(32)}",
        primary_key=True,
    )
    type: str = Field(index=True)
    status: AsyncTaskStatus = Field(
        sa_column=Column(String, index=True, nullable=False),
    )
    message: Optional[str] = None
    error: Optional[dict[str, Any]] = Field(sa_column=Column(JSON), default=None)
    data: Optional[dict[str, Any]] = Field(sa_column=Column(JSON), default=None)
    created_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            default=get_current_utc_datetime,
        )
    )
    updated_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            default=get_current_utc_datetime,
            onupdate=get_current_utc_datetime,
        )
    )
