import { Router } from 'express';
import mongoose from 'mongoose';

// Render's health check. 503 while MongoDB is down, so Render doesn't send
// traffic to an instance that can't serve it.
const router = Router();

router.get('/', health);

export default router;

function health(_req, res) {
  const dbUp = mongoose.connection.readyState === mongoose.ConnectionStates.connected;
  res.status(dbUp ? 200 : 503).json({
    status: dbUp ? 'ok' : 'degraded',
    db: dbUp ? 'up' : 'down',
    uptimeSeconds: Math.round(process.uptime()),
  });
}
