"""Manager-capability endpoints. Accessible to both manager and admin roles."""
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import auth
from ..database import get_db
from ..models import TaskList, Task, AuditLog, User, TaskListTemplate
from ..crud import (
    make_list_key, serialize_task, set_task_checked, recompute_master_state,
    serialize_template_task, copy_list_to_template, copy_template_to_list,
)
from ..schemas import (
    TaskListDetail, CreateTaskListRequest, CreateTaskRequest, CreateSubtaskRequest,
    UpdateTaskRequest, PublicTask, AuditEntry,
    TemplateDetail, SaveAsTemplateRequest, CreateListFromTemplateRequest,
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
        tasks=[serialize_task(t) for t in tl.tasks if t.parent_task_id is None],
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

    for item in payload.tasks:
        parent_task = Task(list_id=tl.id, text=item.text)
        db.add(parent_task)
        db.flush()  # get parent_task.id before adding its subtasks
        for sub_text in item.subtasks:
            db.add(Task(list_id=tl.id, text=sub_text, parent_task_id=parent_task.id))

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
    """Adds a new top-level task (no parent). Use the /subtasks endpoint below
    to add a subtask under an existing task instead."""
    tl = db.query(TaskList).filter(TaskList.id == list_id).first()
    if not tl:
        raise HTTPException(status_code=404, detail="List not found")
    task = Task(list_id=list_id, text=payload.text)
    db.add(task)
    db.commit()
    db.refresh(task)
    return serialize_task(task)


@router.post("/tasks/{task_id}/subtasks", response_model=PublicTask)
def add_subtask(
    task_id: int,
    payload: CreateSubtaskRequest,
    db: Session = Depends(get_db),
    user: User = Depends(auth.require_manager_or_admin),
):
    """Adds a subtask under an existing top-level task, turning that task into
    a master (single level of nesting only -- a subtask can't itself have
    subtasks)."""
    parent = db.query(Task).filter(Task.id == task_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Task not found")
    if parent.parent_task_id is not None:
        raise HTTPException(status_code=400, detail="Can't add a subtask to a subtask (one level of nesting only).")

    subtask = Task(list_id=parent.list_id, text=payload.text, parent_task_id=parent.id)
    db.add(subtask)
    db.flush()
    # A newly added (unchecked) subtask means the master can no longer be "done"
    # if it previously was -- keep its derived state honest.
    recompute_master_state(db, parent)
    db.commit()
    db.refresh(parent)
    return serialize_task(parent)


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

    if payload.checked is not None:
        try:
            set_task_checked(db, task, payload.checked)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    db.commit()
    db.refresh(task)
    return serialize_task(task)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), user: User = Depends(auth.require_manager_or_admin)):
    """Deleting a master task deletes its subtasks too (cascade). Deleting a
    subtask can flip its master to "done" if that was the last one left unchecked."""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    parent_id = task.parent_task_id
    db.delete(task)
    db.flush()

    if parent_id:
        parent = db.query(Task).filter(Task.id == parent_id).first()
        if parent:
            recompute_master_state(db, parent)

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
    task_by_id = {t.id: t for t in tl.tasks}
    return [
        AuditEntry(
            id=e.id,
            task_id=e.task_id,
            task_text=task_by_id[e.task_id].text if e.task_id in task_by_id else "(deleted task)",
            list_name=tl.name,
            action=e.action,
            timestamp=e.timestamp,
            is_master=task_by_id[e.task_id].is_master if e.task_id in task_by_id else False,
        )
        for e in entries
    ]


# ---------- Templates ----------
# A template is just a saved structure (names + subtasks, no dates or checked
# state) that can be turned into a fresh dated TaskList repeatedly -- e.g. a
# recurring "Kid1 morning routine".

def _to_template_detail(t: TaskListTemplate) -> TemplateDetail:
    return TemplateDetail(
        id=t.id,
        name=t.name,
        created_at=t.created_at,
        created_by=t.creator.username,
        tasks=[serialize_template_task(tt) for tt in t.tasks if tt.parent_template_task_id is None],
    )


@router.get("/templates", response_model=List[TemplateDetail])
def all_templates(db: Session = Depends(get_db), user: User = Depends(auth.require_manager_or_admin)):
    templates = db.query(TaskListTemplate).order_by(TaskListTemplate.name).all()
    return [_to_template_detail(t) for t in templates]


@router.post("/lists/{list_id}/save-as-template", response_model=TemplateDetail)
def save_list_as_template(
    list_id: int,
    payload: SaveAsTemplateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(auth.require_manager_or_admin),
):
    """Saves the *current* structure of an existing list (task/subtask names,
    not their checked state or the list's date) as a new reusable template."""
    tl = db.query(TaskList).filter(TaskList.id == list_id).first()
    if not tl:
        raise HTTPException(status_code=404, detail="List not found")

    template = TaskListTemplate(name=payload.name, created_by_id=user.id)
    db.add(template)
    db.flush()  # get template.id before copying tasks into it
    copy_list_to_template(db, tl, template)
    db.commit()
    db.refresh(template)
    return _to_template_detail(template)


@router.delete("/templates/{template_id}")
def delete_template(
    template_id: int, db: Session = Depends(get_db), user: User = Depends(auth.require_manager_or_admin)
):
    template = db.query(TaskListTemplate).filter(TaskListTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(template)
    db.commit()
    return {"ok": True}


@router.post("/templates/{template_id}/create-list", response_model=TaskListDetail)
def create_list_from_template(
    template_id: int,
    payload: CreateListFromTemplateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(auth.require_manager_or_admin),
):
    """Instantiates a brand-new, all-unchecked TaskList for `payload.date` from
    a saved template's structure."""
    template = db.query(TaskListTemplate).filter(TaskListTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    now = datetime.utcnow()
    tl = TaskList(
        name=payload.name,
        list_key=make_list_key(payload.name, payload.date, now),
        date=payload.date,
        created_by_id=user.id,
    )
    db.add(tl)
    db.flush()  # get tl.id before copying tasks into it
    copy_template_to_list(db, template, tl)
    db.commit()
    db.refresh(tl)
    return _to_detail(tl)
