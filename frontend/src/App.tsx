import { useState } from 'react';
import type { FormEvent } from 'react';
import { jsonBody, request, severities, statuses } from './api';
import type { Bug, Status } from './api';
import { useGet } from './useGet';
import Login from './Login';
import BugHistory from './BugHistory';

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export default function App() {
  const session = useGet<{ username: string | null }>('/auth/session');
  if (session.error) return <main>
    <p className="error" role="alert">{session.error}</p>
    <button onClick={session.reload}>Retry</button>
  </main>;
  if (session.loading || !session.data) return <main role="status">Loading workspace…</main>;
  if (!session.data.username) return <Login onLogin={session.reload} />;
  return <Workspace username={session.data.username} onLogout={session.reload} />;
}

function Workspace({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState<number | null>(null);
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (severity) query.set('severity', severity);
  const list = useGet<Bug[]>(`/bugs?${query}`);
  const bugs = list.data ?? [];

  function clearFilters() {
    setStatus('');
    setSeverity('');
  }

  async function signOut() {
    try {
      await request('/auth/logout', { method: 'POST' });
      onLogout();
    } catch (error) {
      setError(message(error));
    }
  }

  async function createBug(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setCreating(true);
    setError('');
    setNotice('');
    try {
      const bug = await request<Bug>('/bugs', jsonBody('POST', {
        title: fields.get('title'), description: fields.get('description'),
        severity: fields.get('severity'), assignee: fields.get('assignee') || null,
      }));
      form.reset();
      clearFilters();
      list.reload();
      setNotice(`Bug #${bug.id} created. It starts as Open.`);
    } catch (error) {
      setError(message(error));
    } finally {
      setCreating(false);
    }
  }

  async function changeStatus(bug: Bug, next: Status, reason?: string) {
    setUpdating(bug.id);
    setError('');
    try {
      await request(`/bugs/${bug.id}/status`, jsonBody('PATCH', { status: next, reason }));
    } catch (error) {
      setError(message(error));
    } finally {
      list.reload();
      setUpdating(null);
    }
  }

  function reopenBug(event: FormEvent<HTMLFormElement>, bug: Bug) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (!reason) {
      setError('A reason is required to reopen a Done bug.');
      return;
    }
    void changeStatus(bug, 'Open', reason);
  }

  return <main>
    <header>
      <h1>Mini Bug Tracker</h1>
      <div className="account">{username} <button onClick={signOut}>Sign out</button></div>
    </header>
    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="workspace">
      <section className="panel" aria-labelledby="report-heading">
        <h2 id="report-heading">Report a bug</h2>
        <form onSubmit={createBug}>
          <fieldset disabled={creating}>
            <label htmlFor="title">Title</label>
            <input id="title" name="title" required maxLength={120} />
            <label htmlFor="description">Description</label>
            <textarea id="description" name="description" required maxLength={5000} rows={4} />
            <label htmlFor="new-severity">Severity</label>
            <select id="new-severity" name="severity" defaultValue="Medium">
              {severities.map(value => <option key={value}>{value}</option>)}
            </select>
            <label htmlFor="assignee">Assignee (optional)</label>
            <input id="assignee" name="assignee" maxLength={80} />
            <button className="primary" type="submit">{creating ? 'Creating…' : '+ Create bug'}</button>
            <p className="muted">New bugs start as Open.</p>
          </fieldset>
        </form>
      </section>
      <section aria-labelledby="bugs-heading" aria-busy={list.loading}>
        <h2 id="bugs-heading">Bug list</h2>
        <div className="filters">
          <div>
            <label htmlFor="filter-status">Status</label>
            <select id="filter-status" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {statuses.map(value => <option key={value}>{value}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="filter-severity">Severity</label>
            <select id="filter-severity" value={severity} onChange={e => setSeverity(e.target.value)}>
              <option value="">All severities</option>
              {severities.map(value => <option key={value}>{value}</option>)}
            </select>
          </div>
          <button onClick={list.reload} disabled={list.loading}>Refresh</button>
          {(status || severity) && <button onClick={clearFilters}>Clear filters</button>}
        </div>
        {list.error && <p className="error" role="alert">{list.error}</p>}
        {!list.error && <p className="muted" role="status">
          {list.data === null ? 'Loading bugs…' : bugs.length ? `${bugs.length} bug${bugs.length === 1 ? '' : 's'}` : 'No bugs found. Create one or adjust the filters.'}
        </p>}
        {!list.error && bugs.map(bug => <article className="panel bug" key={bug.id}>
          <h3>{bug.title}</h3>
          <p className="description">{bug.description}</p>
          <p className="metadata">
            <span>#{bug.id}</span><span role="status">{bug.status}</span><span>{bug.severity} severity</span><span>{bug.assignee || 'Unassigned'}</span>
          </p>
          <div className="actions" aria-busy={updating === bug.id}>
            {bug.allowed_transitions.map(next => next === 'Open' && bug.status === 'Done'
              ? <form className="reopen" key={next} onSubmit={event => reopenBug(event, bug)}>
                <fieldset disabled={updating !== null || creating || list.loading}>
                  <label htmlFor={`reopen-reason-${bug.id}`}>Reason for reopening</label>
                  <textarea id={`reopen-reason-${bug.id}`} name="reason" required maxLength={2000} rows={2} />
                  <button type="submit">{updating === bug.id ? 'Reopening…' : 'Reopen bug'}</button>
                </fieldset>
              </form>
              : <button key={next}
                disabled={updating !== null || creating || list.loading} onClick={() => changeStatus(bug, next)}>
                {next === 'In Progress' && bug.status === 'Ready for QA'
                  ? 'Return to In Progress' : `Move to ${next}`}
              </button>)}
          </div>
          <BugHistory bugId={bug.id} status={bug.status} refresh={list.version} />
        </article>)}
      </section>
    </div>
  </main>;
}
