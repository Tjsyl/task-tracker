"""Shared query helpers, notably the on-the-fly public-visibility / rollover logic."""
from datetime import date as date_, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import TaskList, Task, AuditLog


def make_list_key(name: str, on_date: date_, now) -> str:
    """Internal uniqueness key: "<name>-<date>-<time>". Never shown on the public view."""
    safe_name = name.strip().lower().replace(" ", "_")
    return f"{safe_name}-{on_date.isoformat()}-{now.strftime('%H%M%S')}"


def list_completion_date(db: Session, task_list: TaskList) -> Optional[date_]:
    """The date the list *became* fully checked, or None if not currently fully checked.

    Derived from the audit log rather than stored explicitly: it's the timestamp of the
    most recent 'checked' action among the list's tasks, but only meaningful while every
    task in the list is currently checked (if anything gets unchecked later, the list is
    no longer "complete" and this returns None again).
    """
    tasks = task_list.tasks
    if not tasks or not all(t.checked for t in tasks):
        return None

    task_ids = [t.id for t in tasks]
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
