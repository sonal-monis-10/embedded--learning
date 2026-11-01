import { useEffect, useState } from 'react';
import { API_URL, getJson } from './services/client.js';

// Placeholder home page for the scaffold: proves the frontend can reach the
// backend. Login, the device dashboard and routing replace it in phase 1.
export default function App() {
  const [health, setHealth] = useState({ state: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    getJson('/healthz', { signal: controller.signal })
      .then((body) => setHealth({ state: 'ok', uptime: body.uptimeSeconds }))
      .catch((err) => {
        if (err.name !== 'AbortError') setHealth({ state: 'error', message: err.message });
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="page">
      <h1>OLED Control</h1>
      <p className="muted">Robot eyes and music for your ESP32 displays.</p>

      <section className="card" aria-live="polite">
        <h2>Backend</h2>
        <p className="mono">{API_URL}</p>
        {health.state === 'loading' && <p className="muted">Checking…</p>}
        {health.state === 'ok' && (
          <p className="status ok">
            <span className="dot" aria-hidden="true" /> Online, up {health.uptime}s
          </p>
        )}
        {health.state === 'error' && (
          <p className="status error">
            <span className="dot" aria-hidden="true" /> {health.message}
          </p>
        )}
      </section>
    </main>
  );
}
