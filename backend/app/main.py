"""FastAPI entrypoint for the Family Task Tracker backend."""
import sqlite3

from fastapi import FastAPI
from sqlalchemy import inspect

from .database import Base, engine, DB_PATH
from .routers import auth_router, public, manager, admin

app = FastAPI(title="Family Task Tracker", docs_url="/api/docs", openapi_url="/api/openapi.json")


def _run_lightweight_migrations():
    """Tiny hand-rolled migration, not a full Alembic setup (see README).

    create_all() only creates missing *tables*, it never alters an existing
    table's columns. An existing deployment may already have a live tasks
    table from before the parent/subtask feature existed, so add the new
    column by hand if it's not there yet. Safe to run every startup -- it's
    a no-op once the column exists.
    """
    inspector = inspect(engine)
    if "tasks" not in inspector.get_table_names():
        return  # brand new DB -- create_all() below will make it correctly from the start
    existing_columns = {col["name"] for col in inspector.get_columns("tasks")}
    if "parent_task_id" not in existing_columns:
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute("ALTER TABLE tasks ADD COLUMN parent_task_id INTEGER REFERENCES tasks(id)")
            conn.commit()
        finally:
            conn.close()
    if "sort_order" not in existing_columns:
        # Existing rows all get 0 -- combined with the "sort_order, id" ordering
        # used everywhere, that means id (creation order) breaks the tie, so
        # nothing visually reshuffles on upgrade. Drag-to-reorder rewrites
        # sort_order for the touched siblings from then on.
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute("ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            conn.commit()
        finally:
            conn.close()


@app.on_event("startup")
def on_startup():
    _run_lightweight_migrations()
    # Weekend-scale project: create_all is enough for new tables, no migration framework needed.
    Base.metadata.create_all(bind=engine)


app.include_router(auth_router.router)
app.include_router(public.router)
app.include_router(manager.router)
app.include_router(admin.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
