"""Anonymous, kiosk-facing endpoints. No auth required -- kids never log in."""
from datetime import date as date_
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import TaskList, Task
from ..crud import is_visible_on_public_dropdown, serialize_task, set_task_checked
from ..schemas import DateOption, PublicTaskList, ToggleResponse

router = APIRouter(prefix="/api/public", tags=["public"])


@router.get("/dates", response_model=List[DateOption])
def list_available_dates(db: Session = Depends(get_db)):
    """Dates with at least one visible task list. Dates with none are simply absent
    (no placeholder) -- filtering happens here, not in the frontend."""
    all_lists = db.query(TaskList).order_by(TaskList.date).all()
    visible_dates = []
    seen = set()
    for tl in all_lists:
        if tl.date in seen:
            continue
        if is_visible_on_public_dropdown(db, tl):
            visible_dates.append(DateOption(date=tl.date))
            seen.add(tl.date)
    return visible_dates


@router.get("/lists", response_model=List[PublicTaskList])
def list_task_lists_for_date(for_date: date_, db: Session = Depends(get_db)):
    """Tabs for a selected date. Only lists still visible per rollover rule.
    Only top-level tasks are included directly -- subtasks are nested inside
    each via serialize_task."""
    lists = db.query(TaskList).filter(TaskList.date == for_date).order_by(TaskList.id).all()
    visible = [tl for tl in lists if is_visible_on_public_dropdown(db, tl)]
    return [
        PublicTaskList(
            id=tl.id,
            name=tl.name,
            tasks=[serialize_task(t) for t in tl.tasks if t.parent_task_id is None],
        )
        for tl in visible
    ]


@router.post("/tasks/{task_id}/toggle", response_model=ToggleResponse)
def toggle_task(task_id: int, db: Session = Depends(get_db)):
    """Check/uncheck a task. Anonymous -- the list name itself identifies whose task
    this is (per spec's resolved audit-attribution decision). Every toggle is logged.
    Master tasks (with subtasks) can't be toggled directly -- check off their
    subtasks instead, and the master greys out on its own once all are done."""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    try:
        parent = set_task_checked(db, task, not task.checked)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.commit()
    db.refresh(task)
    if parent:
        db.refresh(parent)

    return ToggleResponse(
        task=serialize_task(task, _include_subtasks=False),
        parent=serialize_task(parent, _include_subtasks=False) if parent else None,
    )
