# Mini Bug Tracker

A small full-stack QA workflow built with **React + TypeScript, FastAPI, and SQLAlchemy Core**.
SQLite makes local setup easy; PostgreSQL on Neon provides persistent storage on Vercel.

Includes bug creation, status/severity filters, backend-enforced status rules, status history,
a demo login, and automated API tests.

## Run locally

Requires Python 3.11+ and Node.js 22.12+ (tested with Python 3.13 and Node 22.15).
From this project's folder:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
cd frontend
npm ci
npm run build
cd ..
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8001
```

Open **http://127.0.0.1:8001**. Sign in with **demo / bugtracker-demo**.
The same Python process serves the built frontend and API. Interactive API docs: `/docs`.
Stop with Ctrl+C. SQLite data stays in `backend/bugs.db`, created automatically.

On macOS/Linux, replace `.\.venv\Scripts\python.exe` with `.venv/bin/python`.
For frontend development, keep the backend running and run `npm run dev` inside
`frontend/`. Open port 5173; Vite proxies `/api` to port 8001.

## Architecture

```text
React + TypeScript -> HTTP/JSON -> FastAPI -> SQLAlchemy Core -> SQLite or PostgreSQL
  forms and lists                  login, validation, rules      persistent data
```

When a user changes status:

1. React sends `PATCH /api/bugs/{id}/status` with `{"status":"In Progress"}`.
2. The browser sends its HttpOnly session cookie; FastAPI checks the login.
3. FastAPI reads the saved status and checks the transition map.
4. A conditional SQL update changes the status only if it has not changed since that read.
5. The status update and history entry commit in one transaction. Failure rolls back both.
6. React reloads the filtered list. History is fetched when its panel is opened.

Two tables: `bugs` stores current details; `status_history` stores the previous/next
status, actor, and UTC timestamp. Existing local bugs are preserved; historical events
from before this feature are not invented or backfilled.

## Workflow and API

```text
Open -> In Progress -> Ready for QA -> Done
           ^                |
           +----------------+
```

New bugs start Open; Done is final. Skips, unsupported backwards moves, and same-status
requests return **409 Conflict** with a clear explanation. Invalid input returns **422**;
missing bugs **404**; unauthenticated access **401**. Invalid changes create no history.

| Request | Purpose |
| --- | --- |
| `POST /api/auth/login` | Sign in with username and password |
| `GET /api/auth/session` | Check the current session |
| `POST /api/auth/logout` | Clear the session cookie |
| `POST /api/bugs` | Create an Open bug and its first history entry |
| `GET /api/bugs?status=Open&severity=High` | List newest first; optional filters combine with AND |
| `PATCH /api/bugs/{id}/status` | Validate and save a status change |
| `GET /api/bugs/{id}/history` | List status events oldest first |

## Main decisions

- **One workflow definition:** the backend sends `allowed_transitions` with every bug;
  React displays those options. Server validation still applies to direct API calls.
- **SQLAlchemy Core, not an ORM:** table definitions and SQL statements work on both
  SQLite and PostgreSQL without maintaining two sets of queries.
- **Atomic writes:** a conditional update prevents conflicting concurrent transitions;
  history is written in that same transaction.
- **Basic login:** one configurable demo account, no registration or user-management system.
  Sessions are signed, HttpOnly, SameSite=Strict, expire after eight hours, and use Secure
  cookies on Vercel. Passwords are not stored in browser storage or session cookies.
- **Public demo:** credentials are intentionally published for reviewers. All users share
  the workspace; use sample data only. This demonstrates login, not private team isolation.
- **Small components:** backend API/rules, database definitions, and login are separate;
  React has dedicated login and history components. No global state library.

## Configuration and deployment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string; absent locally means SQLite |
| `BUG_TRACKER_DB` | Optional local SQLite path |
| `SESSION_SECRET` | Signing key; required on Vercel. Local default changes on restart |
| `DEMO_USERNAME`, `DEMO_PASSWORD` | Optional overrides for the published demo account |

The root `main.py`, runtime `requirements.txt`, and `vercel.json` configure Vercel.
The build installs and bundles the React app. Add a **Neon Free** database to the
Vercel project and set `SESSION_SECRET` as a secret environment variable, then deploy.
Vercel deployments require `DATABASE_URL`; they never silently fall back to a local file.
Secrets and local databases are excluded from Git and deployment uploads.

If you customize the demo account, also update the login page's demo hint.
The default cookie session is intentionally simple: logout clears the browser cookie;
server-side session revocation and per-user accounts are future improvements.

## Checks

```powershell
.\.venv\Scripts\python.exe -m pytest backend/test_api.py -q
cd frontend
npm run build
```

Tests cover all 16 status pairs, creation/validation, filters, persistence, login/logout,
route protection, tampered cookies, history, concurrent updates, and rollback if a history
write fails. Expected transitions are listed independently from application code.

To run the same tests on PostgreSQL, set `TEST_DATABASE_URL` to a **direct/unpooled**
connection string before running pytest. Each test creates and drops a uniquely named
schema, leaving application tables untouched. The database role needs schema privileges.
GitHub Actions runs the SQLite API tests and frontend build on pushes and pull requests.

Browser demo: sign in, create a bug, filter it, move through QA, return it to In Progress,
complete it, inspect its history, reload, and sign out. In `/docs`, try reopening the Done
bug and show the backend's 409 response.

## With more time

- Per-user accounts, password hashing, rate limiting, and revocable server-side sessions.
- Automated browser tests, pagination, and versioned database migrations.
- Better conflict handling for multiple active editors and operational monitoring.

## AI usage

OpenAI Codex helped plan the architecture, draft implementation and tests, prepare
documentation, and run automated and browser checks. The workflow expectations come
from the assignment. The candidate should review and understand the code before presenting;
passing tests does not replace that review.

References: [FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/),
[FastAPI on Vercel](https://vercel.com/docs/frameworks/backend/fastapi),
[Neon Free plan](https://neon.com/pricing).
