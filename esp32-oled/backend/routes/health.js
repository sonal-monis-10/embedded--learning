import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

// Render's health check. Returns 503 while MongoDB is unreachable, so Render
// doesn't route traffic to an instance that can't serve it. Mosquitto's state
// joins this check when the broker is added.
router.get('/', (req, res) => {
  const dbUp = mongoose.connection.readyState === mongoose.ConnectionStates.connected;
  res.status(dbUp ? 200 : 503).json({
    status: dbUp ? 'ok' : 'degraded',
    db: dbUp ? 'up' : 'down',
    uptimeSeconds: Math.round(process.uptime()),
  });
});

export default router;
