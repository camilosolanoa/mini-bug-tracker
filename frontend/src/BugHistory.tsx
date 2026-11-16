import { useEffect, useState } from 'react';
import { request } from './api';
import type { Status } from './api';

type Entry = { id: number; from_status: Status | null; to_status: Status; actor: string; changed_at: string };

export default function BugHistory({ bugId, status }: { bugId: number; status: Status }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    request<Entry[]>(`/bugs/${bugId}/history`, { signal: controller.signal })
      .then(setEntries)
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, bugId, status, retry]);

  return <div className="history">
    <button className="history-toggle" aria-expanded={open} aria-controls={`history-${bugId}`} onClick={() => setOpen(value => !value)}>
      {open ? 'Hide history' : 'View history'}
    </button>
    {open && <div id={`history-${bugId}`} aria-live="polite">
      {loading ? <p>Loading history…</p>
        : error ? <p role="alert">{error} <button className="secondary" onClick={() => setRetry(value => value + 1)}>Retry</button></p>
        : entries.length === 0 ? <p>No recorded changes yet. This bug predates history tracking.</p>
        : <ol>{entries.map(entry => <li key={entry.id}>
          <strong>{entry.from_status ? `${entry.from_status} → ${entry.to_status}` : `Created as ${entry.to_status}`}</strong>
          <span>{entry.actor} · <time dateTime={entry.changed_at}>{new Date(entry.changed_at).toLocaleString()}</time></span>
        </li>)}</ol>}
    </div>}
  </div>;
}
