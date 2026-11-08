import { Router } from 'express';
import { z } from 'zod';
import { requireController } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { publishCommand, publishMode } from '../mqtt/publisher.js';
import { LrclibError } from '../utils/lrclib.js';
import { chooseSong, clearMusic, control, loadSong, musicView } from '../utils/music.js';
import { recordActivity, release } from '../utils/turns.js';
import { lyricsUnavailable } from './music.js';

// Mounted at /api/devices behind requireSession: what the phone can do with
// the one device it controls.

const renameSchema = z.object({ name: z.string().trim().min(1).max(40) });
const modeSchema = z.object({ mode: z.enum(['idle', 'eyes', 'music']) });
const commandSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('identify') }),
  z.object({ op: z.literal('reboot') }),
  z.object({ op: z.literal('brightness'), value: z.number().int().min(0).max(255) }),
]);

const songSchema = z.object({
  songId: z.number().int().positive(),
  lyrics: z.boolean().default(true),
});
const controlSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('play') }),
  z.object({ op: z.literal('pause') }),
  z.object({ op: z.literal('seek'), value: z.number().int().min(0) }),
  z.object({ op: z.literal('nudge'), value: z.number().int().min(-60_000).max(60_000) }),
  z.object({ op: z.literal('lyrics'), value: z.boolean() }),
]);

const router = Router();

router.get('/:id', requireController, getDevice);
router.patch('/:id', requireController, validate(renameSchema), renameDevice);
router.put('/:id/mode', requireController, validate(modeSchema), setMode);
router.post('/:id/leave', requireController, leave);
router.post('/:id/commands', requireController, validate(commandSchema), sendCommand);
router.get('/:id/music', requireController, getMusic);
router.put('/:id/music', requireController, validate(songSchema), putMusic);
router.delete('/:id/music', requireController, deleteMusic);
router.post('/:id/music/control', requireController, validate(controlSchema), controlMusic);

export default router;

function getDevice(req, res) {
  res.json({ device: req.device.toPhoneJSON() });
}

async function renameDevice(req, res) {
  req.device.name = req.body.name;
  await req.device.save();
  res.json({ device: req.device.toPhoneJSON() });
}

async function setMode(req, res) {
  req.device.mode = req.body.mode;
  await req.device.save();
  await recordActivity(req.device._id);
  publishMode(req.device._id, req.device.mode);
  res.json({ mode: req.device.mode });
}

// Ends the turn; the OLED shows a fresh QR for the next visitor.
async function leave(req, res) {
  await release(req.device._id, 'left');
  res.status(204).end();
}

function sendCommand(req, res) {
  publishCommand(req.device._id, req.body);
  res.status(202).json({ sent: req.body.op });
}

// { music: null } or { music: { song: {..., lines}, lyrics, playing, positionMs, at } }
async function getMusic(req, res) {
  const song = req.device.music && (await loadSong(req.device.music.song));
  res.json({ music: musicView(req.device, song) });
}

async function putMusic(req, res) {
  let song;
  try {
    song = await loadSong(req.body.songId);
  } catch (err) {
    if (err instanceof LrclibError) throw lyricsUnavailable();
    throw err;
  }
  if (!song) throw new HttpError(404, 'song_not_found', 'That song is no longer available.');
  await chooseSong(req.device, song, req.body.lyrics);
  await recordActivity(req.device._id);
  res.json({ music: musicView(req.device, song) });
}

async function deleteMusic(req, res) {
  await clearMusic(req.device._id);
  res.status(204).end();
}

async function controlMusic(req, res) {
  const song = req.device.music && (await loadSong(req.device.music.song));
  if (!song) throw new HttpError(409, 'no_song', 'Pick a song first.');
  await control(req.device, song, req.body.op, req.body.value);
  await recordActivity(req.device._id);
  res.json({ music: musicView(req.device, song) });
}
