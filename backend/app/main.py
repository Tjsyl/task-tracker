"""FastAPI entrypoint for the Family Task Tracker backend."""
from fastapi import FastAPI

from .database import Base, engine
from .routers import auth_router, public, manager, admin

app = FastAPI(title="Family Task Tracker", docs_url="/api/docs", openapi_url="/api/openapi.json")


@app.on_event("startup")
def on_startup():
    # Weekend-scale project: create_all is enough, no migration framework needed.
    Base.metadata.create_all(bind=engine)


app.include_router(auth_router.router)
app.include_router(public.router)
app.include_router(manager.router)
app.include_router(admin.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
