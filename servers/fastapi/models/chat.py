import uuid
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class ChatMessageRequest(BaseModel):
    presentation_id: uuid.UUID
    message: str = Field(min_length=1, max_length=8000)
    conversation_id: Optional[uuid.UUID] = None
    # Branding context forwarded by the embedding app (broker-marketplace) so the
    # assistant can place the user's real logo/headshot/contact/NMLS/disclaimer.
    # `partners` carries the user's connected realtors' branding profiles.
    branding: Optional[dict[str, Any]] = None
    partners: Optional[list[dict[str, Any]]] = Field(default=None, max_length=50)
    # Images the user attached to THIS message (already uploaded → hosted URLs) so
    # the assistant can place them on slides.
    uploaded_images: Optional[list[dict[str, Any]]] = Field(default=None, max_length=20)

    model_config = ConfigDict(extra="forbid")


class ChatMessageResponse(BaseModel):
    conversation_id: uuid.UUID
    response: str
    tool_calls: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class ChatHistoryMessageItem(BaseModel):
    role: str
    content: str
    created_at: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class ChatHistoryResponse(BaseModel):
    presentation_id: uuid.UUID
    conversation_id: uuid.UUID
    messages: list[ChatHistoryMessageItem]

    model_config = ConfigDict(extra="forbid")


class ChatConversationListItem(BaseModel):
    conversation_id: uuid.UUID
    updated_at: Optional[str] = None
    last_message_preview: Optional[str] = None

    model_config = ConfigDict(extra="forbid")
