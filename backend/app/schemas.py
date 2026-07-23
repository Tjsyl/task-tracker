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


# ---------- Tasks (shared by public + manager/admin views) ----------

class PublicTask(BaseModel):
    """A task row. Leaf tasks (no subtasks) are independently checkable.
    A task with subtasks is a "master": is_master is True, checked is derived
    (all subtasks checked), and it has no independent checkbox in the UI --
    the frontend must not render one and the API rejects direct toggles."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    text: str
    checked: bool
    is_master: bool = False
    subtasks: List["PublicTask"] = Field(default_factory=list)


PublicTask.model_rebuild()


class PublicTaskList(BaseModel):
    """No list_key here -- the internal key never surfaces on the public view.
    tasks only contains top-level tasks; subtasks are nested inside each."""
    id: int
    name: str
    tasks: List[PublicTask]


class DateOption(BaseModel):
    date: date


class ToggleResponse(BaseModel):
    """Response to a checkbox toggle. `parent` is populated (and reflects the
    master's freshly-recomputed checked state) when the toggled task is a
    subtask, so the frontend can grey out the master without a full reload."""
    task: PublicTask
    parent: Optional[PublicTask] = None


# ---------- Manager / Admin view ----------

class TaskListDetail(BaseModel):
    id: int
    name: str
    list_key: str  # visible to authenticated manager/admin only
    date: date
    created_at: datetime
    created_by: str
    tasks: List[PublicTask]  # top-level only, same nesting as PublicTaskList


class TaskInput(BaseModel):
    """One top-level task at list-creation time, optionally with subtasks.
    Giving it subtasks makes it a master task (no checkbox of its own)."""
    text: str = Field(min_length=1, max_length=500)
    subtasks: List[str] = Field(default_factory=list)


class CreateTaskListRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    date: date
    tasks: List[TaskInput] = Field(default_factory=list)


class CreateTaskRequest(BaseModel):
    """Adds a new top-level task to an existing list."""
    text: str = Field(min_length=1, max_length=500)


class CreateSubtaskRequest(BaseModel):
    """Adds a subtask under an existing top-level task, making that task a master."""
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
    is_master: bool = False


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
