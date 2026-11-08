import { request } from './client.js';

// One function per backend route the phone uses (backend/routes/pairing.js
// and devices.js). Every function takes an optional `onSlow` for the
// waking-server notice.

export const pair = (code, name, opts) =>
  request('/api/pair', { method: 'POST', body: { code, name }, ...opts });

// { user, expiresAt, device | null }: the one device this phone controls.
export const getMe = (opts) => request('/api/me', opts);

export const logout = (opts) => request('/api/logout', { method: 'POST', ...opts });

export const getDevice = (id, opts) => request(`/api/devices/${id}`, opts);

export const renameDevice = (id, name, opts) =>
  request(`/api/devices/${id}`, { method: 'PATCH', body: { name }, ...opts });

export const setMode = (id, mode, opts) =>
  request(`/api/devices/${id}/mode`, { method: 'PUT', body: { mode }, ...opts });

// Ends this phone's turn; the OLED shows a fresh QR for the next person.
export const leaveDevice = (id, opts) =>
  request(`/api/devices/${id}/leave`, { method: 'POST', ...opts });

// command: { op: 'identify' } | { op: 'reboot' } | { op: 'brightness', value: 0-255 }
export const sendCommand = (id, command, opts) =>
  request(`/api/devices/${id}/commands`, { method: 'POST', body: command, ...opts });
