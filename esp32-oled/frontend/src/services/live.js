import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { API_URL } from './client.js';
import { loadSession } from './session.js';

// /api/live: one WebSocket to the backend for the device this phone controls
// (protocol in backend/live/server.js).
//   phone → server  {"t":"auth","token":"…"}  then  {"t":"imu","v":[pitch,roll,accelG,seq]}
//   server → phone  {"t":"status","online":…,"mode":…}  |  {"t":"released","reason":"…"}
const LIVE_URL = `${API_URL.replace(/^http/, 'ws')}/api/live`;
const SEND_EVERY_MS = 50; // 20 readings a second; the server allows 30
const RECONNECT_MS = 3000;

// Close codes after which reconnecting cannot help.
const FINAL = new Set([4000, 4401, 4404, 4409]);

// Keeps the socket open while mounted. `onStatus({online, mode})` and
// `onReleased(reason)` report server messages. Returns
// { connected, tilt: { state, start, stop } } where state is
// 'off' | 'on' | 'denied' | 'unsupported'.
export function useLive({ onStatus, onReleased }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const handleStatus = useEffectEvent(onStatus);
  const handleReleased = useEffectEvent(onReleased);

  useEffect(() => {
    let stopped = false;
    let retryTimer;

    function connect() {
      const session = loadSession();
      if (!session || stopped) return;
      const ws = new WebSocket(LIVE_URL);
      socketRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ t: 'auth', token: session.token }));
        setConnected(true);
      };
      ws.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.t === 'status') handleStatus({ online: message.online, mode: message.mode });
        if (message.t === 'released') handleReleased(message.reason);
      };
      ws.onclose = (event) => {
        setConnected(false);
        if (socketRef.current === ws) socketRef.current = null;
        if (event.code === 4401 || event.code === 4404) handleReleased('session');
        if (!stopped && !FINAL.has(event.code)) retryTimer = setTimeout(connect, RECONNECT_MS);
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      socketRef.current?.close(1000, 'page closed');
      socketRef.current = null;
    };
  }, []);

  const tilt = useTilt((reading) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'imu', v: reading }));
  });

  return { connected, tilt };
}

// Reads the phone's tilt while on, and passes [pitch, roll, accelG, seq]
// to `send` at most every SEND_EVERY_MS.
function useTilt(send) {
  const supported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  const [state, setState] = useState(supported ? 'off' : 'unsupported');
  const sendReading = useEffectEvent(send);

  useEffect(() => {
    if (state !== 'on') return undefined;
    let seq = 0;
    let lastSent = 0;
    let accelG = 1;

    function onMotion(event) {
      const a = event.accelerationIncludingGravity;
      if (a?.x == null) return;
      accelG = clamp(Math.hypot(a.x, a.y, a.z) / 9.81, 0, 16);
    }
    function onOrientation(event) {
      if (event.beta == null || event.gamma == null) return;
      const now = Date.now();
      if (now - lastSent < SEND_EVERY_MS) return;
      lastSent = now;
      // beta: front/back tilt (pitch), gamma: left/right tilt (roll).
      const pitch = round(clamp(event.beta, -180, 180));
      const roll = round(clamp(event.gamma, -180, 180));
      sendReading([pitch, roll, round(accelG), seq++]);
    }

    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrientation);
    return () => {
      window.removeEventListener('devicemotion', onMotion);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, [state]);

  // Must run from a tap: iOS only asks for motion access inside a user gesture.
  async function start() {
    if (!supported) return;
    const ask = window.DeviceOrientationEvent.requestPermission;
    if (typeof ask === 'function') {
      try {
        if ((await ask()) !== 'granted') return setState('denied');
        await window.DeviceMotionEvent?.requestPermission?.().catch(() => {});
      } catch {
        return setState('denied');
      }
    }
    setState('on');
  }

  return { state, start, stop: () => setState(supported ? 'off' : 'unsupported') };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 10) / 10;
}
