import { Router } from 'express';
import { HttpError, badRequest } from '../middleware/errors.js';
import { musicSearchLimiter } from '../middleware/rateLimit.js';
import { LrclibError, searchSongs } from '../utils/lrclib.js';

// Mounted at /api/music behind requireSession: song search for music mode.

const router = Router();

router.get('/search', musicSearchLimiter, search);

export default router;

async function search(req, res) {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2 || q.length > 100) throw badRequest('invalid_request', 'q: 2 to 100 characters');
  try {
    res.json({ results: await searchSongs(q) });
  } catch (err) {
    if (err instanceof LrclibError) throw lyricsUnavailable();
    throw err;
  }
}

export function lyricsUnavailable() {
  return new HttpError(
    502,
    'lyrics_unavailable',
    'The song search is not answering right now. Try again in a minute.',
  );
}
