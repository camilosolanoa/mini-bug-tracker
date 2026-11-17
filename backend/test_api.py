import pytest
import os
from uuid import uuid4
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.engine import make_url
from sqlalchemy.schema import CreateSchema, DropSchema

from backend.main import create_app
from backend.database import make_engine


@pytest.fixture(autouse=True)
def auth_settings(monkeypatch):
    monkeypatch.setenv("DEMO_USERNAME", "reviewer")
    monkeypatch.setenv("DEMO_PASSWORD", "reviewer-test-password")
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret-not-for-deployment")


def login(client):
    response = client.post("/api/auth/login", json={
        "username": "reviewer", "password": "reviewer-test-password",
    })
    assert response.status_code == 200, response.text
    return response


@pytest.fixture
def database_config(tmp_path):
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        yield {"database_path": tmp_path / "test.db"}
        return
    # PostgreSQL checks use a fresh schema per test; never touch app tables.
    engine = make_engine(database_url=url)
    schema = "test_" + uuid4().hex
    with engine.begin() as db:
        db.execute(CreateSchema(schema))
    try:
        test_url = make_url(url).update_query_dict({"options": f"-csearch_path={schema}"})
        yield {"database_url": test_url}
    finally:
        with engine.begin() as db:
            db.execute(DropSchema(schema, cascade=True))
        engine.dispose()


@pytest.fixture
def client(database_config):
    with TestClient(create_app(**database_config)) as client:
        login(client)
        yield client


def create_bug(client, **overrides):
    response = client.post("/api/bugs", json={
        "title": "Checkout fails on mobile",
        "description": "Tap Pay on a narrow screen; the request fails.",
        "severity": "High",
        **overrides,
    })
    assert response.status_code == 201, response.text
    return response.json()


def test_create_defaults_and_trimmed_fields(client):
    bug = create_bug(client, title="  Broken checkout  ", assignee="  Camilo  ")
    assert bug["status"] == "Open"
    assert bug["title"] == "Broken checkout"
    assert bug["assignee"] == "Camilo"
    assert bug["allowed_transitions"] == ["In Progress"]
    assert create_bug(client)["assignee"] is None
    assert create_bug(client, assignee="   ")["assignee"] is None


# Expected outcomes come from the assignment, independently of application code.
@pytest.mark.parametrize("current,target,allowed", [
    ("Open", "Open", False),
    ("Open", "In Progress", True),
    ("Open", "Ready for QA", False),
    ("Open", "Done", False),
    ("In Progress", "Open", False),
    ("In Progress", "In Progress", False),
    ("In Progress", "Ready for QA", True),
    ("In Progress", "Done", False),
    ("Ready for QA", "Open", False),
    ("Ready for QA", "In Progress", True),
    ("Ready for QA", "Ready for QA", False),
    ("Ready for QA", "Done", True),
    ("Done", "Open", True),
    ("Done", "In Progress", False),
    ("Done", "Ready for QA", False),
    ("Done", "Done", False),
])
def test_status_rules(client, current, target, allowed):
    bug = create_bug(client)
    path = ["Open", "In Progress", "Ready for QA", "Done"]
    for status in path[1:path.index(current) + 1]:
        assert client.patch(f"/api/bugs/{bug['id']}/status", json={"status": status}).status_code == 200

    payload = {"status": target}
    if current == "Done" and target == "Open":
        payload["reason"] = "Checkout still fails on mobile after the fix."
    response = client.patch(f"/api/bugs/{bug['id']}/status", json=payload)
    assert response.status_code == (200 if allowed else 409)
    if not allowed:
        assert current in response.json()["detail"]
        assert target in response.json()["detail"]
    saved = client.get("/api/bugs").json()[0]
    assert saved["status"] == (target if allowed else current)
    if saved["status"] == "Done":
        assert saved["allowed_transitions"] == ["Open"]


@pytest.mark.parametrize("reason", [None, "", "   ", "x" * 2001])
def test_reopening_requires_a_valid_reason_without_changing_data(client, reason):
    bug = create_bug(client)
    path = f"/api/bugs/{bug['id']}/status"
    for status in ["In Progress", "Ready for QA", "Done"]:
        assert client.patch(path, json={"status": status}).status_code == 200
    before = client.get(f"/api/bugs/{bug['id']}/history").json()
    payload = {"status": "Open"}
    if reason is not None:
        payload["reason"] = reason
    response = client.patch(path, json=payload)
    assert response.status_code == 422
    assert "reason" in response.text.lower()
    assert client.get("/api/bugs").json()[0]["status"] == "Done"
    assert client.get(f"/api/bugs/{bug['id']}/history").json() == before


def test_reopening_records_trimmed_reason_and_allows_the_workflow_again(client):
    bug = create_bug(client)
    path = f"/api/bugs/{bug['id']}/status"
    for status in ["In Progress", "Ready for QA", "Done"]:
        assert client.patch(path, json={"status": status}).status_code == 200
    response = client.patch(path, json={"status": "Open", "reason": "  Fix fails on Safari.  "})
    assert response.status_code == 200
    assert response.json()["status"] == "Open"
    assert response.json()["allowed_transitions"] == ["In Progress"]
    entries = client.get(f"/api/bugs/{bug['id']}/history").json()
    assert all(entry["reason"] is None for entry in entries[:-1])
    assert entries[-1]["from_status"] == "Done"
    assert entries[-1]["to_status"] == "Open"
    assert entries[-1]["reason"] == "Fix fails on Safari."
    assert entries[-1]["actor"] == "reviewer"
    assert client.patch(path, json={"status": "In Progress"}).status_code == 200


def test_existing_database_is_upgraded_and_history_is_preserved(tmp_path):
    import sqlite3

    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as db:
        db.executescript("""
            CREATE TABLE bugs (id INTEGER PRIMARY KEY, title TEXT NOT NULL,
                description TEXT NOT NULL, severity TEXT NOT NULL, assignee TEXT,
                status TEXT NOT NULL DEFAULT 'Open');
            CREATE TABLE status_history (id INTEGER PRIMARY KEY, bug_id INTEGER NOT NULL,
                from_status TEXT, to_status TEXT NOT NULL, actor TEXT NOT NULL,
                changed_at DATETIME NOT NULL);
            INSERT INTO bugs VALUES (1, 'Checkout', 'Safari checkout fails', 'High', NULL, 'Done');
            INSERT INTO status_history VALUES
                (1, 1, 'Ready for QA', 'Done', 'reviewer', '2026-11-16 12:00:00');
        """)
    with TestClient(create_app(database_path=path)) as browser:
        login(browser)
        assert browser.get("/api/bugs/1/history").json()[0]["reason"] is None
        assert browser.patch("/api/bugs/1/status", json={
            "status": "Open", "reason": "Safari still fails.",
        }).status_code == 200
    with TestClient(create_app(database_path=path)) as browser:
        login(browser)
        entries = browser.get("/api/bugs/1/history").json()
        assert len(entries) == 2
        assert entries[0]["to_status"] == "Done"
        assert entries[1]["reason"] == "Safari still fails."


def test_filters_individually_and_together(client):
    high = create_bug(client)
    low = create_bug(client, severity="Low")
    create_bug(client, severity="Critical")
    client.patch(f"/api/bugs/{high['id']}/status", json={"status": "In Progress"})
    assert len(client.get("/api/bugs").json()) == 3
    assert [b["id"] for b in client.get("/api/bugs?severity=Low").json()] == [low["id"]]
    assert [b["id"] for b in client.get("/api/bugs?status=In+Progress").json()] == [high["id"]]
    assert client.get("/api/bugs?status=Open&severity=High").json() == []
    assert [b["id"] for b in client.get("/api/bugs?status=Open&severity=Low").json()] == [low["id"]]


@pytest.mark.parametrize("override", [
    {"title": "   "}, {"description": " "}, {"severity": "Urgent"},
    {"title": "x" * 121}, {"description": "x" * 5001}, {"assignee": "x" * 81},
    {"status": "Done"},
])
def test_invalid_creation_does_not_save(client, override):
    response = client.post("/api/bugs", json={
        "title": "Broken checkout", "description": "Payment fails", "severity": "High", **override,
    })
    assert response.status_code == 422
    assert client.get("/api/bugs").json() == []


def test_unknown_bug_and_invalid_status(client):
    assert client.patch("/api/bugs/999/status", json={"status": "Done"}).status_code == 404
    bug = create_bug(client)
    assert client.patch(f"/api/bugs/{bug['id']}/status", json={"status": "Closed"}).status_code == 422
    assert client.get("/api/bugs?status=Closed").status_code == 422
    assert client.get("/api/bugs?severity=Urgent").status_code == 422


def test_data_survives_app_restart(database_config):
    with TestClient(create_app(**database_config)) as first:
        login(first)
        bug = create_bug(first)
        first.patch(f"/api/bugs/{bug['id']}/status", json={"status": "In Progress"})
    with TestClient(create_app(**database_config)) as restarted:
        login(restarted)
        saved = restarted.get("/api/bugs").json()
        assert len(saved) == 1
        assert saved[0]["id"] == bug["id"]
        assert saved[0]["status"] == "In Progress"
        history = restarted.get(f"/api/bugs/{bug['id']}/history").json()
        assert [entry["to_status"] for entry in history] == ["Open", "In Progress"]


def test_login_session_and_logout(database_config):
    with TestClient(create_app(**database_config)) as browser:
        assert browser.get("/api/auth/session").json() == {"username": None}
        response = login(browser)
        cookie = response.headers["set-cookie"].lower()
        assert "httponly" in cookie and "samesite=strict" in cookie
        assert "reviewer-test-password" not in cookie
        assert browser.get("/api/auth/session").json() == {"username": "reviewer"}
        assert browser.post("/api/auth/logout").status_code == 200
        assert browser.get("/api/bugs").status_code == 401


def test_wrong_login_cannot_access_data(database_config):
    with TestClient(create_app(**database_config)) as browser:
        response = browser.post("/api/auth/login", json={"username": "reviewer", "password": "wrong"})
        assert response.status_code == 401
        assert browser.get("/api/bugs").status_code == 401


def test_all_bug_routes_require_login(client):
    bug = create_bug(client)
    client.cookies.clear()
    assert client.get("/api/bugs").status_code == 401
    assert client.post("/api/bugs", json={"title": "x", "description": "x", "severity": "Low"}).status_code == 401
    assert client.patch(f"/api/bugs/{bug['id']}/status", json={"status": "In Progress"}).status_code == 401
    assert client.get(f"/api/bugs/{bug['id']}/history").status_code == 401


def test_history_tracks_creation_and_qa_return_only_when_saved(client):
    bug = create_bug(client)
    path = ["In Progress", "Ready for QA", "In Progress", "Ready for QA", "Done"]
    for status in path:
        assert client.patch(f"/api/bugs/{bug['id']}/status", json={"status": status}).status_code == 200
    assert client.patch(f"/api/bugs/{bug['id']}/status", json={"status": "In Progress"}).status_code == 409
    history = client.get(f"/api/bugs/{bug['id']}/history").json()
    assert [(e["from_status"], e["to_status"]) for e in history] == [
        (None, "Open"), ("Open", "In Progress"), ("In Progress", "Ready for QA"),
        ("Ready for QA", "In Progress"), ("In Progress", "Ready for QA"), ("Ready for QA", "Done"),
    ]
    assert all(e["actor"] == "reviewer" for e in history)
    assert all(datetime.fromisoformat(e["changed_at"]).tzinfo is not None for e in history)
    assert client.get("/api/bugs/999/history").status_code == 404


@pytest.mark.parametrize("reopen", [False, True])
def test_simultaneous_updates_create_only_one_history_entry(client, reopen):
    bug = create_bug(client)
    if reopen:
        for status in ["In Progress", "Ready for QA", "Done"]:
            assert client.patch(f"/api/bugs/{bug['id']}/status", json={"status": status}).status_code == 200
    before = client.get(f"/api/bugs/{bug['id']}/history").json()
    payload = {"status": "Open", "reason": "The fix failed."} if reopen else {"status": "In Progress"}
    def move():
        return client.patch(f"/api/bugs/{bug['id']}/status", json=payload).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: move(), range(2)))
    assert sorted(responses) == [200, 409]
    entries = client.get(f"/api/bugs/{bug['id']}/history").json()
    assert entries[:-1] == before
    assert entries[-1]["to_status"] == payload["status"]
    assert entries[-1]["reason"] == payload.get("reason")


@pytest.mark.parametrize("reopen", [False, True])
def test_history_write_failure_rolls_back_status(client, reopen):
    bug = create_bug(client)
    if reopen:
        for status in ["In Progress", "Ready for QA", "Done"]:
            assert client.patch(f"/api/bugs/{bug['id']}/status", json={"status": status}).status_code == 200
    before = client.get(f"/api/bugs/{bug['id']}/history").json()
    engine = client.app.state.engine
    def fail_history_write(connection, cursor, statement, parameters, context, executemany):
        if context.isinsert and context.compiled.statement.table.name == "status_history":
            raise RuntimeError("Simulated history storage failure")
    event.listen(engine, "before_cursor_execute", fail_history_write)
    try:
        with pytest.raises(RuntimeError, match="history storage failure"):
            payload = {"status": "Open", "reason": "The fix failed."} if reopen else {"status": "In Progress"}
            client.patch(f"/api/bugs/{bug['id']}/status", json=payload)
    finally:
        event.remove(engine, "before_cursor_execute", fail_history_write)
    assert client.get("/api/bugs").json()[0]["status"] == ("Done" if reopen else "Open")
    assert client.get(f"/api/bugs/{bug['id']}/history").json() == before


def test_forged_session_is_rejected(client):
    client.cookies.clear()
    client.cookies.set("bug_tracker_session", "forged-session")
    assert client.get("/api/bugs").status_code == 401
