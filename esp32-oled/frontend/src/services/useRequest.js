import { useEffect, useEffectEvent, useState } from 'react';

// Loads data for `key` (and again on `reload()`). `load` receives { onSlow },
// called when the server is slow to answer (it may be waking up).
// Loading is derived from which request has settled, so the effect only
// sets state when a request finishes.
export function useRequest(load, key) {
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${key}:${attempt}`;
  const [result, setResult] = useState({ key: null, data: null, error: null });
  const [slowKey, setSlowKey] = useState(null);
  const runLoad = useEffectEvent(load);

  useEffect(() => {
    let current = true;
    runLoad({ onSlow: () => current && setSlowKey(requestKey) })
      .then((data) => current && setResult({ key: requestKey, data, error: null }))
      .catch((error) => current && setResult({ key: requestKey, data: null, error }));
    return () => {
      current = false;
    };
  }, [requestKey]);

  const settled = result.key === requestKey;
  return {
    data: settled ? result.data : null,
    error: settled ? result.error : null,
    loading: !settled,
    slow: !settled && slowKey === requestKey,
    reload: () => setAttempt((n) => n + 1),
    setData: (update) => setResult((r) => ({ ...r, data: update(r.data) })),
  };
}
