"""Database engine/session setup. Single-file SQLite, no external DB needed."""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DB_PATH = os.environ.get("TASK_TRACKER_DB", "/data/task_tracker.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

# check_same_thread=False is safe here: FastAPI's default sync-session-per-request
# pattern with a single SQLite file is fine at this household's request volume.
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
