import { useState } from 'react';
import { useGet } from './useGet';
import type { Status } from './api';

type Entry = { id: number; from_status: Status | null; to_status: Status; actor: string; changed_at: string };

export default function BugHistory({ bugId, status, refresh }: { bugId: number; status: Status; refresh: number }) {
  const [open, setOpen] = useState(false);
  const history = useGet<Entry[]>(open ? `/bugs/${bugId}/history` : null, `${status}:${refresh}`);

  return <div className="history">
    <button className="link" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? 'Hide history' : 'View history'}
    </button>
    {open && <div aria-live="polite" aria-busy={history.loading}>
      {history.loading && history.data === null && <p>Loading history…</p>}
      {history.error && <p role="alert">{history.error} <button onClick={history.reload}>Retry</button></p>}
      {history.data !== null && !history.error && (history.data.length ? <ol>
        {history.data.map(entry => <li key={entry.id}>
          <strong>{entry.from_status ? `${entry.from_status} → ${entry.to_status}` : `Created as ${entry.to_status}`}</strong>
          <span className="muted">{entry.actor} · <time dateTime={entry.changed_at}>{new Date(entry.changed_at).toLocaleString()}</time></span>
        </li>)}
      </ol> : <p>No recorded changes yet. This bug predates history tracking.</p>)}
    </div>}
  </div>;
}
