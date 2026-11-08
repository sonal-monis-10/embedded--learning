import { Device } from '../entity/device.js';
import { Song } from '../entity/song.js';
import { publishLines, publishMode, publishSync, publishTrack } from '../mqtt/publisher.js';
import { logger } from './logger.js';
import { fetchSong } from './lrclib.js';

// Music mode: the song on a device and its clock. The ESP32 plays no audio;
// the visitor plays the song in their own music app and taps Play here at
// the same moment. The backend keeps the clock and tells the device.

const SYNC_EVERY_MS = 5000;
// The device's MQTT buffer is 16 KB; long songs lose their last lines.
const MAX_LINES_BYTES = 15_000;

// Where the song is at `now`, in ms (stops at the end).
export function positionAt(music, durationMs, now = Date.now()) {
  const elapsed = music.playing ? now - music.updatedAt.getTime() : 0;
  return clamp(music.positionMs + elapsed, 0, durationMs);
}

// The song from our cache, else from LRCLIB (then cached). Null if unknown.
export async function loadSong(id) {
  const cached = await Song.findById(id);
  if (cached) return cached;
  const fetched = await fetchSong(id);
  if (!fetched) return null;
  const { id: _id, ...fields } = fetched;
  return Song.findOneAndUpdate(
    { _id },
    { $set: fields },
    { upsert: true, returnDocument: 'after' },
  );
}

// Puts `song` on the device, paused at 0:00, and switches it to music mode.
export async function chooseSong(device, song, lyrics) {
  device.music = {
    song: song._id,
    lyrics: lyrics && song.lyrics === 'synced',
    positionMs: 0,
    playing: false,
    updatedAt: new Date(),
  };
  device.mode = 'music';
  await device.save();
  publishMode(device._id, 'music');
  publishTrack(device._id, trackMessage(device, song));
  publishLines(device._id, linesMessage(song));
  publishSync(device._id, syncMessage(device, song));
}

// op: play | pause | seek (value = ms) | nudge (value = ± ms) | lyrics (value = bool)
export async function control(device, song, op, value, now = Date.now()) {
  const music = device.music;
  const pos = positionAt(music, song.durationMs, now);

  switch (op) {
    case 'play':
      // At the end, Play starts the song again.
      music.positionMs = pos >= song.durationMs ? 0 : pos;
      music.playing = true;
      break;
    case 'pause':
      music.positionMs = pos;
      music.playing = false;
      break;
    case 'seek':
      music.positionMs = clamp(value, 0, song.durationMs);
      break;
    case 'nudge':
      music.positionMs = clamp(pos + value, 0, song.durationMs);
      break;
    case 'lyrics':
      music.positionMs = pos;
      music.lyrics = Boolean(value) && song.lyrics === 'synced';
      break;
  }
  music.updatedAt = new Date(now);
  await device.save();

  if (op === 'lyrics') publishTrack(device._id, trackMessage(device, song));
  publishSync(device._id, syncMessage(device, song, now));
}

// What the phone sees: the song with its lines, and the clock.
export function musicView(device, song, now = Date.now()) {
  if (!device.music || !song) return null;
  return {
    song: {
      id: song._id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      durationMs: song.durationMs,
      lyrics: song.lyrics,
      lines: song.lines.map(({ t, text }) => [t, text]),
    },
    lyrics: device.music.lyrics,
    playing: device.music.playing,
    positionMs: positionAt(device.music, song.durationMs, now),
    at: now,
  };
}

// Takes the song off the device (and its retained messages off the broker).
export async function clearMusic(deviceId) {
  await Device.updateOne({ _id: deviceId }, { $set: { music: null } });
  publishTrack(deviceId, null);
  publishLines(deviceId, null);
  publishSync(deviceId, null);
}

// Before the nightly reset: clears the broker's copy for every device.
export async function clearAllMusic() {
  const withMusic = await Device.find({ music: { $ne: null } }, { _id: 1 });
  for (const { _id } of withMusic) await clearMusic(_id);
}

// Re-sends the clock of every playing song, pauses songs that reached
// their end, and counts a playing song as activity so the turn isn't
// ended as idle while the phone is locked.
export async function syncPlaying(now = Date.now()) {
  const playing = await Device.find({ 'music.playing': true });
  for (const device of playing) {
    const song = await Song.findById(device.music.song);
    if (!song) continue;
    if (positionAt(device.music, song.durationMs, now) >= song.durationMs) {
      await control(device, song, 'pause', undefined, now);
      continue;
    }
    publishSync(device._id, syncMessage(device, song, now));
    if (device.controller) {
      await Device.updateOne(
        { _id: device._id, controller: { $ne: null } },
        { $set: { 'controller.lastActiveAt': new Date(now) } },
      );
    }
  }
}

export function scheduleMusicSync() {
  const timer = setInterval(
    () => syncPlaying().catch((err) => logger.error({ err }, 'music sync failed')),
    SYNC_EVERY_MS,
  ).unref();
  return () => clearInterval(timer);
}

function trackMessage(device, song) {
  return {
    id: song._id,
    title: song.title,
    artist: song.artist,
    durationMs: song.durationMs,
    lyrics: device.music.lyrics,
    hasLyrics: song.lyrics === 'synced',
  };
}

// "#<id>\n<ms>\t<text>\n…", cut before MAX_LINES_BYTES.
export function linesMessage(song) {
  let text = `#${song._id}\n`;
  for (const { t, text: line } of song.lines) {
    const next = `${t}\t${line}\n`;
    if (Buffer.byteLength(text + next) > MAX_LINES_BYTES) break;
    text += next;
  }
  return text;
}

function syncMessage(device, song, now = Date.now()) {
  return {
    id: song._id,
    pos: positionAt(device.music, song.durationMs, now),
    playing: device.music.playing,
    at: now,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
