// The phone's pass: the session token from POST /api/pair, kept in
// localStorage until it expires at midnight. Storage can be unavailable
// (private mode, blocked site data), so every access is guarded.
const KEY = 'oled.session';

export function loadSession() {
  try {
    const session = JSON.parse(localStorage.getItem(KEY));
    if (!session?.token || new Date(session.expiresAt) <= new Date()) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveSession({ token, expiresAt, userId, userName }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, expiresAt, userId, userName }));
  } catch {
    // Without storage the pass lasts until the tab closes; nothing else to do.
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
