import { request } from './client.js';

// One function per backend route the phone uses (docs/plan/README.md §7).
// Every function takes an optional `onSlow` for the waking-server notice.

export const pair = (code, name, opts) =>
  request('/api/pair', { method: 'POST', body: { code, name }, ...opts });

export const getMe = (opts) => request('/api/me', opts);

export const logout = (opts) => request('/api/logout', { method: 'POST', ...opts });

export const getDevice = (id, opts) => request(`/api/devices/${id}`, opts);

export const renameDevice = (id, name, opts) =>
  request(`/api/devices/${id}`, { method: 'PATCH', body: { name }, ...opts });

export const setMode = (id, mode, opts) =>
  request(`/api/devices/${id}/mode`, { method: 'PUT', body: { mode }, ...opts });

export const createMemberCode = (id, opts) =>
  request(`/api/devices/${id}/pairing-codes`, { method: 'POST', ...opts });

export const removeMember = (id, userId, opts) =>
  request(`/api/devices/${id}/members/${userId}`, { method: 'DELETE', ...opts });
