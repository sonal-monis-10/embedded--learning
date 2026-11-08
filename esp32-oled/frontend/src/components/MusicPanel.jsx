import { useEffect, useState } from 'react';
import { Music, Pause, Play, Search, Square } from 'lucide-react';
import { connectionProblem } from '../services/messages.js';
import { chooseSong, getMusic, musicControl, searchMusic, stopMusic } from '../services/api.js';

const SEARCH_DELAY_MS = 400;
const NUDGE_MS = 250;

// Music mode: pick a song, then play it in your own music app and tap Play
// here at the same moment. The device shows the lyrics (or a disc and the
// progress) on the backend's clock, which keeps going if the phone locks.
export default function MusicPanel({ deviceId }) {
  // music: the server's answer, plus `receivedAt` (this phone's clock) so
  // the position can be worked out locally between requests.
  const [music, setMusic] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [searching, setSearching] = useState(false);

  const accept = (data) => setMusic(data.music && { ...data.music, receivedAt: Date.now() });

  useEffect(() => {
    let current = true;
    getMusic(deviceId)
      .then((data) => current && (accept(data), setLoaded(true)))
      .catch((err) => current && (setError(err), setLoaded(true)));
    return () => {
      current = false;
    };
  }, [deviceId]);

  async function send(call) {
    setError(null);
    try {
      accept(await call());
    } catch (err) {
      setError(err);
    }
  }

  if (!loaded) return <div className="card skeleton" aria-label="Loading music" />;

  const pick = async (song) => {
    await send(() => chooseSong(deviceId, song.id, song.lyrics === 'synced'));
    setSearching(false);
  };

  return (
    <section className="card music" aria-labelledby="music-title">
      <h2 id="music-title" className="card-title">
        <Music size={22} aria-hidden="true" />
        Music
      </h2>
      {error && <p className="inline-error">{connectionProblem(error)}</p>}
      {!music || searching ? (
        <SongSearch onPick={pick} onCancel={music ? () => setSearching(false) : null} />
      ) : (
        <NowPlaying
          music={music}
          onControl={(body) => send(() => musicControl(deviceId, body))}
          onChange={() => setSearching(true)}
          onStop={() => send(async () => (await stopMusic(deviceId), { music: null }))}
        />
      )}
    </section>
  );
}

function SongSearch({ onPick, onCancel }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Searches a moment after typing stops; a newer query wins.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      setBusy(true);
      searchMusic(q)
        .then((data) => current && (setResults(data.results), setError(null)))
        .catch((err) => current && setError(err))
        .finally(() => current && setBusy(false));
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  const shown = query.trim().length >= 2 ? results : null;

  return (
    <div className="song-search">
      <div className="field">
        <label htmlFor="song-query">Find a song</label>
        <div className="search-box">
          <Search size={20} aria-hidden="true" />
          <input
            id="song-query"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Song or artist"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={100}
          />
        </div>
        <p className="help" aria-live="polite">
          {busy ? 'Searching…' : 'Lyrics come from LRCLIB, a free lyrics library.'}
        </p>
      </div>

      {error && <p className="inline-error">{connectionProblem(error)}</p>}
      {shown?.length === 0 && <p className="muted">Nothing found. Try the artist’s name too.</p>}
      {shown?.length > 0 && (
        <ul className="song-results">
          {shown.map((song) => (
            <li key={song.id}>
              <button type="button" className="song-row" onClick={() => onPick(song)}>
                <span className="song-row-text">
                  <span className="song-title">{song.title}</span>
                  <span className="song-meta">
                    {[song.artist, formatTime(song.durationMs)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <LyricsBadge lyrics={song.lyrics} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {onCancel && (
        <button type="button" className="text-btn" onClick={onCancel}>
          Keep the current song
        </button>
      )}
    </div>
  );
}

function LyricsBadge({ lyrics }) {
  if (lyrics === 'synced') return <span className="badge badge-ok">Lyrics</span>;
  if (lyrics === 'other-script') return <span className="badge">Title only</span>;
  return <span className="badge">No lyrics</span>;
}

function NowPlaying({ music, onControl, onChange, onStop }) {
  const { song } = music;
  const position = usePosition(music);
  const [dragMs, setDragMs] = useState(null);
  const shownMs = dragMs ?? position;
  const [now, next] = currentLines(song.lines, shownMs);
  const canShowLyrics = song.lyrics === 'synced';

  function commitSeek() {
    if (dragMs === null) return;
    onControl({ op: 'seek', value: Math.round(dragMs) });
    setDragMs(null);
  }

  return (
    <div className="now-playing">
      <div className="song-head">
        <p className="song-title">{song.title}</p>
        {song.artist && <p className="song-meta">{song.artist}</p>}
      </div>

      {music.lyrics && (
        <div className="lyrics-preview" aria-live="off">
          <p className="lyric-now">{now || '♪'}</p>
          <p className="lyric-next">{next}</p>
        </div>
      )}

      <div className="seek">
        <input
          type="range"
          min={0}
          max={song.durationMs}
          step={1000}
          value={Math.round(shownMs)}
          onChange={(e) => setDragMs(Number(e.target.value))}
          onPointerUp={commitSeek}
          onKeyUp={commitSeek}
          onBlur={commitSeek}
          aria-label="Position in the song"
          aria-valuetext={`${formatTime(shownMs)} of ${formatTime(song.durationMs)}`}
        />
        <div className="seek-times">
          <span>{formatTime(shownMs)}</span>
          <span>{formatTime(song.durationMs)}</span>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary play-btn"
        onClick={() => onControl({ op: music.playing ? 'pause' : 'play' })}
      >
        {music.playing ? (
          <Pause size={22} aria-hidden="true" />
        ) : (
          <Play size={22} aria-hidden="true" />
        )}
        {music.playing ? 'Pause' : 'Play'}
      </button>
      <p className="help">
        Start the song in your music app and tap <strong>Play</strong> at the same moment.
      </p>

      <div className="nudge" role="group" aria-label="Fix the timing">
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => onControl({ op: 'nudge', value: -NUDGE_MS })}
        >
          Lyrics early? −0.25 s
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => onControl({ op: 'nudge', value: NUDGE_MS })}
        >
          Lyrics late? +0.25 s
        </button>
      </div>

      <label className="switch">
        <input
          type="checkbox"
          checked={music.lyrics}
          disabled={!canShowLyrics}
          onChange={(e) => onControl({ op: 'lyrics', value: e.target.checked })}
        />
        <span>
          Lyrics on the screen
          <span className="help switch-help">
            {canShowLyrics
              ? 'Off shows a spinning disc and the progress.'
              : 'These lyrics aren’t in English letters, so the screen shows the disc and progress.'}
          </span>
        </span>
      </label>

      <div className="music-actions">
        <button type="button" className="btn btn-secondary" onClick={onChange}>
          Change song
        </button>
        <button type="button" className="btn btn-secondary" onClick={onStop}>
          <Square size={18} aria-hidden="true" />
          Stop
        </button>
      </div>
    </div>
  );
}

// The song position now, re-rendered a few times a second while playing.
// `now` lives in state so rendering stays pure.
function usePosition(music) {
  const [now, setNow] = useState(music.receivedAt);
  useEffect(() => {
    if (!music.playing) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [music.playing, music.receivedAt]);

  const elapsed = music.playing ? Math.max(0, now - music.receivedAt) : 0;
  return Math.min(music.song.durationMs, music.positionMs + elapsed);
}

// The line being sung at `ms` and the one after it.
function currentLines(lines, ms) {
  let i = -1;
  for (let lo = 0, hi = lines.length - 1; lo <= hi;) {
    const mid = (lo + hi) >> 1;
    if (lines[mid][0] <= ms) {
      i = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return [lines[i]?.[1] ?? '', lines[i + 1]?.[1] ?? ''];
}

function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
