import { clearSession, loadSession } from './session.js';

// Base URL of the backend, baked in at build time from VITE_API_URL.
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');

// Render's free tier sleeps; the first request after a while can take a
// minute. Callers get `onSlow` after this long so they can say so.
const SLOW_AFTER_MS = 3000;
const GIVE_UP_AFTER_MS = 70_000;

// `code` matches the backend's { error: { code, message } }, or one of
// 'network' / 'timeout' when the request never got an answer.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function request(path, { method = 'GET', body, onSlow } = {}) {
  const session = loadSession();
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session) headers.Authorization = `Bearer ${session.token}`;

  const slowTimer = onSlow && setTimeout(onSlow, SLOW_AFTER_MS);
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(GIVE_UP_AFTER_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new ApiError(0, 'timeout', 'The server took too long to answer.');
    }
    throw new ApiError(0, 'network', 'Could not reach the server.');
  } finally {
    clearTimeout(slowTimer);
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const code = data?.error?.code ?? 'http_error';
    // The pass expired (midnight) or was ended: forget it locally too.
    if (code === 'session_required') clearSession();
    throw new ApiError(res.status, code, data?.error?.message ?? res.statusText);
  }
  return data;
}
