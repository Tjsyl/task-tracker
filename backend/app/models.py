"""SQLAlchemy models for the Family Task Tracker.

Roles: admin (Travis) and manager (wife) are the only two real accounts.
Kids never log in -- the public/kiosk view is anonymous, per spec.
"""
from datetime import datetime, date as date_

from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Date, ForeignKey, ForeignKeyConstraint
)
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    """Only ever two rows: one admin, one manager. No self-registration."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False, index=True)
    pin_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)  # "admin" or "manager"
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Rate-limit / lockout bookkeeping (see auth.py)
    failed_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime, nullable=True)

    task_lists = relationship("TaskList", back_populates="creator")


class TaskList(Base):
    """A dated, named collection of tasks (e.g. 'Kid1' for 2026-07-22)."""
    __tablename__ = "task_lists"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)  # manager-given display name, e.g. "Kid1"
    # Internal uniqueness key: "<name>-<date>-<time>". Never shown on the public
    # view; shown to manager/admin so same-named lists across dates are distinguishable.
    list_key = Column(String, unique=True, nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)  # the day this list is "for"
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    creator = relationship("User", back_populates="task_lists")
    tasks = relationship("Task", back_populates="task_list", cascade="all, delete-orphan")


class Task(Base):
    """A task within a list. May optionally be a subtask of another task via
    parent_task_id -- single level only (a "master" task with subtasks; a
    subtask can't itself have subtasks). A task with children is a master:
    it has no independent checkbox, and its `checked` value is derived
    (kept in sync) from whether all of its children are checked -- see
    crud.py::recompute_master_state."""
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True)
    list_id = Column(Integer, ForeignKey("task_lists.id"), nullable=False, index=True)
    parent_task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True, index=True)
    text = Column(String, nullable=False)
    checked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    task_list = relationship("TaskList", back_populates="tasks")
    audit_entries = relationship("AuditLog", back_populates="task", cascade="all, delete-orphan")

    parent = relationship("Task", remote_side=[id], back_populates="children")
    children = relationship(
        "Task", back_populates="parent", cascade="all, delete-orphan",
        order_by="Task.id",
    )

    @property
    def is_master(self) -> bool:
        return bool(self.children)


class AuditLog(Base):
    """Append-only. Every check/uncheck event, regardless of who (kids are anonymous)."""
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False, index=True)
    action = Column(String, nullable=False)  # "checked" or "unchecked"
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    task = relationship("Task", back_populates="audit_entries")
