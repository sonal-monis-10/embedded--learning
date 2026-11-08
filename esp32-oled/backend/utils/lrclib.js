import { config } from './config.js';
import { isLatinScript, parseLrc, toOledText } from './lrc.js';

// LRCLIB (https://lrclib.net): free song search with timed lyrics.
// LRCLIB asks clients to send a User-Agent naming the app and to avoid
// parallel requests, so calls run one at a time.

const TIMEOUT_MS = 5000;
const SEARCH_CACHE_MS = 10 * 60_000;
const SEARCH_CACHE_MAX = 200;
const MAX_RESULTS = 15;
const USER_AGENT = 'esp32-oled/0.1.0 (https://github.com/sonal-monis-10/embedded--learning)';

let fetchImpl = (...args) => fetch(...args);
let queue = Promise.resolve();
const searchCache = new Map(); // query -> { at, results }

// Tests swap in a fake fetch.
export function useFetch(next) {
  fetchImpl = next;
  searchCache.clear();
}

export class LrclibError extends Error {}

// [{ id, title, artist, album, durationMs, lyrics }] where lyrics is
// 'synced' (timed, OLED-readable), 'other-script' (timed, but not in Latin
// letters) or 'none'. Readable songs come first.
export async function searchSongs(query) {
  const key = query.trim().toLowerCase();
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) return cached.results;

  const found = await get(`/api/search?q=${encodeURIComponent(key)}`);
  const rank = { synced: 0, 'other-script': 1, none: 2 };
  const results = (Array.isArray(found) ? found : [])
    .filter((r) => !r.instrumental)
    .map(summary)
    .sort((a, b) => rank[a.lyrics] - rank[b.lyrics])
    .slice(0, MAX_RESULTS);

  if (searchCache.size >= SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
  searchCache.set(key, { at: Date.now(), results });
  return results;
}

// One song with its parsed lines, or null if LRCLIB doesn't have it.
export async function fetchSong(id) {
  const record = await get(`/api/get/${id}`, { notFoundIsNull: true });
  if (!record) return null;
  const s = summary(record);
  return { ...s, lines: s.lyrics === 'synced' ? parseLrc(record.syncedLyrics) : [] };
}

function summary(r) {
  let lyrics = 'none';
  if (r.syncedLyrics) lyrics = isLatinScript(r.syncedLyrics) ? 'synced' : 'other-script';
  return {
    id: r.id,
    title: toOledText(r.trackName ?? '').slice(0, 60) || 'Untitled',
    artist: toOledText(r.artistName ?? '').slice(0, 60),
    album: toOledText(r.albumName ?? '').slice(0, 60),
    durationMs: Math.round((r.duration ?? 0) * 1000),
    lyrics,
  };
}

// GET with a timeout, one retry on a 5xx or network error, one at a time.
function get(path, { notFoundIsNull = false } = {}) {
  const run = async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetchImpl(`${config.lrclibUrl}${path}`, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.status === 404 && notFoundIsNull) return null;
        if (res.status >= 500 && attempt === 1) continue;
        if (!res.ok) throw new LrclibError(`LRCLIB answered ${res.status}`);
        return await res.json();
      } catch (err) {
        if (err instanceof LrclibError || attempt > 1) {
          throw err instanceof LrclibError ? err : new LrclibError(err.message);
        }
      }
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
