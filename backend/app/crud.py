"""Shared query helpers: rollover/public-visibility logic, and the master/subtask
checked-state cascade (a master task's checked value is always derived from its
children, never set directly)."""
from datetime import date as date_, timedelta
from typing import Optional, List

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import TaskList, Task, AuditLog, TaskListTemplate, TemplateTask


def make_list_key(name: str, on_date: date_, now) -> str:
    """Internal uniqueness key: "<name>-<date>-<time>". Never shown on the public view."""
    safe_name = name.strip().lower().replace(" ", "_")
    return f"{safe_name}-{on_date.isoformat()}-{now.strftime('%H%M%S')}"


def next_sort_order(db: Session, *, list_id: Optional[int] = None, parent_task_id: Optional[int] = None) -> int:
    """Sort_order for a newly-appended sibling task -- either a new top-level
    task in `list_id`, or a new subtask under `parent_task_id`. Exactly one of
    the two should be given. Puts the new task at the end of its siblings."""
    q = db.query(func.max(Task.sort_order))
    if parent_task_id is not None:
        q = q.filter(Task.parent_task_id == parent_task_id)
    else:
        q = q.filter(Task.list_id == list_id, Task.parent_task_id.is_(None))
    current_max = q.scalar()
    return (current_max or 0) + 1


# ---------- Master / subtask cascade ----------

def recompute_master_state(db: Session, parent: Task) -> bool:
    """Recompute a master task's derived checked state from its children,
    persist it, and log an audit entry if it changed (so the audit trail
    reflects when the master itself became "done"). Returns the new state.
    No-op (returns current value) if `parent` has no children."""
    if not parent.children:
        return parent.checked
    new_state = all(c.checked for c in parent.children)
    if new_state != parent.checked:
        parent.checked = new_state
        db.add(AuditLog(task_id=parent.id, action="checked" if new_state else "unchecked"))
    return new_state


def set_task_checked(db: Session, task: Task, checked: bool) -> Optional[Task]:
    """Set a leaf task's checked state (only writes + audits if it actually
    changed), then cascades to its parent master if it has one. Returns the
    parent (with freshly recomputed state) if applicable, else None.

    Does not commit -- that's the caller's job. Raises ValueError if `task`
    itself has children, since masters are derived-only and can't be
    directly checked/unchecked (callers should turn this into a 4xx).
    """
    if task.children:
        raise ValueError("Cannot directly check/uncheck a task that has subtasks.")

    if checked != task.checked:
        task.checked = checked
        db.add(AuditLog(task_id=task.id, action="checked" if checked else "unchecked"))
        # Flush before re-querying the parent's children below -- with autoflush
        # off (see database.py), a fresh query wouldn't otherwise see this change.
        db.flush()

    parent = None
    if task.parent_task_id:
        parent = db.query(Task).filter(Task.id == task.parent_task_id).first()
        if parent:
            recompute_master_state(db, parent)
    return parent


def serialize_task(task: Task, _include_subtasks: bool = True):
    """Task -> PublicTask, nesting one level of subtasks (this app only
    supports a single level: a master task with plain subtasks)."""
    from .schemas import PublicTask  # local import: schemas doesn't import crud, avoids a cycle

    subtasks: List["PublicTask"] = []
    if _include_subtasks:
        subtasks = [serialize_task(c, _include_subtasks=False) for c in task.children]
    return PublicTask(
        id=task.id,
        text=task.text,
        checked=task.checked,
        is_master=task.is_master,
        subtasks=subtasks,
    )


# ---------- Rollover / public visibility ----------

def list_completion_date(db: Session, task_list: TaskList) -> Optional[date_]:
    """The date the list *became* fully checked, or None if not currently fully checked.

    Derived from the audit log rather than stored explicitly: it's the timestamp of the
    most recent 'checked' action among the list's tasks (this includes master tasks'
    own synthetic audit entries, which is fine -- they land at essentially the same
    moment as their last subtask's check), but only meaningful while every top-level
    task in the list is currently checked (if anything gets unchecked later, the list
    is no longer "complete" and this returns None again).
    """
    top_level = [t for t in task_list.tasks if t.parent_task_id is None]
    if not top_level or not all(t.checked for t in top_level):
        return None

    task_ids = [t.id for t in task_list.tasks]
    latest = (
        db.query(func.max(AuditLog.timestamp))
        .filter(AuditLog.task_id.in_(task_ids), AuditLog.action == "checked")
        .scalar()
    )
    if latest is None:
        # Shouldn't normally happen (fully checked with no audit trail), but don't hide
        # a list we can't explain -- treat as "just completed today".
        return date_.today()
    return latest.date()


def is_visible_on_public_dropdown(db: Session, task_list: TaskList, today: Optional[date_] = None) -> bool:
    """Rollover rule (resolved in spec): a list rolls off the public dropdown starting
    two days after it's fully completed. I.e. completed on day X -> visible through
    day X+1 -> hidden starting day X+2. Incomplete lists stay visible indefinitely.
    """
    today = today or date_.today()
    completed_on = list_completion_date(db, task_list)
    if completed_on is None:
        return True  # not fully checked (or empty) -- always visible
    return today <= completed_on + timedelta(days=1)


# ---------- Templates ----------

def serialize_template_task(tt: TemplateTask, _include_subtasks: bool = True):
    from .schemas import TemplateTaskOut  # local import, avoids a schemas<->crud cycle

    subtasks: List["TemplateTaskOut"] = []
    if _include_subtasks:
        subtasks = [serialize_template_task(c, _include_subtasks=False) for c in tt.children]
    return TemplateTaskOut(id=tt.id, text=tt.text, subtasks=subtasks)


def copy_list_to_template(db: Session, task_list: TaskList, template: TaskListTemplate) -> None:
    """Copies a TaskList's current top-level tasks + subtasks (structure only,
    ignoring checked state) into `template`, which should already be added +
    flushed (so template.id exists). Does not commit."""
    top_level = [t for t in task_list.tasks if t.parent_task_id is None]
    for task in top_level:
        tt = TemplateTask(template_id=template.id, text=task.text)
        db.add(tt)
        db.flush()  # need tt.id before adding its subtasks
        for sub in task.children:
            db.add(TemplateTask(template_id=template.id, text=sub.text, parent_template_task_id=tt.id))


def copy_template_to_list(db: Session, template: TaskListTemplate, task_list: TaskList) -> None:
    """Copies a template's structure into `task_list` (which should already be
    added + flushed so task_list.id exists) as fresh, all-unchecked tasks.
    Does not commit."""
    top_level = [tt for tt in template.tasks if tt.parent_template_task_id is None]
    for tt in top_level:
        task = Task(list_id=task_list.id, text=tt.text)
        db.add(task)
        db.flush()  # need task.id before adding its subtasks
        for sub in tt.children:
            db.add(Task(list_id=task_list.id, text=sub.text, parent_task_id=task.id))
