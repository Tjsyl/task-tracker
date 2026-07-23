"""Pydantic request/response models."""
from datetime import datetime, date
from typing import Optional, List, Literal

from pydantic import BaseModel, Field, ConfigDict


# ---------- Auth ----------

class LoginRequest(BaseModel):
    username: str
    pin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class LoginResponse(BaseModel):
    role: Literal["admin", "manager"]
    username: str


# ---------- Public view ----------

class PublicTask(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    text: str
    checked: bool


class PublicTaskList(BaseModel):
    """No list_key here -- the internal key never surfaces on the public view."""
    id: int
    name: str
    tasks: List[PublicTask]


class DateOption(BaseModel):
    date: date


# ---------- Manager / Admin view ----------

class TaskListDetail(BaseModel):
    id: int
    name: str
    list_key: str  # visible to authenticated manager/admin only
    date: date
    created_at: datetime
    created_by: str
    tasks: List[PublicTask]


class CreateTaskListRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    date: date
    task_texts: List[str] = Field(default_factory=list)


class CreateTaskRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class UpdateTaskRequest(BaseModel):
    text: Optional[str] = Field(default=None, min_length=1, max_length=500)
    checked: Optional[bool] = None


class AuditEntry(BaseModel):
    id: int
    task_id: int
    task_text: str
    list_name: str
    action: str
    timestamp: datetime


# ---------- Admin: user management ----------

class CreateUserRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    pin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    role: Literal["admin", "manager"]


class UpdateUserPinRequest(BaseModel):
    pin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class UserOut(BaseModel):
    id: int
    username: str
    role: str
