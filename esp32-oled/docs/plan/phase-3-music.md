# Phase 3: Music mode (disc + progress, synced lyrics)

**Goal:** search for a song on the phone and select it. The OLED shows a
spinning disc with title and progress (**lyrics off**), or the lyrics line by
line, in time with the song (**lyrics on**).

The ESP32 does **not** play audio. You play the song in your usual music
app and tap **Play** on our page at the same moment. A nudge control
fixes any offset.

Needs phase 1. Shared design: [README.md](README.md).

---

## A. Data flow

```
Phone: search "tum hi ho"  ──GET /api/music/search──►  backend ──► LRCLIB /api/search (cached in `songs`)
Phone: select + lyrics on  ──PUT /api/devices/:id/music──► backend:
                                  1. LRCLIB /api/get/:id → parse timed lyrics → save `songs`
                                  2. save `playback` {songId, lyrics, pos 0, paused}
                                  3. publish retained  music/track, music/lines
                                  4. PUT mode = music
Phone: Play / Pause / Seek / Nudge ──POST …/music/control──► backend playback clock
                                  → publish music/sync immediately, then every 2 s while playing
ESP32: local clock = pos + (now − at), corrected by each sync → draws the frame
```

The **backend owns the playback clock**. It keeps running when the phone
locks or closes the page, and survives a backend restart (stored in
`playback`).

## B. Backend

### B1. LRCLIB client (`services/lrclib.js`)
- `GET https://lrclib.net/api/search?q=…` for search, `GET /api/get/:id` for one song.
- Sends `User-Agent: esp32-oled/<version> (<repo url>)`, which LRCLIB
  asks clients to do.
- One request at a time (LRCLIB limits parallel requests), 5 s timeout,
  retry once on 5xx.
- Caches search results in memory for 10 min; caches songs in `songs` (permanent).
- Rate limit: 20 searches/min per user.

### B2. LRC parsing
LRCLIB returns `syncedLyrics` in LRC format:
```
[00:12.34] First line
[00:15.80] Second line
```
Parsed into `[[12340, "First line"], [15800, "Second line"]]`.
- Handles multiple timestamps per line (`[00:12.34][01:40.00] chorus`), `[offset:…]` tags and empty lines (used as instrumental gaps).
- Characters outside the OLED font are converted: curly quotes → `'` and `"`,
  accented letters → base letter where possible, anything left → dropped.
- Songs with only `plainLyrics` (no timestamps) → `lyrics` unavailable;
  disc mode with a "no synced lyrics" note.

### B3. Playback service (`services/playback.js`)
State per device: `{songId, lyrics, positionMs, playing, updatedAt}`.

| Op | Effect |
|----|--------|
| `play` | `playing = true`, `updatedAt = now` |
| `pause` | `positionMs` += elapsed, `playing = false` |
| `seek` | `positionMs = value` |
| `nudge` | `positionMs += value` (±250 ms buttons; any value allowed) |
| end of song | auto `pause` at `durationMs` |

Each change → `music/sync` `{pos, playing, at}` where `at` is the server
time in ms. While playing, a 2 s timer re-publishes `sync` for devices
that have an active song. The device uses `at` to compensate for message
delay. Time on the device comes from SNTP (`configTime`), synced at boot.

### B4. Routes
`GET /api/music/search`, `PUT /api/devices/:id/music`,
`POST /api/devices/:id/music/control`, `GET /api/devices/:id/music`. See README §7.

## C. Frontend: Music tab

- Search box (debounced) → result list: title, artist, duration, a "synced lyrics" badge.
- Selecting a song → **Lyrics on/off** toggle.
- Transport: Play / Pause, seek bar (drag), elapsed/total time, **−250 ms / +250 ms** nudge.
- Current lyric line shown on the phone too (from `music/lines` + the same clock), which also helps check sync.
- "Now on device" header from the retained `music/track`.

## D. Firmware: music mode (`modes/music.*`)

### D1. Song clock
- `pos(now) = sync.pos + (now − sync.at)` while playing, frozen when paused.
- A small difference (< 300 ms) is eased in over 1 s so lines don't jump;
  a big one (a seek) jumps immediately.
- Lines are found by binary search on the timestamp array (stored once
  per song; 100 lines ≈ 5 KB RAM).

### D2. Lyrics off: "now playing" screen
```
┌────────────────────────────────┐
│  ╭───╮   Tum Hi Ho  ◄ marquee  │
│ │ ◉  │   Arijit Singh          │
│  ╰───╯                         │
│ ▓▓▓▓▓▓▓▓▓░░░░░░░░░░  1:23/4:22 │
└────────────────────────────────┘
```
- Disc: circle with groove marks and a label dot. The marks rotate
  (about 33 rpm feel) while playing and stop when paused.
- Title/artist scroll horizontally if longer than the space.
- Progress bar + `m:ss / m:ss`.
- Paused: a pause icon over the disc.

### D3. Lyrics on: karaoke screen
- Current line: size 2 if it fits on 2 lines, otherwise size 1 with
  word-wrap (up to 4 lines).
- Next line: size 1, at the bottom.
- Line change: slide-up transition (150 ms).
- Instrumental gaps (> 5 s with no line): a small "♪" animation plus the disc.
- 1-pixel progress bar along the very bottom.

### D4. Memory
`music/lines` arrives as one retained message, up to ~12 KB for long
songs (MQTT buffer is 16 KB since phase 1). It is parsed with ArduinoJson
into a compact array. If a song is too long, the backend splits it into
`music/lines/0..n` (decided by size, transparent to the user).

## E. Tests

| Test | Pass condition |
|------|----------------|
| LRC parser | Unit tests: multi-timestamp lines, offset tag, empty lines, unicode cleanup |
| Sync accuracy | After one nudge, lyrics stay within ±200 ms of the music for a whole 4-minute song |
| Control latency | Pause / seek on phone → OLED reacts in < 500 ms |
| Restart | Redeploy backend mid-song → device keeps time locally, re-syncs after reconnect, no jump > 300 ms |
| Phone locked | Clock continues; device stays in sync |
| No lyrics | Song without synced lyrics → disc screen + note, lyrics toggle disabled |
| Long titles | Marquee, no overflow |
| LRCLIB down | Search shows a friendly error; already cached songs still work |

## F. Done when

- [ ] Search → select → OLED shows the song within 2 s.
- [ ] Lyrics-off disc screen and lyrics-on karaoke screen both work, on hardware and Wokwi.
- [ ] Play/pause/seek/nudge from the phone work; sync holds for a full song.
- [ ] Closing or locking the phone doesn't stop the song.
