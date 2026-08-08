"""Pydantic request/response models."""
from datetime import datetime, date
from datetime import date as _date  # aliased for use inside fields literally named `date`
                                     # with a default -- see UpdateTaskListRequest's comment.
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


class UpdateTaskListRequest(BaseModel):
    """Rename and/or reschedule an existing list. `list_key` (the internal
    uniqueness key) intentionally never changes here -- it's just a historical
    creation-time identifier, not a live label.

    Uses the `_date`-aliased import for the annotation: a field named `date`
    with a `= None` default shadows the module-level `date` type with its own
    (now class-attribute) value at class-body-eval time -- pydantic then
    resolves the annotation against that shadowed name and silently types the
    field as NoneType instead of Optional[date] (confirmed live: it will
    accept `{"date": null}` but reject any real date string). Bare `date:
    date` fields elsewhere in this file are fine since they have no default,
    so no attribute-with-that-name ever gets written to the class dict."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    date: Optional[_date] = None


class ReorderRequest(BaseModel):
    """New drag-and-drop order for a set of sibling tasks -- either a list's
    top-level tasks, or one master task's subtasks. Must contain exactly the
    current sibling set's ids, just reordered (enforced server-side)."""
    task_ids: List[int] = Field(min_length=1)


class AuditEntry(BaseModel):
    id: int
    task_id: int
    task_text: str
    list_name: str
    action: str
    timestamp: datetime
    is_master: bool = False


# ---------- Templates ----------

class TemplateTaskOut(BaseModel):
    """Mirrors PublicTask's nesting but has no checked/is_master concept --
    templates are pure shape, no progress."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    text: str
    subtasks: List["TemplateTaskOut"] = Field(default_factory=list)


TemplateTaskOut.model_rebuild()


class TemplateDetail(BaseModel):
    id: int
    name: str
    created_at: datetime
    created_by: str
    tasks: List[TemplateTaskOut]  # top-level only, subtasks nested inside


class SaveAsTemplateRequest(BaseModel):
    """Saves an existing list's current structure as a new reusable template."""
    name: str = Field(min_length=1, max_length=100)


class CreateListFromTemplateRequest(BaseModel):
    """Instantiates a new dated TaskList from a saved template."""
    name: str = Field(min_length=1, max_length=100)
    date: date


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
