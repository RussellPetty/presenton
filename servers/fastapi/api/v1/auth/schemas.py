import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class InternalUserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=128)
    password: str = Field(min_length=8, max_length=128)


class PublicUser(BaseModel):
    id: uuid.UUID
    username: str
    role: str
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AuthCredentialsRequest(BaseModel):
    username: str = Field(min_length=3, max_length=128)
    password: str = Field(min_length=8, max_length=128)


class AdminCreateUserRequest(AuthCredentialsRequest):
    pass


class AdminResetPasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)
