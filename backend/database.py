"""Two tables and a connection factory shared by SQLite and PostgreSQL."""
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Column, DateTime, ForeignKey, Integer, MetaData, String, Table, Text, create_engine, event
from sqlalchemy.engine import URL, make_url
from sqlalchemy.pool import NullPool


metadata = MetaData()
bugs = Table(
    "bugs", metadata,
    Column("id", Integer, primary_key=True),
    Column("title", String(120), nullable=False),
    Column("description", Text, nullable=False),
    Column("severity", String(20), nullable=False),
    Column("assignee", String(80)),
    Column("status", String(20), nullable=False, server_default="Open"),
)
history = Table(
    "status_history", metadata,
    Column("id", Integer, primary_key=True),
    Column("bug_id", ForeignKey("bugs.id"), nullable=False, index=True),
    Column("from_status", String(20)),
    Column("to_status", String(20), nullable=False),
    Column("actor", String(80), nullable=False),
    Column("changed_at", DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)),
)


def make_engine(database_path: str | Path | None = None, database_url: str | None = None):
    if database_path is not None:
        url = URL.create("sqlite", database=str(database_path))
    elif database_url or os.environ.get("DATABASE_URL"):
        url = make_url(database_url or os.environ["DATABASE_URL"])
        if url.drivername in ("postgres", "postgresql"):
            url = url.set(drivername="postgresql+psycopg")
    else:
        if os.environ.get("VERCEL"):
            raise RuntimeError("DATABASE_URL is required on Vercel; local files are not persistent.")
        path = os.environ.get("BUG_TRACKER_DB") or Path(__file__).with_name("bugs.db")
        url = URL.create("sqlite", database=str(path))
    # Neon already pools connections. Close ours after each request/transaction.
    options = {"check_same_thread": False, "timeout": 10} if url.get_backend_name() == "sqlite" else {}
    engine = create_engine(url, poolclass=NullPool, connect_args=options)
    if url.get_backend_name() == "sqlite":
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
    return engine
