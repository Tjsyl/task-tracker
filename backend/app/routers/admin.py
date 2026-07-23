"""Admin-only endpoints: user account management + full cross-list audit trail.
Everything a manager can do is already available to admin via the /api/manager
routes (require_manager_or_admin admits both roles)."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import auth
from ..database import get_db
from ..models import User, AuditLog, Task, TaskList
from ..schemas import CreateUserRequest, UpdateUserPinRequest, UserOut, AuditEntry

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db), user: User = Depends(auth.require_admin)):
    return [UserOut(id=u.id, username=u.username, role=u.role) for u in db.query(User).all()]


@router.post("/users", response_model=UserOut)
def create_user(
    payload: CreateUserRequest,
    db: Session = Depends(get_db),
    user: User = Depends(auth.require_admin),
):
    existing = db.query(User).filter(User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")
    new_user = User(username=payload.username, pin_hash=auth.hash_pin(payload.pin), role=payload.role)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return UserOut(id=new_user.id, username=new_user.username, role=new_user.role)


@router.patch("/users/{user_id}/pin", response_model=UserOut)
def update_user_pin(
    user_id: int,
    payload: UpdateUserPinRequest,
    db: Session = Depends(get_db),
    user: User = Depends(auth.require_admin),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.pin_hash = auth.hash_pin(payload.pin)
    target.failed_attempts = 0
    target.locked_until = None
    db.commit()
    return UserOut(id=target.id, username=target.username, role=target.role)


@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), user: User = Depends(auth.require_admin)):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account while logged in as it")
    db.delete(target)
    db.commit()
    return {"ok": True}


@router.get("/audit", response_model=List[AuditEntry])
def full_audit_trail(db: Session = Depends(get_db), user: User = Depends(auth.require_admin)):
    """Every check/uncheck across every list, newest first."""
    entries = db.query(AuditLog).order_by(AuditLog.timestamp.desc()).limit(1000).all()
    task_ids = [e.task_id for e in entries]
    tasks = {t.id: t for t in db.query(Task).filter(Task.id.in_(task_ids)).all()}
    lists = {tl.id: tl for tl in db.query(TaskList).all()}
    out = []
    for e in entries:
        task = tasks.get(e.task_id)
        list_name = lists[task.list_id].name if task and task.list_id in lists else "(deleted list)"
        out.append(
            AuditEntry(
                id=e.id,
                task_id=e.task_id,
                task_text=task.text if task else "(deleted task)",
                list_name=list_name,
                action=e.action,
                timestamp=e.timestamp,
            )
        )
    return out
