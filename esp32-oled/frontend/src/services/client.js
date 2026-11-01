// Base URL of the backend, baked in at build time from VITE_API_URL
// (frontend/.env locally, the Render static site's env vars in production).
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');

// Error thrown for any non-2xx response. `code` matches the backend's
// { error: { code, message } } shape, or 'network' when the request failed.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getJson(path, { signal } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', `Cannot reach the backend at ${API_URL}`);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'http_error',
      body?.error?.message ?? res.statusText,
    );
  }
  return body;
}
