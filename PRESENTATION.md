# Short interview walkthrough

Use this as a guide after reviewing the code, not a script to memorize.

## 1. Introduce the app (20 seconds)

“This is a small bug tracker with a QA workflow. I used React and TypeScript for
the interface and Python with FastAPI for the backend. SQLite makes local setup
easy; the deployed version uses PostgreSQL on Neon.
I focused on the required behavior and keeping the code easy to understand.”

## 2. Demo (2 minutes)

1. Sign in with the demo account and create “Checkout fails on mobile”, severity High, assigned to Camilo.
2. Filter by High and Open, then clear the status filter.
3. Move through In Progress and Ready for QA.
4. Return to In Progress: “QA found another issue.”
5. Move through QA again and mark Done. Show that it has no next action.
6. Open the history, then reload: “Status changes are recorded with a timestamp and actor. Data survives refreshes and restarts.”
7. In `/docs`, PATCH the completed bug to Open. Show the 409 response.

“The frontend guides the user, but the backend enforces the rules.”

## 3. Explain the code (2 minutes)

- `backend/main.py`: input models, transition map, and bug/history endpoints.
- `backend/database.py`: two table definitions and SQLite/PostgreSQL connections.
- `backend/auth.py`: the demo login; a signed cookie identifies the session.
- `frontend/src/api.ts`: TypeScript types and the HTTP helper.
- `frontend/src/App.tsx`: form, filters, loading/errors, and status buttons.
- `backend/test_api.py`: all allowed and rejected status pairs plus persistence and filtering.

“The backend sends allowed next statuses with each bug. That keeps the rule in
one place. A conditional update ensures the saved status is still the one we
validated. The status and history entry commit together.”

## 4. Decisions and AI (30 seconds)

“SQLite needs no local setup. For deployment, Neon provides persistent PostgreSQL
storage because Vercel cannot persist a local database file. SQLAlchemy Core lets
both use the same queries. I used Codex to help draft the code, tests, and docs.
With more time, I would add per-user accounts and automated browser tests.”

Only say you reviewed and understand every part after you have done that review.

## Practice before the call

- Explain why Open → Done returns 409 and invalid severity returns 422.
- Explain what happens when the backend is unavailable.
- Explain why TypeScript types do not replace backend validation.
- Practice adding an optional “steps to reproduce” field: database change,
  API model, React form/type, test. Discuss a migration for existing databases.
- Before a live change: restate the request, identify affected files, add a
  meaningful test, implement the change, and verify it.
