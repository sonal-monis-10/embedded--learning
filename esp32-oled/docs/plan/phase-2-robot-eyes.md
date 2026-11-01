# Phase 2: Robot Eyes

**Goal:** open a device on the phone, choose **Eyes**, tap **Start
sensors**. Tilting the phone moves a pair of robot eyes on the OLED
smoothly in real time, and the eyes react to shakes, flips and inactivity.

Needs phase 1 (QR pairing, devices, secure MQTT). Shared design: [README.md](README.md).

---

## A. Data flow

```
Phone sensors ──► frontend: useOrientation()           ──MQTT QoS0──► Mosquitto ──► ESP32 eyes mode
 DeviceOrientation   pitch = beta, roll = gamma           d/<id>/imu    (ACL:      low-pass filter
 DeviceMotion        accelG = |a| / 9.81                  ~20 Hz        owner      → eye targets
                     calibration offset subtracted        only on change  only)    → render 30 fps
```

- **Topic:** `d/<id>/imu`, QoS 0, not retained, not stored. Losing an
  occasional packet is harmless; the next one arrives 50 ms later.
- **Payload:** `[pitch, roll, accelG, seq]`, e.g. `[-12.3,4.1,1.02,881]`,
  about 25 bytes. `seq` lets the device drop out-of-order packets.
- **Rate:** sampled at 60 Hz, sent at most 20 Hz, and only if the value
  changed by more than 0.5° (or once per second as a heartbeat).
- **Mode switch:** `PUT /api/devices/:id/mode {"mode":"eyes"}` (saved +
  retained `mode` topic). Opening the Eyes tab sets it automatically.

## B. Frontend

### B1. `sensors/useOrientation.js`
- iOS: `DeviceOrientationEvent.requestPermission()` and
  `DeviceMotionEvent.requestPermission()` must be called from a **tap**
  ("Start sensors" button). Android: no prompt. Both require HTTPS.
- Reads `beta` (front/back tilt → pitch) and `gamma` (left/right tilt → roll).
  These are relative to gravity, so no drift.
- **Calibrate** button: stores the current pose as neutral, so "looking
  straight" can be any comfortable phone angle.
- Handles screen rotation (`screen.orientation.angle`) by swapping/negating axes.
- Stops sending when the tab is hidden (`visibilitychange`) and shows
  "paused". Optionally keeps the screen awake (`navigator.wakeLock`) while
  streaming.

### B2. Eyes control page (`/devices/:id`, Eyes tab)
- Start/stop sensors, Calibrate, sensitivity slider (how far the eyes move per degree).
- Live readout: pitch, roll, send rate, round-trip indicator.
- **Expression buttons**, sent as `cmd`: `happy`, `angry`, `sad`,
  `surprised`, `sleepy`, `wink`. They override the mood for 3 s.
- Mini preview: an `OledPreview` canvas (128×64) drawing the same eye
  model from the same numbers. This is a first use of the shared preview
  component that phase 4 needs.
- Joystick fallback (drag on screen) for desktops without motion sensors.

### B3. Multiple controllers
Two phones streaming to one device would fight. The device follows the
most recent sender (each phone's MQTT client ID is in the payload). The
page shows "controlled by another session" when its own packets are
being ignored.

## C. Backend

Almost nothing new. Already covered by phase 1:
- ACL: users may publish `d/<id>/imu` only for devices they are a member of; payload ≤ 64 bytes.
- `PUT /mode` accepts `eyes`.
- `POST /commands` accepts expression ops (`zod` enum).
- Flood protection: Mosquitto has no per-client message rate limit, so
  the frontend caps itself at 20 Hz and the device processes only the
  newest `imu` per frame (extras are dropped from its queue). If abuse ever
  matters, the `/mqtt` pipe in the backend can count frames per
  connection and close floods.

## D. Firmware: eyes mode (`modes/eyes.*`)

### D1. Eye model
Each eye is a rounded rectangle (`fillRoundRect`) with parameters animated
every frame:

| Parameter | Driven by |
|-----------|-----------|
| Eye x/y offset ("look direction") | roll → x, pitch → y, clamped to ±20 px / ±10 px |
| Eye height (lids) | blinks, mood (sleepy = half closed) |
| Top lid angle | mood (angry = slanted inward, sad = slanted outward) |
| Eye size | surprised = larger |
| Gap between eyes | constant; slight convergence when looking down |

Values move toward their targets with easing (`x += (target − x) * k`,
with `k` scaled by frame time). That gives organic motion even with
uneven network timing.

### D2. Behaviours

| Trigger | Reaction |
|---------|----------|
| Normal tilt | Eyes follow, with smoothing |
| Random 2–6 s | Blink (closed ~120 ms); sometimes a double blink |
| Shake (accelG > 2.2 for < 300 ms) | "Dizzy" spiral eyes / wobble for 2 s |
| Phone face-down (pitch near ±180°) | Eyes close slowly → sleep "Zzz" |
| No `imu` for 2 s | Idle: random saccades (quick looks around), occasional blink |
| No `imu` for 60 s | Sleepy, then sleep screen |
| `cmd` expression | Mood override for 3 s |
| Extreme tilt | Squint (lids partly closed) |

### D3. Performance
- Frame loop at 30 fps with a fixed time step. The latest `imu` value is
  read from the queue at the start of each frame (older ones are dropped).
- I2C clock fix from phase 1 (400 kHz throughout) → ~25 ms per full frame.
  If that is too slow, only the rows containing the eyes are sent (the
  library's dirty window already does this when the eyes don't fill the
  screen).
- Measured on screen in a debug build: fps, `imu` packets/s, end-to-end
  latency estimate (phone timestamp vs. arrival, after clock offset).

### D4. Wokwi
The simulator receives `imu` from your phone exactly like hardware, since
it is just another registered device. This allows developing the eye
animations without the board.

## E. Tests

| Test | Pass condition |
|------|----------------|
| Latency | Phone tilt → eye movement: median < 300 ms over Render (measured with the debug overlay) |
| Smoothness | ≥ 28 fps sustained in eyes mode; no visible jitter when the phone is held still |
| iOS + Android | Permission flow works on Safari iOS and Chrome Android |
| Loss | 30 % random packet drop (test flag) still looks smooth |
| Security | Publishing `imu` to a device you are not a member of is rejected; payload > 64 bytes rejected |
| Idle | Closing the page → idle look-around within 2 s, sleep after 60 s |
| Simulator | Same behaviour in Wokwi (lower fps acceptable) |

## F. Done when

- [ ] Tilting the phone moves the eyes with no noticeable lag, on hardware and Wokwi.
- [ ] Blink, shake, face-down, idle and expression behaviours all work.
- [ ] Calibrate makes any holding angle "neutral".
- [ ] Works on iPhone Safari and Android Chrome.
- [ ] A second phone can take over control cleanly.
