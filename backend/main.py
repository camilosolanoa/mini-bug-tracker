import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import insert, select, update
from starlette.middleware.sessions import SessionMiddleware

from backend.auth import auth_router, require_user
from backend.database import bugs, history, initialize_database, make_engine


Status = Literal["Open", "In Progress", "Ready for QA", "Done"]
Severity = Literal["Low", "Medium", "High", "Critical"]

# The backend owns the workflow. The UI receives these choices with each bug.
TRANSITIONS: dict[str, list[Status]] = {
    "Open": ["In Progress"],
    "In Progress": ["Ready for QA"],
    "Ready for QA": ["In Progress", "Done"],
    "Done": ["Open"],
}


class BugCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    title: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=5000)
    severity: Severity
    assignee: str | None = Field(default=None, max_length=80)

    @field_validator("assignee")
    @classmethod
    def empty_assignee_is_unassigned(cls, value):
        return value or None


class StatusChange(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    status: Status
    reason: str | None = Field(default=None, min_length=1, max_length=2000)


class Bug(BugCreate):
    id: int
    status: Status
    allowed_transitions: list[Status]


class HistoryEntry(BaseModel):
    id: int
    bug_id: int
    from_status: Status | None
    to_status: Status
    actor: str
    reason: str | None
    changed_at: datetime

    @field_validator("changed_at")
    @classmethod
    def utc_timestamp(cls, value):
        # SQLite does not retain timezone information; all writes use UTC.
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def serialize_bug(row) -> dict:
    return {**row, "allowed_transitions": TRANSITIONS[row["status"]]}


def create_app(database_path: str | Path | None = None, *, database_url: str | None = None,
               frontend_directory: Path | None = None) -> FastAPI:
    engine = make_engine(database_path, database_url)
    secret = os.environ.get("SESSION_SECRET")
    if os.environ.get("VERCEL") and not secret:
        raise RuntimeError("SESSION_SECRET is required on Vercel.")

    @asynccontextmanager
    async def lifespan(app):
        initialize_database(engine)
        yield
        engine.dispose()

    app = FastAPI(title="Mini Bug Tracker", lifespan=lifespan)
    app.state.engine = engine
    app.add_middleware(
        SessionMiddleware,
        secret_key=secret or secrets.token_urlsafe(32),
        session_cookie="bug_tracker_session",
        same_site="strict",
        https_only=bool(os.environ.get("VERCEL")),
        max_age=8 * 60 * 60,
    )
    app.include_router(auth_router())

    @app.post("/api/bugs", response_model=Bug, status_code=201)
    def create_bug(bug: BugCreate, username: str = Depends(require_user)):
        with engine.begin() as db:
            row = db.execute(insert(bugs).values(**bug.model_dump()).returning(bugs)).mappings().one()
            db.execute(insert(history).values(bug_id=row["id"], from_status=None, to_status="Open", actor=username))
            return serialize_bug(row)

    @app.get("/api/bugs", response_model=list[Bug], dependencies=[Depends(require_user)])
    def list_bugs(status: Status | None = None, severity: Severity | None = None):
        query = select(bugs).order_by(bugs.c.id.desc())
        if status is not None:
            query = query.where(bugs.c.status == status)
        if severity is not None:
            query = query.where(bugs.c.severity == severity)
        with engine.connect() as db:
            return [serialize_bug(row) for row in db.execute(query).mappings()]

    @app.patch("/api/bugs/{bug_id}/status", response_model=Bug)
    def change_status(bug_id: int, change: StatusChange, username: str = Depends(require_user)):
        with engine.begin() as db:
            row = db.execute(select(bugs).where(bugs.c.id == bug_id)).mappings().first()
            if row is None:
                raise HTTPException(404, "Bug not found.")
            current = row["status"]
            allowed = TRANSITIONS[current]
            if change.status not in allowed:
                explanation = f"Allowed next statuses: {', '.join(allowed)}."
                raise HTTPException(409, f"Cannot change status from {current} to {change.status}. {explanation}")
            if current == "Done" and not change.reason:
                raise HTTPException(422, "A reason is required to reopen a Done bug.")
            # Only update if the status is still the one we validated.
            result = db.execute(update(bugs).where(bugs.c.id == bug_id, bugs.c.status == current).values(status=change.status))
            if result.rowcount != 1:
                raise HTTPException(409, "Another request changed this bug. Refresh and try again.")
            db.execute(insert(history).values(
                bug_id=bug_id, from_status=current, to_status=change.status,
                actor=username, reason=change.reason,
            ))
            # Both writes commit together; failure rolls back both.
            return serialize_bug({**row, "status": change.status})

    @app.get("/api/bugs/{bug_id}/history", response_model=list[HistoryEntry], dependencies=[Depends(require_user)])
    def list_history(bug_id: int):
        with engine.connect() as db:
            if db.execute(select(bugs.c.id).where(bugs.c.id == bug_id)).first() is None:
                raise HTTPException(404, "Bug not found.")
            return list(db.execute(select(history).where(history.c.bug_id == bug_id).order_by(history.c.id)).mappings())

    # After `npm run build`, one Python process can serve the app and API.
    frontend = frontend_directory or Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if frontend.is_dir():
        @app.get("/", response_class=HTMLResponse, include_in_schema=False)
        @app.get("/index.html", response_class=HTMLResponse, include_in_schema=False)
        def frontend_index():
            # Always fetch the current entrypoint; asset filenames contain content hashes.
            return HTMLResponse((frontend / "index.html").read_text(encoding="utf-8"),
                                headers={"Cache-Control": "no-store"})

        app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
    return app


app = create_app()
