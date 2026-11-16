import { useEffect, useState } from 'react';
import { request } from './api';

// Shared by the session, bug list, and history. A null path pauses fetching.
export function useGet<T>(path: string | null, refreshKey: string | number = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    request<T>(path, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, version, refreshKey]);

  return { data, loading, error, version, reload: () => setVersion(value => value + 1) };
}
