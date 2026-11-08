// The open /api/live sockets, one per device (a device has one controller,
// so at most one phone is connected for it). Other modules use this to
// reach the phone without knowing about WebSockets.

const sockets = new Map(); // deviceId -> WebSocket

export function attach(deviceId, socket) {
  sockets.get(deviceId)?.close(4409, 'replaced');
  sockets.set(deviceId, socket);
}

export function detach(deviceId, socket) {
  if (sockets.get(deviceId) === socket) sockets.delete(deviceId);
}

export function sendToPhone(deviceId, message) {
  sockets.get(deviceId)?.send(JSON.stringify(message));
}

// The turn ended: tell the phone why, then close its socket.
export function endTurn(deviceId, reason) {
  const socket = sockets.get(deviceId);
  if (!socket) return;
  socket.send(JSON.stringify({ t: 'released', reason }));
  socket.close(4000, 'released');
  sockets.delete(deviceId);
}

export function endAllTurns(reason) {
  for (const deviceId of [...sockets.keys()]) endTurn(deviceId, reason);
}
