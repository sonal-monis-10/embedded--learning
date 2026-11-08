# Project plan: connected OLED (Robot Eyes + Music/Lyrics)

Status: **draft v2, waiting for confirmation**. Nothing here is built yet.

| Phase | Goal | File |
|-------|------|------|
| 1 | **Foundation**: repo split (`firmware/` `backend/` `frontend/`), self-registering devices, QR-on-the-OLED pairing (no accounts, one phone per device), Docker firmware build, secure MQTT connection, robot eyes over a tilt stream | [phase-1-foundation.md](phase-1-foundation.md) |
| 2 | **Robot Eyes**: phone gyroscope/accelerometer drives animated eyes in real time | [phase-2-robot-eyes.md](phase-2-robot-eyes.md) |
| 3 | **Music mode**: pick a song; spinning disc + progress bar, or synced lyrics | [phase-3-music.md](phase-3-music.md) |
| 4 | **AI lyric animations**: Claude designs a reels-style animation per song | [phase-4-ai-animations.md](phase-4-ai-animations.md) |

The earlier draft had 3 phases. Building pairing, device secrets and the
Docker build is a large piece of work on its own, so it is now a separate
phase 1. Each phase ends in something usable and testable.

This file holds everything shared between phases: decisions, architecture,
repo layout, security model, data model, topics and the full API list.
Phase files say which parts they build.

---

## 1. Decisions

### 1.1 MQTT or plain WebSockets?

**Answer: MQTT, carried over a WebSocket.** These are two layers, not
alternatives:

- **WebSocket** is the *pipe*: a long-lived, encrypted (`wss://`) two-way
  connection that works through Render's HTTPS-only proxy.
- **MQTT** is the *language* spoken inside the pipe: topics,
  publish/subscribe, delivery guarantees, presence.

Render forces us to use WebSockets as the pipe either way. The question is
whether we speak MQTT inside it or invent our own message format.

| Need in this project | MQTT gives you | Plain WebSocket: you would write |
|----------------------|----------------|----------------------------------|
| Route "mode" to device X, "imu" to device X, "status" to every open phone | Topics + subscriptions | A message router keyed by device and message type |
| New phone opens the page, needs the current mode/song immediately | **Retained messages**: broker hands over the last value on subscribe | A "last state" cache + send-on-connect logic |
| Know a device died without a clean goodbye | **Last Will (LWT)**: broker publishes `offline` for it | Heartbeats + timeout bookkeeping |
| Device reconnects after Wi-Fi drop | `esp-mqtt` reconnects, resubscribes, keep-alive pings built in | Reconnect + resubscribe + ping logic on the ESP32 |
| Per-device permissions | Broker-enforced topic ACLs (Mosquitto Dynamic Security) | Your own permission checks per message type |
| Debugging | Any MQTT tool (MQTT Explorer, `mqtt` CLI) can watch traffic | Custom tooling |
| Later: more consumers (logger, second phone, home automation) | Subscribe; nothing else changes | Change the router |

Plain WebSockets would win if there were exactly one sender and one
receiver with one message type. Here there are many devices, many phones,
mixed message types, and presence matters.

### 1.2 Broker: Mosquitto, managed by the backend

**Mosquitto** (C) runs in the same container as the backend. It is
official, mature and light on memory. At this project's load (a few
devices × 20 msg/s), delay is set by the internet round trip to Render
(~50–150 ms), not by the broker.

Per-device logins created at runtime come from Mosquitto's
**[Dynamic Security plugin](https://mosquitto.org/documentation/dynamic-security/)**
(ships with Mosquitto 2.x). An admin client sends JSON commands to
`$CONTROL/dynamic-security/v1` to create or delete MQTT users and their
permissions while the broker runs.

| Need | How |
|------|-----|
| New device registered | Backend sends `createClient` (username = device ID, password = device secret, role `device`) |
| Topic permissions | One `device` role for all devices, using `%u` (the connecting client's own username): publish `d/%u/status`, subscribe `d/%u/#`. Each user gets a role `user-<userId>` with ACLs for each device they own |
| Delete device / rotate secret | `deleteClient` (documented to disconnect the live connection), then `createClient` with the new secret when rotating |
| Phone/browser login to MQTT | Backend creates a short-lived MQTT client per web session (`s-<sessionId>`, random password, role `user-<userId>`); deleted on logout or revoke |
| Render free tier has no disk, so the plugin's config file is lost on restart | **MongoDB is the source of truth.** On startup the backend rebuilds all device logins with `createClient` commands (batched). The device secret is stored **encrypted** (AES-256-GCM, key in a Render env var), because the plugin's docs don't say it can load pre-hashed passwords |
| Retained messages lost on restart | Backend re-publishes each device's mode and song state from MongoDB once Mosquitto is up. Devices re-publish `status` when they reconnect |
| Presence (online/offline) | Backend's own MQTT client subscribes to `d/+/status` (retained + Last Will) |
| Failed logins | Backend starts Mosquitto as a child process with `log_dest stdout` and turns "not authorised" log lines into `device_events` |

Process layout inside the one container (Render **Docker** runtime):

```
node backend (PID 1, supervisor)
 1. connect MongoDB
 2. spawn mosquitto  ── listeners on 127.0.0.1 only:
                        9001 websockets (devices + browsers, via the pipe below)
                        1883 tcp        (backend's own admin/presence client)
 3. admin client → createClient/createRole for every device + user (from MongoDB)
 4. re-publish retained state (mode, music) from MongoDB
 5. listen on $PORT:   /api/*   → Express
                       /mqtt    → WebSocket upgrade piped byte-for-byte to 127.0.0.1:9001
 mosquitto exits → backend restarts it (and re-runs step 3); repeated failure → exit, Render restarts the container
```

Render exposes one public port, and it has to serve the REST API too.
That's why `/mqtt` passes through Node. The pipe only copies bytes and
does not parse MQTT. If measurements ever show it adds delay, nginx
can take its place.

### 1.3 Other decisions

| Topic | Decision | Why |
|-------|----------|-----|
| Backend language | **JavaScript** (Node.js 24 LTS, ES modules), Express 5 | Your choice; same language as the frontend |
| Frontend | **Vite + React (JavaScript)** in `frontend/`, hosted as a **Render Static Site** | Your choice; static sites are free and don't use instance hours |
| Database | **MongoDB Atlas free tier (M0, 512 MB)**, `mongoose`, one schema file per entity in `backend/entity/`, `zod` for request validation | Your existing DB; schemas document each collection in one place |
| Device credentials | **The device registers itself** on first boot: the firmware calls `POST /api/admin/devices` with a `PROVISION_KEY` built into it, gets back its ID and secret, and keeps them in flash (NVS). Secret stored encrypted on the server | Flash and go; no manual registration step. See §4.2 |
| Wi-Fi credentials | In the firmware build env (`firmware.env`), not on the server | The device needs Wi-Fi before it can reach the server at all |
| Phone sign-in | **No email or password.** The OLED shows its device ID and a one-time **pairing QR + code** sent by the server; a phone scans it, enters a name, and becomes that device's **only controller** until it leaves, goes idle 10 min, or midnight | Nothing to sign up for; one person plays at a time. See §4.4 |
| Who can add devices | Any firmware holding the **`PROVISION_KEY`** (registration only: rate-limited, capped, replaceable). Maintenance routes (delete, rotate, cleanup) need the separate **`ADMIN_KEY`**. There is **no admin web page** | Self-registration without opening device control to anyone |
| Firmware build | **Docker** image runs PlatformIO and outputs ready-to-flash binaries for SH1106 and SSD1306 boards | Repeatable builds, no local toolchain needed, secret passed as a build secret |
| Lyrics source | [LRCLIB](https://lrclib.net) (free, timed lyrics) | Spotify has no lyrics API and needs Premium for new apps (Feb 2026) |
| AI | Claude API (`claude-opus-5-5`), phase 4 only | Generates animation timelines |

---

## 2. Architecture

```
 ┌──────────────────────────────┐     ┌────────────────────────────────────────────────┐     ┌────────────────────────┐
 │ Render Static Site           │     │ Render Web Service (free, Docker): backend/    │     │ ESP32 + OLED           │
 │ frontend/ (Vite React)       │     │                                                │     │ firmware/ (Docker-built)│
 │                              │     │  Node (Express 5) on $PORT                     │     │                        │
 │ Pair (scan QR on the OLED)   │─────┼─► /api/*    REST (JSON, session token)         │◄────┤ first boot: provision  │
 │ My device: mode, eyes        │HTTPS│   /healthz                                     │HTTPS│  (PROVISION_KEY)       │
 │   (tilt), leave              │     │                                                │     │                        │
 │ Tilt stream + live status    │─────┼─► /api/live  WebSocket (motion up, status down)│     │ esp-mqtt over wss      │
 │                              │ wss │        │ forwards to                           │     │  user = deviceId       │
 └──────────────────────────────┘     │        ▼                                       │     │  pass = deviceSecret   │
                                      │   /mqtt byte pipe ──► Mosquitto 127.0.0.1:9001◄┼─wss─┤ draws: ID + QR + code  │
                                      │                        Dynamic Security        │     │  when free; eyes /     │
                                      │   admin client ───────► $CONTROL (device logins)│    │  music when playing    │
                                      │   backend client ─────► d/+/status, publish    │     └────────────────────────┘
                                      │                         pairing, mode, imu     │
                                      └────────────┼───────────────────────────────────┘
                                                   ▼
                                      MongoDB Atlas M0 (source of truth): devices, users,
                                      sessions, pairing codes, events, songs, playback
```

How the traffic is split:
- **REST** for anything that changes stored state: device provisioning,
  pairing, mode changes, leaving, song selection. The backend saves it,
  then publishes to the device over MQTT.
- **One WebSocket per phone** (`/api/live`, authenticated with the session
  token) for tilt readings going up (~20 a second) and the device's live
  status coming down. The backend forwards readings to `d/<id>/imu`.
  Phones never speak MQTT, so they need no broker logins.
- **MQTT on the device** for everything: it subscribes to its own topics
  and publishes its own status.

Render free-tier notes:
- The service sleeps after 15 min without incoming HTTP or WebSocket
  messages. Any powered device's 30 s MQTT keep-alive keeps it awake.
- Render free has **no fixed outgoing IP**, so the Atlas network access list
  must allow `0.0.0.0/0`. Protection then rests on a strong DB user password
  and TLS (Atlas enforces TLS).
- `*.onrender.com` is on the Public Suffix List, so the frontend and backend
  count as **different sites**. Safari blocks cross-site cookies, so auth
  uses **Bearer tokens**, not cookies. A shared custom domain later would
  allow httpOnly cookies.

---

## 3. Repository layout (after phase 1)

```
esp32-oled/
├── firmware/                  ← the current PlatformIO project, moved here
│   ├── platformio.ini         envs: hw_sh1106, hw_ssd1306, scanner
│   ├── src/                   main.cpp, net/, modes/, display/, app/
│   ├── include/
│   ├── scripts/gen_config.py  PlatformIO pre-script: env vars → generated config header
│   ├── tools/i2c_bus_scanner.cpp
│   ├── diagram.json           wiring diagram
│   ├── Dockerfile             PlatformIO build image → exports binaries
│   └── Makefile               local (non-Docker) shortcuts, as today
├── backend/
│   ├── package.json           "type": "module"
│   ├── .env               local only, git-ignored (variables: §8)
│   ├── Dockerfile             node:24-alpine + mosquitto (Alpine package, pinned)
│   ├── mosquitto/             mosquitto.conf (localhost listeners, dynsec plugin, limits)
│   ├── server.js              entry point: config → createApp() → listen, graceful shutdown
│   ├── app.js                 MongoDB connection, middleware (helmet, CORS, auth), every
│   │                          router mounted at its path, error handlers
│   ├── routes/                one file per area, each exports an Express Router with its
│   │                          business logic: health.js, admin.js, pairing.js, devices.js, music.js, songs.js
│   ├── entity/                Mongoose schemas: device.js, user.js (+ session, song, playback,
│   │                          timeline as phases need them)
│   ├── middleware/            errors.js, auth.js (session token → req.user), rateLimit.js
│   ├── mqtt/                  supervisor.js (spawn/restart + log parsing), dynsec.js (admin
│   │                          commands), sync.js (MongoDB → dynsec), proxy.js (/mqtt pipe),
│   │                          presence.js, publisher.js, topics.js
│   ├── utils/                 config.js (env → `config`), logger.js, secrets.js (seal/unseal, tokens), time.js, cleanup.js,
│   │                          lrclib.js, claude.js
│   ├── scripts/               mqtt-smoke.js
│   └── test/                  node:test + supertest + in-memory MongoDB (test/support/)
├── frontend/
│   ├── package.json
│   ├── .env                   local only, git-ignored: VITE_API_URL, VITE_MQTT_URL
│   ├── index.html
│   └── src/
│       ├── main.jsx, App.jsx  router
│       ├── services/          client.js (fetch + token refresh), one module per API area
│       ├── mqtt/              useMqtt.js (MQTT.js hook)
│       ├── sensors/           useOrientation.js (phase 2)
│       ├── pages/             Login, Pair, Devices, DeviceNew, DeviceDetail, Settings
│       └── components/        DeviceCard, StatusDot, OledPreview (canvas 128×64), …
├── firmware/firmware.env      git-ignored: PROVISION_KEY, API/broker URLs, Wi-Fi for the build
├── out/                       git-ignored: firmware build outputs per device
├── docs/
├── docker-compose.yml         local dev: backend + frontend (+ optional local Mongo)
├── render.yaml                Render Blueprint: backend web service + frontend static site
└── Makefile                   root shortcuts: make firmware / flash / sim / dev
```

---

## 4. Security model and device lifecycle

### 4.1 Secrets at a glance

| Secret | Created by | Lives in | Stored on server as |
|--------|-----------|----------|---------------------|
| `PROVISION_KEY` | You / Render | Render env var; **every firmware build** (`firmware.env`) | Not stored (compared with `timingSafeEqual`) |
| `ADMIN_KEY` | You / Render | Render env var; your shell when you curl maintenance routes | Not stored |
| **Device secret** | Backend, when the device provisions itself | The device's flash (NVS); Mosquitto's in-memory user list | **Encrypted** (AES-256-GCM) |
| Wi-Fi password | You | `firmware.env` → firmware | Not on the server |
| Pairing code | Backend, whenever a device is free | Sent to the device over MQTT, drawn on the OLED as QR + text; 2 min, single use | SHA-256 hash, TTL index |
| Session token | Backend, when a phone pairs | Phone's localStorage; expires at the next 00:00 IST | SHA-256 hash, TTL index, deleted nightly |
| `SECRETS_KEY` (32 bytes) | You / Render | Render env var only, **never in MongoDB** | — |
| `MONGODB_URI`, `MQTT_ADMIN_PASSWORD`, `MQTT_BACKEND_PASSWORD`, `ANTHROPIC_API_KEY` | You / Render | Render env vars only | — |

Session tokens are random 32-byte values looked up in MongoDB on each
request, not JWTs. With a few phones and a nightly reset this costs
nothing, and revoking a session takes effect immediately.

Why the device secret is encrypted rather than hashed: after every
restart the backend has to give Mosquitto each device's password again,
so it needs a reversible form. The key lives only in the Render env.

**The `PROVISION_KEY` trade-off.** It ships inside every firmware binary,
so anyone who extracts it can register devices. It can do nothing else:
it cannot control, pair with, or read any device. Limits: registration
is rate-limited (5/min/IP), capped (`MAX_DEVICES`, default 20), and the
key can be replaced in Render at any time (already-registered devices
keep working; only new builds need the new key).

### 4.2 Device lifecycle

```
 1. BUILD         firmware.env (git-ignored):
                    PROVISION_KEY=…   API_URL=https://<backend>.onrender.com
                    BROKER_URL=wss://<backend>.onrender.com/mqtt
                    WIFI_SSID=…  WIFI_PASS=…
                  make firmware TARGET=hw         (Docker, see phase 1 §B)
                  → out/<target>/firmware-merged.bin, firmware.elf, manifest.json
 2. FLASH / RUN   make flash PORT=/dev/ttyUSB0
 3. PROVISION     first boot, no credentials in flash:
                    POST /api/admin/devices  X-Provision-Key: …  {kind, display, fw}
                    → {deviceId: "oled-7k2m9q", secret}  → saved in NVS
                  backend: device stored, Mosquitto login created
                  OLED meanwhile: "Setting up…"
 4. CONNECT       device → MQTT (user=oled-7k2m9q, pass=secret) → status "online"
 5. FREE          backend sees an online device with no controller → issues a pairing
                  code → retained d/<id>/pairing {code, url, expiresAt}
                  OLED: device ID, QR of the url, and the code in text
                  a fresh code is sent every 2 min while the device stays free
 6. PAIR          phone scans the QR (or types the code) → "Your name?" →
                  POST /api/pair → the phone controls this device (see §4.4);
                  backend clears d/<id>/pairing → OLED shows the current mode (eyes)
 7. PLAY          mode changes over REST; tilt over /api/live → d/<id>/imu → eyes move
 8. RELEASE       Leave tap, 10 min without tilt or mode change, or midnight
                  → controller removed → back to step 5 (new code on the OLED)
 9. RE-PROVISION  NVS erased, or secret rotated with ADMIN_KEY → step 3 again
10. REMOVE        DELETE /api/admin/devices/:id (ADMIN_KEY) → login gone, connection dropped
```

### 4.3 MQTT authentication and permissions

Mosquitto Dynamic Security clients (phones are not among them):

| Client | MQTT username | MQTT password | Role |
|--------|---------------|---------------|------|
| Device | its `deviceId` | its device secret | `device` |
| Backend admin | `admin` | `MQTT_ADMIN_PASSWORD` | dynsec admin (only reachable on 127.0.0.1:1883) |
| Backend | `backend` | `MQTT_BACKEND_PASSWORD` | `backend` |

`allow_anonymous false`. Topic permissions (`d/<deviceId>/…`):

| Topic | Role `device` (own ID via `%u`) | Role `backend` |
|-------|----------------------|---------|
| `status` | publish (+ LWT) | subscribe |
| `pairing`, `mode`, `cmd`, `imu`, `music/*` | subscribe | publish |
| anything else / other device IDs | denied | — |

### 4.4 Pairing a phone (QR on the OLED, no login)

The phone gets **its own session**, never the device's secret, so it can
only *control* the device, never pretend to *be* it.

**Rules:**
- A device has **at most one controller**. A phone controls **at most one
  device**: pairing a second device releases the first.
- A device is **free** when it is online and has no controller. Only free
  devices get pairing codes, so a QR is never on screen while someone plays.
- Codes are single-use, live 2 minutes, and are replaced on the OLED as
  they expire.

**Flow:**
1. Backend issues a code for a free device and publishes retained
   `d/<id>/pairing` `{code, url, expiresAt}`; `url` is
   `https://<frontend>/pair/<code>`. The device draws its ID, the QR and
   the code.
2. The phone camera opens the URL (or the visitor types the code at
   `/pair`). The page asks **"Your name?"** (1–40 characters).
3. `POST /api/pair {code, name}` → the code is redeemed atomically → user
   and session created (or the phone's existing ones reused) → the phone's
   previous device, if any, is released → this device's controller is set
   → `d/<id>/pairing` cleared → `{sessionToken, user, device}`.
4. The phone opens `/api/live` and lands on the control page.

**Release** (the device becomes free, step 1 again):
- `POST /api/devices/:id/leave` (the Leave button).
- **Idle 10 minutes**: no tilt readings and no mode change (`IDLE_RELEASE_MIN`).
  Checked every minute; the phone sees "Your turn ended".
- The nightly cleanup at 00:00 IST.
- The device going offline does **not** release it, so a Wi-Fi blip does
  not end someone's turn; the idle timer still applies.

**Nightly cleanup (00:00 Asia/Kolkata):**
- Deletes `users`, `sessions`, `pairing_codes`, `device_events`,
  `playback`; resets every device's `controller`, `name` and `mode`.
- Device logins and secrets are **not** touched; every online device gets
  a fresh pairing code.
- The free Render instance may be asleep at midnight, so the date of the
  last cleanup is stored and the backend catches up on wake. Sessions
  also expire at midnight, so an old token is rejected either way.

### 4.5 Other protections

- `POST /api/admin/devices` takes `X-Provision-Key` (registration only); every other admin route takes `X-Admin-Key`.
- Rate limits: pairing (10/min/IP), provisioning (5/min/IP), admin key failures (5/min/IP), search, AI generation.
- `/api/live` checks the session token on connect and that the phone controls the device; readings above 30/s are dropped.
- `helmet` headers, CORS only for the frontend origin, request body size
  limit. Mosquitto `max_packet_size` 16 KB; both Mosquitto listeners bound
  to `127.0.0.1`, so the only way in from outside is the `/mqtt` pipe.
- Production firmware **refuses `ws://`**: the build fails unless the URL is
  `wss://`. `ws://` is allowed only with `DEV_INSECURE=1` for a local backend.
- ESP32 verifies the server certificate with the built-in CA bundle
  (`esp_crt_bundle_attach`).
- Firmware binaries contain the `PROVISION_KEY` and Wi-Fi password. Treat
  `out/` like the `.env` files: git-ignored, never uploaded.

---

## 5. Data model (MongoDB)

Mongoose schemas live in `backend/entity/`. **Kept** = survives the
nightly cleanup.

| Collection (entity) | Fields (main) | Indexes | Kept? | Phase |
|---------------------|---------------|---------|-------|-------|
| `devices` (`device.js`) | `_id (deviceId), kind, display, secret (enc), secretVersion, createdAt` | — | **yes** | 1 |
| ↳ same documents | `name, controller {user, since, lastActiveAt} or null, mode` | `controller.user` unique (sparse) | reset nightly | 1 |
| ↳ same documents | `online, lastSeenAt, fw {version, gitSha, builtAt}, net {rssi, ip}` (live status, refreshed by the device) | — | yes | 1 |
| `users` (`user.js`) | `_id, name, createdAt, lastSeenAt` (no email, no password) | — | no | 1 |
| `sessions` (`session.js`) | `_id, user, tokenHash, userAgent, createdAt, lastUsedAt, expiresAt` | `tokenHash` unique, TTL `expiresAt` | no | 1 |
| `pairing_codes` (`pairingCode.js`) | `codeHash, device, expiresAt, usedAt` | `codeHash` unique, TTL `expiresAt` | no | 1 |
| `device_events` (`deviceEvent.js`) | `device, type (provisioned/connect/disconnect/auth_fail/rotate/paired/released), at, meta` | `device+at` | no | 1 |
| `meta` | `_id: "cleanup", lastRunDate (IST, YYYY-MM-DD)` | — | yes | 1 |
| `songs` (`song.js`) | `_id (lrclibId), title, artist, album, durationMs, lines [[ms,text]], plainLyrics, fetchedAt` | text index on `title, artist` | yes (cache) | 3 |
| `playback` (`playback.js`) | `_id (deviceId), song, lyrics (bool), positionMs, playing, updatedAt` | — | no | 3 |
| `timelines` (`timeline.js`) | `song, promptVersion, model, fx, usage {in,out}, createdAt, status` | `song+promptVersion` unique | yes (cache) | 4 |

The unique sparse index on `controller.user` enforces "a phone controls at
most one device" in the database itself. `(enc)` fields hold `{iv, tag,
data}` from AES-256-GCM with `SECRETS_KEY`, are `select: false`, and never
appear in API responses. Mosquitto keeps no state of its own that matters:
device logins come from `devices`, and retained messages are re-published
from MongoDB. The nightly cleanup and caches keep the database well under
the 512 MB free-tier limit.

---

## 6. MQTT topic map

Prefix `d/<deviceId>/`. Payloads are compact JSON.

| Topic | From → to | Retained | QoS | Payload | Phase |
|-------|-----------|----------|-----|---------|-------|
| `status` | device → backend (→ phone over `/api/live`) | yes | 1 | `{"online":true,"fw":"0.1.0","sha":"a1b2c3","rssi":-58,"heap":182000,"mode":"eyes"}`; LWT `{"online":false}` | 1 |
| `pairing` | backend → device | yes | 1 | free: `{"code":"K3F9QXW2","url":"https://…/pair/K3F9QXW2","expiresAt":…}`; taken: empty retained message (clears it) | 1 |
| `cmd` | backend → device | no | 1 | `{"op":"identify"}` / `{"op":"reboot"}` / `{"op":"brightness","v":128}` | 1 |
| `mode` | backend → device | yes | 1 | `{"mode":"idle"}` / `eyes` / `music` | 1 |
| `imu` | backend → device (forwarded from the phone's `/api/live`) | no | 0 | `[pitch, roll, accelG, seq]` e.g. `[-12.3,4.1,1.02,881]` | 1 |
| `music/track` | backend → device | yes | 1 | `{"id":123,"title":"…","artist":"…","dur":215000,"lyrics":true}` | 3 |
| `music/lines` | backend → device | yes | 1 | `[[12340,"First line"],[15800,"Second"]]` | 3 |
| `music/sync` | backend → device | no | 0 | `{"pos":53210,"playing":true,"at":1730000000000}` | 3 |
| `music/fx` | backend → device | yes | 1 | animation timeline (phase 4) | 4 |

---

## 7. REST API (all phases)

Base: `https://<backend>.onrender.com/api`. JSON.
- `🔒` = needs `Authorization: Bearer <session token>` (a paired phone).
  Device routes check that the caller controls the device (otherwise
  `404`, so others can't even confirm a device ID exists).
- `🔑` = needs `X-Provision-Key: <PROVISION_KEY>` (firmware only).
- `🛠` = needs `X-Admin-Key: <ADMIN_KEY>` (maintenance with curl; no web page).

| Method & path | Purpose | Phase |
|---------------|---------|-------|
| `GET /healthz` | Liveness + DB check (no `/api` prefix) | 1 |
| **Provisioning and maintenance** | | |
| `POST /api/admin/devices` 🔑 | first boot: `{kind, display, fw}` → `{deviceId, secret, brokerUrl}` | 1 |
| `GET /api/admin/devices` 🛠 | all devices with online / last seen / fw / controller | 1 |
| `GET /api/admin/devices/:id` 🛠 | one device and its last 50 events | 1 |
| `DELETE /api/admin/devices/:id` 🛠 | remove + disconnect | 1 |
| `POST /api/admin/devices/:id/rotate-secret` 🛠 | invalidates the secret; the device re-provisions on its next boot | 1 |
| `POST /api/admin/devices/:id/release` 🛠 | free a device by hand | 1 |
| `POST /api/admin/cleanup` 🛠 | run the nightly cleanup now (testing) | 1 |
| **Pairing and session** | | |
| `POST /api/pair` | `{code, name}` → `{sessionToken, user, device}`; releases the phone's previous device | 1 |
| `GET /api/me` 🔒 | current user + the device they control (or none) | 1 |
| `PATCH /api/me` 🔒 | change name | 1 |
| `POST /api/logout` 🔒 | end this session (also releases the device) | 1 |
| `GET /api/live` 🔒 (WebSocket, token in the first message) | phone → server: `{"t":"imu","v":[pitch,roll,accelG,seq]}`; server → phone: `{"t":"status",…}`, `{"t":"released","reason":"idle"}` | 1 |
| **Device (the phone's one device)** | | |
| `GET /api/devices/:id` 🔒 | details for the controlling phone | 1 |
| `PATCH /api/devices/:id` 🔒 | rename (e.g. "Sonal's desk") | 1 |
| `PUT /api/devices/:id/mode` 🔒 | `{mode}` → saved + published | 1 |
| `POST /api/devices/:id/leave` 🔒 | end your turn; the OLED shows a new QR | 1 |
| `POST /api/devices/:id/commands` 🔒 | `{op, …}` → `cmd` topic (identify, reboot, brightness) | 1 |
| `GET /api/music/search?q=` 🔒 | LRCLIB search (cached) | 3 |
| `PUT /api/devices/:id/music` 🔒 | `{songId, lyrics}` → select song | 3 |
| `POST /api/devices/:id/music/control` 🔒 | `{op: play/pause/seek/nudge, value}` | 3 |
| `GET /api/devices/:id/music` 🔒 | current playback state | 3 |
| `POST /api/songs/:id/timeline` 🔒 | generate (or `?force=1` regenerate) an AI timeline → `202` | 4 |
| `GET /api/songs/:id/timeline` 🔒 | status + timeline | 4 |

Errors share one shape:
`{"error": {"code": "device_not_found", "message": "…"}}` with proper
HTTP status codes.

---

## 8. Environments and configuration

| Variable | Where | Example |
|----------|-------|---------|
| `MONGODB_URI` | backend (Render env) | `mongodb+srv://…/oled` |
| `MONGODB_DB` | backend | `oled` (default) |
| `PROVISION_KEY` | backend + every firmware build | random string ≥ 24 characters; only registers devices |
| `ADMIN_KEY` | backend | random string ≥ 24 characters; maintenance routes with curl |
| `MAX_DEVICES` | backend | `20` (default); provisioning refuses beyond this |
| `IDLE_RELEASE_MIN` | backend | `10` (default); minutes without tilt or mode change before a turn ends |
| `CLEANUP_TZ` | backend | `Asia/Kolkata` (default); the nightly cleanup runs at 00:00 in this zone |
| `SECRETS_KEY` | backend | 32 random bytes, base64 (set once and back it up: losing it means re-registering every device) |
| `MQTT_ADMIN_PASSWORD`, `MQTT_BACKEND_PASSWORD` | backend | generated by Render |
| `CORS_ORIGIN` | backend | `https://oled-frontend.onrender.com` |
| `PUBLIC_MQTT_URL` | backend | `wss://oled-backend.onrender.com/mqtt` (returned to devices when they provision) |
| `LRCLIB_USER_AGENT` | backend | `esp32-oled/0.1 (+github url)` (LRCLIB asks clients to identify themselves) |
| `ANTHROPIC_API_KEY` | backend | phase 4 |
| `VITE_API_URL` | frontend (build time) | backend URL; `/api/live` is derived from it |
| `PROVISION_KEY`, `API_URL`, `BROKER_URL`, `WIFI_SSID`, `WIFI_PASS` | `firmware/firmware.env` (git-ignored) → firmware build | you; the device ID and secret come from provisioning, not the build |

**Local development** (`make dev` → `docker-compose`): backend on
`:8080`, frontend on `:5173`, MongoDB either a local container or an Atlas
"dev" database. iOS only gives motion sensors to HTTPS pages, so phone
sensor testing uses the deployed Render site, or Vite with a
self-signed certificate.

**Deploy:** `render.yaml` Blueprint, connected to the GitHub repo. Push to
`main` → Render rebuilds both. The static site gets a rewrite rule
`/* → /index.html` so React routes work on reload.

**CI (GitHub Actions):** backend tests, frontend build, firmware Docker
build for all envs with a dummy `firmware.env`.

---

## 9. Out of scope (possible later)

- Auto-detect the playing song (Spotify with Premium, or Last.fm "now playing").
- Wi-Fi setup without rebuilding (captive-portal provisioning).
- Over-the-air firmware updates.
- Flashing from the browser (ESP Web Tools / esptool-js).
- Several phones on one device (turns, spectators).
- An admin web page (maintenance stays on curl for now).
- Mutual TLS (needs a host with raw TCP).
- Non-Latin lyrics fonts.

## 10. Decisions log

| Date | Decision |
|------|----------|
| 2026-11-01 | MQTT over WebSockets (not a custom WebSocket protocol) |
| 2026-11-01 | **Mosquitto** with the Dynamic Security plugin, run inside the backend container (Aedes considered and rejected) |
| 2026-11-01 | ~~Phones link with a one-time pairing QR on a web page~~ (superseded below) |
| 2026-11-01 | ~~Wi-Fi entered in the Add device form~~ (superseded: Wi-Fi lives in `firmware.env`) |
| 2026-11-01 | Backend layout: `server.js`, `app.js` (MongoDB + middleware + route paths), `routes/` (logic), `entity/` (Mongoose schemas), no `src/` |
| 2026-11-01 | **No email/password accounts.** Phones pair by QR and give a name; users, sessions and pairings are wiped nightly at 00:00 IST. Device logins are kept |
| 2026-11-01 | ~~Pairing QR shown on a web page~~ (superseded below) |
| 2026-11-01 | ~~Device registration guarded by an `ADMIN_KEY` on an Add device page~~ (superseded below) |
| 2026-11-01 | No `.env*` files committed, not even `.env.example` |
| 2026-11-01 | **Superseded the three pairing rows above:** the **OLED shows its ID + QR + code**, sent by the server over MQTT when the device is free. **One phone ↔ one device**, no members, no admin page |
| 2026-11-01 | Devices **self-register** on first boot with a `PROVISION_KEY` in the firmware (registration only, rate-limited, capped); `ADMIN_KEY` kept for curl maintenance |
| 2026-11-01 | A turn ends on **Leave, 10 min idle, or midnight**; the OLED then shows a fresh QR |
| 2026-11-01 | Phones send tilt over a **WebSocket** (`/api/live`); the backend forwards it to MQTT. Phones never get broker logins |
| 2026-11-01 | Device IDs `oled-` + 6 random characters, shown on the OLED while free (user: OK) |
| 2026-11-01 | Basic tilt-to-eyes is part of phase 1; blinks, moods and calibration stay in phase 2 (user: OK) |

## 11. Open questions

None right now.
