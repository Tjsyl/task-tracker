"""Manager-capability endpoints. Accessible to both manager and admin roles."""
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import auth
from ..database import get_db
from ..models import TaskList, Task, AuditLog, User
from ..crud import make_list_key
from ..schemas import (
    TaskListDetail, CreateTaskListRequest, CreateTaskRequest, UpdateTaskRequest,
    PublicTask, AuditEntry,
)

router = APIRouter(prefix="/api/manager", tags=["manager"])


def _to_detail(tl: TaskList) -> TaskListDetail:
    return TaskListDetail(
        id=tl.id,
        name=tl.name,
        list_key=tl.list_key,
        date=tl.date,
        created_at=tl.created_at,
        created_by=tl.creator.username,
        tasks=[PublicTask(id=t.id, text=t.text, checked=t.checked) for t in tl.tasks],
    )


@router.get("/lists", response_model=List[TaskListDetail])
def all_lists(db: Session = Depends(get_db), user: User = Depends(auth.require_manager_or_admin)):
    """Full history, unlike the public view -- nothing rolls off here."""
    lists = db.query(TaskList).order_by(TaskList.date.desc(), TaskList.id.desc()).all()
    return [_to_detail(tl) for tl in lists]


@router.post("/lists", response_model=TaskListDetail)
def create_list(
    payload: CreateTaskListRequest,
    db: Session = Depends(get_db),
    user: User = Depends(auth.require_manager_or_admin),
):
    now = datetime.utcnow()
    tl = TaskList(
        name=payload.name,
        list_key=make_list_key(payload.name, payload.date, now),
        date=payload.date,
        created_by_id=user.id,
    )
    db.add(tl)
    db.flush()  # get tl.id before adding tasks
    for text in payload.task_texts:
        db.add(Task(list_id=tl.id, text=text))
    db.commit()
    db.refresh(tl)
    return _to_detail(tl)


@router.delete("/lists/{list_id}")
def delete_list(list_id: int, db: Session = Depends(get_db), user: User = Depends(auth.require_manager_or_admin)):
    tl = db.query(TaskList).filter(TaskList.id == list_id).first()
    if not tl:
        raise HTTPException(status_code=404, detail="List not found")
    db.delete(tl)
    db.commit()
    return {"ok": True}


@router.post("/lists/{list_id}/tasks", response_model=PublicTask)
def add_task(
    list_id: int,
    payload: CreateTaskRequest,
    db: Session = Depends(get_db),
    user: User = Depends(auth.require_manager_or_admin),
):
    tl = db.query(TaskList).filter(TaskList.id == list_id).first()
    if not tl:
        raise HTTPException(status_code=404, detail="List not found")
    task = Task(list_id=list_id, text=payload.text)
    db.add(task)
    db.commit()
    db.refresh(task)
    return PublicTask(id=task.id, text=task.text, checked=task.checked)


@router.patch("/tasks/{task_id}", response_model=PublicTask)
def update_task(
    task_id: int,
    payload: UpdateTaskRequest,
    db: Session = Depends(get_db),
    user: User = Depends(auth.require_manager_or_admin),
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if payload.text is not None:
        task.text = payload.text
    if payload.checked is not None and payload.checked != task.checked:
        task.checked = payload.checked
        db.add(AuditLog(task_id=task.id, action="checked" if task.checked else "unchecked"))

    db.commit()
    db.refresh(task)
    return PublicTask(id=task.id, text=task.text, checked=task.checked)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), user: User = Depends(auth.require_manager_or_admin)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
    return {"ok": True}


@router.get("/lists/{list_id}/audit", response_model=List[AuditEntry])
def list_audit_trail(list_id: int, db: Session = Depends(get_db), user: User = Depends(auth.require_manager_or_admin)):
    tl = db.query(TaskList).filter(TaskList.id == list_id).first()
    if not tl:
        raise HTTPException(status_code=404, detail="List not found")
    task_ids = [t.id for t in tl.tasks]
    entries = (
        db.query(AuditLog)
        .filter(AuditLog.task_id.in_(task_ids))
        .order_by(AuditLog.timestamp.desc())
        .all()
    )
    task_text_by_id = {t.id: t.text for t in tl.tasks}
    return [
        AuditEntry(
            id=e.id,
            task_id=e.task_id,
            task_text=task_text_by_id.get(e.task_id, "(deleted task)"),
            list_name=tl.name,
            action=e.action,
            timestamp=e.timestamp,
        )
        for e in entries
    ]
