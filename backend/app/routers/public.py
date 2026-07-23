"""Anonymous, kiosk-facing endpoints. No auth required -- kids never log in."""
from datetime import date as date_
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import TaskList, Task, AuditLog
from ..crud import is_visible_on_public_dropdown
from ..schemas import DateOption, PublicTaskList, PublicTask

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
    """Tabs for a selected date. Only lists still visible per rollover rule."""
    lists = db.query(TaskList).filter(TaskList.date == for_date).order_by(TaskList.id).all()
    visible = [tl for tl in lists if is_visible_on_public_dropdown(db, tl)]
    return [
        PublicTaskList(
            id=tl.id,
            name=tl.name,
            tasks=[PublicTask(id=t.id, text=t.text, checked=t.checked) for t in tl.tasks],
        )
        for tl in visible
    ]


@router.post("/tasks/{task_id}/toggle", response_model=PublicTask)
def toggle_task(task_id: int, db: Session = Depends(get_db)):
    """Check/uncheck a task. Anonymous -- the list name itself identifies whose task
    this is (per spec's resolved audit-attribution decision). Every toggle is logged."""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.checked = not task.checked
    db.add(AuditLog(task_id=task.id, action="checked" if task.checked else "unchecked"))
    db.commit()
    db.refresh(task)
    return PublicTask(id=task.id, text=task.text, checked=task.checked)
