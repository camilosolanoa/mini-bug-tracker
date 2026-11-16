import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { jsonBody, request, severities, statuses } from './api';
import type { Bug, Status } from './api';
import Login from './Login';
import BugHistory from './BugHistory';

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export default function App() {
  const [username, setUsername] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setChecking(true);
    setError('');
    request<{ username: string | null }>('/auth/session', { signal: controller.signal })
      .then(session => setUsername(session.username))
      .catch(error => { if (!controller.signal.aborted) setError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [retry]);

  if (checking) return <main className="empty" role="status">Loading workspace…</main>;
  if (error) return <main className="empty"><p role="alert">{error}</p><button className="secondary" onClick={() => setRetry(value => value + 1)}>Retry</button></main>;
  if (!username) return <Login onLogin={setUsername} />;
  return <Workspace username={username} onLogout={() => setUsername(null)} />;
}

function Workspace({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState<number | null>(null);

  async function signOut() {
    try {
      await request('/auth/logout', { method: 'POST' });
      onLogout();
    } catch (error) {
      setActionError(message(error));
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (severity) query.set('severity', severity);
    setLoading(true);
    setListError('');
    request<Bug[]>(`/bugs?${query}`, { signal: controller.signal })
      .then(setBugs)
      .catch(error => { if (!controller.signal.aborted) setListError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status, severity, refresh]);

  async function createBug(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setCreating(true);
    setActionError('');
    setNotice('');
    try {
      const bug = await request<Bug>('/bugs', jsonBody('POST', {
        title: fields.get('title'),
        description: fields.get('description'),
        severity: fields.get('severity'),
        assignee: fields.get('assignee') || null,
      }));
      form.reset();
      setStatus('');
      setSeverity('');
      setRefresh(value => value + 1);
      setNotice(`Bug #${bug.id} created. It starts as Open.`);
    } catch (error) {
      setActionError(message(error));
    } finally {
      setCreating(false);
    }
  }

  async function changeStatus(bug: Bug, next: Status) {
    setUpdating(bug.id);
    setActionError('');
    setNotice('');
    try {
      await request<Bug>(`/bugs/${bug.id}/status`, jsonBody('PATCH', { status: next }));
      setNotice(`Bug #${bug.id} moved to ${next}.`);
      setRefresh(value => value + 1);
    } catch (error) {
      setActionError(message(error));
      setRefresh(value => value + 1);
    } finally {
      setUpdating(null);
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="brand-icon" aria-hidden="true">b.</span> Mini Bug Tracker</div>
        <div className="account"><span>{username}</span><button className="secondary" onClick={signOut}>Sign out</button></div>
      </header>
      <main>
        <div className="intro">
          <p className="eyebrow">TEAM WORKSPACE</p>
          <h1>Small bugs. Clear next steps.</h1>
          <p>Report an issue, track the fix, and make sure it passes QA.</p>
        </div>
        <div className="workflow" aria-label="Bug workflow">
          <span>01 <b>Open</b></span><span aria-hidden="true">→</span>
          <span>02 <b>In Progress</b></span><span aria-hidden="true">⇄</span>
          <span>03 <b>Ready for QA</b></span><span aria-hidden="true">→</span>
          <span>04 <b>Done</b></span>
        </div>
        <div className="feedback" aria-live="polite">{notice && <p className="success">{notice}</p>}</div>
        {actionError && <p className="error" role="alert">{actionError}</p>}
        <div className="workspace">
          <section className="panel report" aria-labelledby="report-heading">
            <p className="eyebrow">CAPTURE THE DETAILS</p>
            <h2 id="report-heading">Report a bug</h2>
            <p className="muted">Every fix starts with a clear report.</p>
            <form onSubmit={createBug}>
              <fieldset disabled={creating}>
                <label htmlFor="title">Title</label>
                <input id="title" name="title" required maxLength={120} placeholder="What went wrong?" />
                <label htmlFor="description">Description</label>
                <textarea id="description" name="description" required maxLength={5000} rows={5} placeholder="What happened? What did you expect? Include steps to reproduce." />
                <label htmlFor="new-severity">Severity</label>
                <select id="new-severity" name="severity" defaultValue="Medium">
                  {severities.map(value => <option key={value}>{value}</option>)}
                </select>
                <label htmlFor="assignee">Assignee <span className="optional">optional</span></label>
                <input id="assignee" name="assignee" maxLength={80} placeholder="Name of the person handling it" />
                <button className="primary" type="submit">{creating ? 'Creating…' : '+ Create bug'}</button>
                <p className="form-note">New bugs start as Open.</p>
              </fieldset>
            </form>
          </section>
          <section className="backlog" aria-labelledby="bugs-heading" aria-busy={loading}>
            <div className="section-heading">
              <div><p className="eyebrow">FROM REPORT TO RESOLUTION</p><h2 id="bugs-heading">Bug list</h2></div>
              {!loading && !listError && <span className="count">{bugs.length} {bugs.length === 1 ? 'bug' : 'bugs'}</span>}
            </div>
            <div className="filters">
              <div><label htmlFor="filter-status">Status</label>
                <select id="filter-status" value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="">All statuses</option>
                  {statuses.map(value => <option key={value}>{value}</option>)}
                </select>
              </div>
              <div><label htmlFor="filter-severity">Severity</label>
                <select id="filter-severity" value={severity} onChange={e => setSeverity(e.target.value)}>
                  <option value="">All severities</option>
                  {severities.map(value => <option key={value}>{value}</option>)}
                </select>
              </div>
              <button className="secondary refresh" onClick={() => setRefresh(value => value + 1)} disabled={loading}>Refresh</button>
            </div>
            {loading && bugs.length > 0 && <p className="muted" role="status">Updating list…</p>}
            {loading && bugs.length === 0 ? <div className="empty" role="status">Loading bugs…</div>
              : listError ? <div className="empty error" role="alert">{listError}</div>
              : bugs.length === 0 ? <div className="empty">
                <span className="empty-icon" aria-hidden="true">✓</span>
                <h3>{status || severity ? 'No matching bugs' : 'A fresh start'}</h3>
                <p>{status || severity ? 'Try another status or severity filter.' : 'Report your first bug to get the work moving.'}</p>
                {(status || severity) && <button className="secondary" onClick={() => { setStatus(''); setSeverity(''); }}>Clear filters</button>}
              </div>
              : <div className="bug-list">{bugs.map(bug => (
                <article className="panel bug" key={bug.id}>
                  <div className="bug-meta"><span className="bug-id">BUG-{String(bug.id).padStart(3, '0')}</span><span className="badge" data-severity={bug.severity}>{bug.severity}</span></div>
                  <h3>{bug.title}</h3>
                  <p className="description">{bug.description}</p>
                  <div className="bug-details"><span className="status" data-status={bug.status}>{bug.status}</span><span className="assignee">{bug.assignee || 'Unassigned'}</span></div>
                  <div className="bug-actions">
                    {bug.allowed_transitions.length === 0 ? <span className="done-note">✓ Completed · Done is final</span>
                      : bug.allowed_transitions.map(next => (
                        <button className="secondary" key={next} disabled={updating !== null || creating || loading} onClick={() => changeStatus(bug, next)}>
                          {updating === bug.id ? 'Saving…' : next === 'In Progress' && bug.status === 'Ready for QA' ? 'Return to In Progress' : `Move to ${next}`}
                        </button>
                      ))}
                  </div>
                  <BugHistory bugId={bug.id} status={bug.status} refresh={refresh} />
                </article>
              ))}</div>}
          </section>
        </div>
        <footer>Keep it small. Make it work. See it through.</footer>
      </main>
    </>
  );
}
