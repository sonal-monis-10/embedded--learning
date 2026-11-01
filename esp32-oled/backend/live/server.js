import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { Device } from '../entity/device.js';
import { Session } from '../entity/session.js';
import { publishImu } from '../mqtt/publisher.js';
import { logger } from '../utils/logger.js';
import { recordActivity } from '../utils/turns.js';
import { attach, detach } from './hub.js';

// /api/live: one WebSocket per phone, for the device it controls.
//   phone → server  {"t":"auth","token":"…"}            first, within 5 s
//                   {"t":"imu","v":[pitch,roll,accelG,seq]}
//   server → phone  {"t":"status","online":…,"mode":…}  on connect
//                   {"t":"released","reason":"idle"}    when the turn ends
// The token travels in a message, not the URL, so it never lands in logs.

const PATH = '/api/live';
const AUTH_TIMEOUT_MS = 5000;
const PING_EVERY_MS = 25_000; // keeps Render's proxy and the free instance awake
const MAX_READINGS_PER_SECOND = 30;

// Close codes the phone can act on.
const CLOSE = { badMessage: 4400, unauthorized: 4401, notYourDevice: 4404 };

const authMessage = z.object({ t: z.literal('auth'), token: z.string().min(1).max(100) });
const imuMessage = z.object({
  t: z.literal('imu'),
  v: z.tuple([
    z.number().min(-180).max(180), // pitch (degrees)
    z.number().min(-180).max(180), // roll (degrees)
    z.number().min(0).max(16), // acceleration (g)
    z.number().int().min(0), // sequence number
  ]),
});

export function attachLiveServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  httpServer.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://localhost').pathname !== PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws));
  });

  const pinger = setInterval(() => {
    for (const ws of wss.clients) ws.ping();
  }, PING_EVERY_MS).unref();

  return () => {
    clearInterval(pinger);
    for (const ws of wss.clients) ws.close(1001, 'server shutting down');
    wss.close();
  };
}

function handleConnection(ws) {
  const authTimer = setTimeout(() => ws.close(CLOSE.unauthorized, 'auth timeout'), AUTH_TIMEOUT_MS);
  let deviceId = null;
  const limiter = perSecondLimiter(MAX_READINGS_PER_SECOND);

  ws.on('message', async (data) => {
    const message = parse(data);
    if (!message) return ws.close(CLOSE.badMessage, 'bad message');

    if (!deviceId) {
      clearTimeout(authTimer);
      deviceId = await authenticate(ws, message);
      return;
    }

    const reading = imuMessage.safeParse(message);
    if (!reading.success || !limiter()) return; // drop bad or excess readings quietly
    publishImu(deviceId, reading.data.v);
    recordActivity(deviceId, { tilt: true }).catch((err) =>
      logger.error({ err, deviceId }, 'recording tilt activity failed'),
    );
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    if (deviceId) detach(deviceId, ws);
  });
}

// Checks the session and that it controls a device; returns that device's
// ID, or null after closing the socket.
async function authenticate(ws, message) {
  const auth = authMessage.safeParse(message);
  if (!auth.success) return reject(ws, CLOSE.unauthorized, 'auth required');

  const session = await Session.findActive(auth.data.token);
  if (!session?.user) return reject(ws, CLOSE.unauthorized, 'session ended');

  const device = await Device.controlledBy(session.user._id);
  if (!device) return reject(ws, CLOSE.notYourDevice, 'no device');

  attach(device._id, ws);
  ws.send(JSON.stringify({ t: 'status', online: device.online, mode: device.mode }));
  return device._id;
}

function reject(ws, code, reason) {
  ws.close(code, reason);
  return null;
}

function parse(data) {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

// Returns a function that answers true while fewer than `limit` calls
// happened in the current one-second window.
function perSecondLimiter(limit) {
  let windowStart = 0;
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      count = 0;
    }
    return ++count <= limit;
  };
}
