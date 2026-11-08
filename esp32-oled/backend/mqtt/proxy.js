import net from 'node:net';
import { config } from '../utils/config.js';

// Render exposes one port, so devices reach Mosquitto through the backend:
// a WebSocket upgrade on /mqtt is handed to Mosquitto's localhost
// WebSocket listener, and from then on bytes are copied both ways. The
// backend never reads the MQTT traffic.
export function proxyMqttUpgrade(req, socket, head) {
  const upstream = net.connect(config.mqtt.wsPort, '127.0.0.1', () => {
    upstream.write(rawRequestHead(req));
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}

// The upgrade request as it arrived, so Mosquitto completes the handshake.
function rawRequestHead(req) {
  const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}
