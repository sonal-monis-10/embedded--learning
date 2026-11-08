# Phase 4: AI-generated "reels-style" lyric animations

**Goal:** when a song is selected with lyrics on, Claude designs a unique
animation for it: words popping in, a huge word slamming onto the screen
on the hook, flashes, shakes, typewriter verses. The ESP32 plays it in sync
with the music.

Needs phase 3 (songs, timed lyrics, playback clock). Shared design: [README.md](README.md).

---

## A. What is realistic on this screen

128×64 pixels, 1 bit per pixel, ~30 fps over I2C. That is enough for
**kinetic typography**, the style of lyric reels. It is not video.

The key design choice: **Claude never draws pixels.** It picks effects from
a fixed menu that the ESP32 already knows how to render, and decides
*when*, *how big*, and *which word to emphasise*. That keeps the output:
- small (a few KB of JSON),
- safe (an unknown effect falls back to a plain one; nothing can crash the device),
- checkable (validated against a schema before it is sent).

## B. Effect menu (implemented on the ESP32 and in the browser preview)

| Effect | Look | Parameters |
|--------|------|------------|
| `center_hold` | Line centred, static (also the fallback) | `size` |
| `typewriter` | Letters appear one by one | `size`, `cps` (chars/s) |
| `word_pop` | Words appear one at a time, each with a small scale "pop" | `size`, `words` (ms offsets) |
| `slam` | One huge word (size 3–4) drops in and the screen shakes | `text`, `shake` (px) |
| `slide` | Line slides in | `dir` (up/down/left/right), `size` |
| `zoom_in` | Text grows from small to large | `from`, `to` |
| `flash_invert` | Screen inverts briefly on the beat | `count`, `interval` |
| `wipe` | Text revealed by a moving bar | `dir` |
| `split` | Top and bottom halves fly in from opposite sides | `size` |
| `bounce` | Words bounce on a baseline | `size`, `height` |
| `glitch` | Horizontal slice offsets + noise for a few frames | `intensity` |
| `rain` | Letters fall into place | `size` |
| `stack` | Words stacked vertically, emphasised word larger | `emphasis` (word index) |

Each effect is one small module on the device: `start(item)`,
`draw(t)` with `t` going from 0 to 1 over the item's duration, using
shared easing functions (ease-out-back for pops, ease-in for slams).

## C. Timeline format (`music/fx`)

```json
{
  "v": 1,
  "songId": 123456,
  "style": "energetic",
  "items": [
    {"t": 12340, "d": 3400, "fx": "word_pop", "size": 2, "words": [0, 420, 900, 1500]},
    {"t": 15740, "d": 2100, "fx": "slam", "text": "FIRE", "shake": 3},
    {"t": 17840, "d": 3000, "fx": "typewriter", "size": 1, "cps": 18},
    {"t": 20840, "d": 600,  "fx": "flash_invert", "count": 2, "interval": 150}
  ]
}
```

- `t` = start (ms in the song), `d` = duration, `fx` = effect, plus that effect's parameters.
- The text comes from the lyric line at `t` unless `text` overrides it (for
  emphasis words; `text` must be a word from that line, which the validator checks).
- A **JSON Schema** describes this exactly. It is used for Claude's
  structured output *and* for validation in the backend.

## D. Backend: timeline generation (`routes/songs.js` + `utils/claude.js`)

### D1. Flow
```
PUT /devices/:id/music (lyrics on)
  └─ timeline for (songId, promptVersion) in `timelines`?
       ├─ yes → publish music/fx immediately
       └─ no  → publish plain lines first (phase 3 look), start a job:
                  Claude API → validate → save → publish music/fx
                  (device switches to the animated version on its next line change)
```

### D2. The Claude call
- SDK: `@anthropic-ai/sdk` (JavaScript), model **`claude-opus-5-5`**,
  adaptive thinking, structured output with the timeline JSON Schema
  (`output_config.format`), and the server-side refusal fallback enabled.
- System prompt (versioned as `promptVersion`): the effect menu with
  each effect's look and limits, screen size and font sizes (how many
  characters fit per line at each size), and rules:
  - match energy to the lyrics: calmer effects on verses, big effects on the chorus/hook;
  - repeated lines (choruses) get consistent treatment;
  - no more than one `slam` or `flash_invert` per ~8 s (readability);
  - estimate word timings within each line (LRCLIB only gives line times) from syllables and line duration;
  - text must fit on the screen at the chosen size.
- User message: title, artist, duration, and the timed lines.
- One call per song; the result is cached forever in `timelines`.

### D3. Validation and fallback
1. Schema validation (`zod`, generated from the same JSON Schema).
2. Renderer checks: items sorted, no overlap, every lyric line covered,
   text fits at the chosen size, emphasis words exist in their line,
   durations ≥ 300 ms.
3. On failure: one retry with the error list added to the message, then
   a **rule-based default timeline** (`word_pop` for short lines,
   `typewriter` for long ones, `slam` on the most repeated short line).
   The device never receives an invalid timeline.

### D4. Cost and limits
- Estimate: lyrics + prompt ≈ 3–5K input tokens, timeline ≈ 2–4K output
  tokens → a few cents to ~$0.15 per new song at Opus 5.5 prices
  ($4 / $20 per million tokens). Real usage is measured and saved per
  timeline (`usage`).
- Limit: 20 new generations per device per day (users are reset nightly, devices are not) (env-configurable). Cached songs are free.
- The system prompt is identical for every call, so prompt caching cuts
  its cost after the first call.
- Needs `ANTHROPIC_API_KEY` (Render env var) on an account with billing.

### D5. Routes
- `POST /api/songs/:id/timeline` (`?force=1` regenerates) → `202 {status: "pending"}`.
- `GET /api/songs/:id/timeline` → `{status: pending/ready/failed/fallback, timeline}`.
- The phone also learns about completion from the retained `music/fx` topic.

## E. Firmware

- `modes/lyrics_fx.*`: an effect engine that plays `music/fx` against the
  song clock from phase 3.
- Unknown `fx` names → `center_hold` (newer timelines still play on older firmware).
- Shake and invert are applied as a whole-frame offset / the hardware
  invert command (`0xA7`), so they cost no extra drawing.
- Frame budget: drawing < 8 ms + I2C ~25 ms → 30 fps. Effects that would
  exceed it (`rain`, `glitch`) are limited to a few elements.

## F. Frontend

- **OLED preview** (`components/OledPreview.jsx`): a 128×64 canvas that
  plays the same timeline with a JavaScript port of the effect engine,
  next to the phone's transport controls. You can judge an animation
  without the board, and compare against the device.
- Song panel: status (generating / ready / fallback), **Regenerate**
  button, style hint (optional: "calm", "energetic", "dramatic"), passed to the prompt.

The effect engine is written twice (C++ on the device, JS in the browser).
To keep them matching, both are tested against the same **golden
frames**: a test fixture renders a timeline at fixed times in each and
compares the 1024-byte frame buffers.

## G. Tests

| Test | Pass condition |
|------|----------------|
| Variety | 3 songs of different genres produce clearly different timelines |
| Validity | 20 generated timelines pass schema + renderer checks without fallback (target ≥ 90 %) |
| Fallback | A forced invalid response → rule-based timeline, device unaffected |
| Cache | Re-selecting a song makes no Claude call |
| Performance | Every effect ≥ 25 fps on hardware |
| Parity | Device and browser golden frames match for every effect |
| Limits | 21st generation in a day → clear error, cached songs still work |

## H. Done when

- [ ] Selecting a song with lyrics on shows plain lyrics at once, then animated lyrics within seconds.
- [ ] Animations follow the song's energy and stay in sync.
- [ ] Browser preview matches the device.
- [ ] Cost per song is recorded and within the estimate.
