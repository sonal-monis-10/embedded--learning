import { Router } from 'express';
import mongoose from 'mongoose';
import { brokerState } from '../mqtt/broker.js';

// Render's health check. 503 while MongoDB is down or the broker is still
// starting, so Render doesn't send traffic to an instance that can't serve it.
const router = Router();

router.get('/', health);

export default router;

function health(_req, res) {
  const dbUp = mongoose.connection.readyState === mongoose.ConnectionStates.connected;
  const broker = brokerState();
  const healthy = dbUp && broker !== 'starting';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    db: dbUp ? 'up' : 'down',
    broker,
    uptimeSeconds: Math.round(process.uptime()),
  });
}
