# Project plan: connected OLED (Robot Eyes + Music/Lyrics)

Status: **draft v2, waiting for confirmation**. Nothing here is built yet.

| Phase | Goal | File |
|-------|------|------|
| 1 | **Foundation**: repo split (`firmware/` `backend/` `frontend/`), accounts, device registry in MongoDB, per-device secrets, Docker firmware build (hardware + Wokwi), secure MQTT connection, device dashboard | [phase-1-foundation.md](phase-1-foundation.md) |
| 2 | **Robot Eyes**: phone gyroscope/accelerometer drives animated eyes in real time | [phase-2-robot-eyes.md](phase-2-robot-eyes.md) |
| 3 | **Music mode**: pick a song; spinning disc + progress bar, or synced lyrics | [phase-3-music.md](phase-3-music.md) |
| 4 | **AI lyric animations**: Claude designs a reels-style animation per song | [phase-4-ai-animations.md](phase-4-ai-animations.md) |

The earlier draft had 3 phases. Building accounts, device secrets and the
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
| Database | **MongoDB Atlas free tier (M0, 512 MB)**, official `mongodb` driver + `zod` validation | Your existing DB; a thin driver keeps queries visible |
| Device credentials | A random secret per device, created by the backend when you add the device, stored encrypted, delivered to the firmware build in an env file | Every device is known to the server before it exists, so nothing goes missing. See §4 |
| Wi-Fi credentials | Entered in the **Add device** form (editable later), stored encrypted, included in the device's env file | One form gives you everything the build needs |
| Phone sign-in | User account (email + password). A phone links to the account by scanning a **one-time pairing QR** (or typing its code) shown on the dashboard | "Copy to phone" without ever copying a device secret. See §4.4 |
| Firmware build | **Docker** image runs PlatformIO and outputs ready-to-flash binaries for hardware (SH1106) and **Wokwi** (SSD1306) | Repeatable builds, no local toolchain needed, secret passed as a build secret |
| Lyrics source | [LRCLIB](https://lrclib.net) (free, timed lyrics) | Spotify has no lyrics API and needs Premium for new apps (Feb 2026) |
| AI | Claude API (`claude-opus-5-5`), phase 4 only | Generates animation timelines |

---

## 2. Architecture

```
 ┌──────────────────────────────┐     ┌────────────────────────────────────────────────┐     ┌────────────────────────┐
 │ Render Static Site           │     │ Render Web Service (free, Docker): backend/    │     │ ESP32 + OLED           │
 │ frontend/ (Vite React)       │     │                                                │     │ firmware/ (Docker-built)│
 │                              │     │  Node (Express 5) on $PORT                     │     │                        │
 │ Login / QR pairing           │─────┼─► /api/*   REST (JSON, Bearer JWT)             │     │ Wi-Fi                  │
 │ Device dashboard             │HTTPS│   /healthz                                     │     │ esp-mqtt over wss      │
 │ Add device (+ Wi-Fi)         │     │                                                │     │  user = deviceId       │
 │ Device control:              │─────┼─► /mqtt  byte pipe ──► Mosquitto 127.0.0.1:9001◄┼─wss─┤  pass = deviceSecret  │
 │   mode, eyes (sensors),      │ wss │                         Dynamic Security       │     │ Mode state machine     │
 │   music, previews            │     │   admin client ────────► $CONTROL (users, ACL) │     │  status / eyes /       │
 │ MQTT.js (user = s-<session>, │     │   presence client ─────► d/+/status            │     │  music / lyrics fx     │
 │   short-lived password)      │     │  Services: devices, presence, playback,        │     └────────────────────────┘
 └──────────────────────────────┘     │            lrclib, timelines (Claude)          │       Wokwi simulator runs the
                                      └────────────┼───────────────────────────────────┘       same firmware (SSD1306 build)
                                                   ▼
                                      MongoDB Atlas M0 (source of truth): users, sessions,
                                      devices, songs, playback, timelines, events
```

How the traffic is split:
- **REST** for anything that changes stored state or needs validation:
  login, device registration, mode changes, song selection, play/pause.
  The backend saves it, then publishes to the device over MQTT.
- **MQTT from the browser** only for high-rate sensor data (`imu`) and for
  *watching* device status.
- **MQTT on the device** for everything: it only subscribes to its own
  topics and publishes its own status.

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
│   ├── platformio.ini         envs: hw_sh1106, hw_ssd1306, sim_ssd1306, scanner
│   ├── src/                   main.cpp, net/, modes/, display/, app/
│   ├── include/
│   ├── scripts/gen_config.py  PlatformIO pre-script: env vars → generated config header
│   ├── tools/i2c_bus_scanner.cpp
│   ├── wokwi/                 diagram.json, wokwi.toml
│   ├── Dockerfile             PlatformIO build image → exports binaries
│   └── Makefile               local (non-Docker) shortcuts, as today
├── backend/
│   ├── package.json           "type": "module"
│   ├── .env               local only, git-ignored (variables: §8)
│   ├── Dockerfile             node:24-alpine + mosquitto (Alpine package, pinned)
│   ├── mosquitto/             mosquitto.conf (localhost listeners, dynsec plugin, limits)
│   ├── src/
│   │   ├── server.js          startup order (§1.2): Mongo → Mosquitto → sync → HTTP
│   │   ├── config.js          env parsing + validation (fails fast on start)
│   │   ├── db.js              Mongo connection + index creation
│   │   ├── crypto.js          AES-256-GCM encrypt/decrypt for stored secrets
│   │   ├── auth/              passwords.js (scrypt), tokens.js (JWT), middleware.js
│   │   ├── mqtt/              supervisor.js (spawn/restart + log parsing), dynsec.js (admin
│   │   │                      commands), sync.js (MongoDB → dynsec), proxy.js (/mqtt pipe),
│   │   │                      presence.js, publisher.js, topics.js
│   │   ├── routes/            auth.js, devices.js, music.js, songs.js, health.js
│   │   ├── services/          devices.js, presence.js, playback.js, lrclib.js, timelines.js
│   │   └── lib/               errors.js, rateLimit.js, logger.js, validate.js
│   ├── scripts/               seed-admin.js, mqtt-smoke.js
│   └── test/                  node:test + supertest + in-memory MongoDB
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
├── devices/                   git-ignored: <deviceId>.env files from the dashboard
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
| User password | User | User's head | `scrypt` hash (Node built-in crypto) |
| Access token | Backend at login | Browser memory/localStorage, 15 min life | Not stored (signed JWT) |
| Refresh token | Backend at login | Browser localStorage, 30 days, rotated on use | SHA-256 hash, revocable |
| Pairing code | Backend, on request | Shown on the dashboard as QR + 6-digit code, 5 min, single use | SHA-256 hash, TTL index |
| **Device secret** | Backend when you add a device | `devices/<id>.env` → baked into that device's firmware; Mosquitto's in-memory user list | **Encrypted** (AES-256-GCM) |
| Wi-Fi password | You, in the Add device form | `devices/<id>.env` → firmware | **Encrypted** (AES-256-GCM) |
| Browser MQTT password | Backend, per web session | Browser memory; Mosquitto's user list | Not stored; re-issued on request |
| `SECRETS_KEY` (32 bytes) | You / Render | Render env var only, **never in MongoDB** | — |
| `JWT_SECRET`, `MONGODB_URI`, `MQTT_ADMIN_PASSWORD`, `ANTHROPIC_API_KEY` | You / Render | Render env vars only | — |

Why the device secret is encrypted rather than hashed: after every
restart the backend has to give Mosquitto each device's password again,
so it needs a reversible form. The key lives only in the Render env.
Someone with only a copy of the database gets no usable secrets. This
also lets you re-download a device's complete `.env` at any time.

### 4.2 Device lifecycle

```
 1. REGISTER      Dashboard → "Add device" form:
                    name, kind (hardware | simulator), display (sh1106 | ssd1306),
                    Wi-Fi SSID + password  (simulator: filled with Wokwi-GUEST, no password)
                  POST /api/devices → backend creates  deviceId = oled-7k2m9q + secret,
                    stores both secrets encrypted, adds the MQTT user to Mosquitto
                  → "Download .env"  → devices/oled-7k2m9q.env
                     DEVICE_ID=oled-7k2m9q
                     DEVICE_SECRET=…
                     BROKER_URL=wss://<backend>.onrender.com/mqtt
                     WIFI_SSID=HomeWiFi
                     WIFI_PASS=…
                  (download again any time from the device page; Wi-Fi editable there → rebuild)
 2. BUILD         make firmware DEVICE=oled-7k2m9q        (Docker, see phase 1 §B)
                  → out/oled-7k2m9q/firmware-merged.bin, firmware.elf, manifest.json
 3. FLASH / RUN   hardware: make flash DEVICE=oled-7k2m9q PORT=/dev/ttyUSB0
                  Wokwi:    make sim DEVICE=oled-7k2m9q
 4. FIRST CONNECT device → MQTT (user=oled-7k2m9q, pass=secret) → status "online"
                  dashboard: "never seen" → "online, fw 0.1.0, RSSI -58"
 5. CONTROL       phone (paired to the account) sees the device and controls it
 6. ROTATE        POST /api/devices/:id/rotate-secret → Mosquitto deleteClient (drops the live
                  connection) + createClient with the new secret → new .env → rebuild
 7. REMOVE        DELETE /api/devices/:id → deleteClient: connection dropped, login gone
```

"Not missing any devices": the backend has the full list from step 1.
Each device shows one of **never seen / online / offline since …**. A
connection with an unknown ID or wrong secret is rejected and recorded as a
`device_events` entry, visible on the dashboard.

### 4.3 MQTT authentication and permissions

All of these are Mosquitto Dynamic Security clients:

| Client | MQTT username | MQTT password | Role(s) |
|--------|---------------|---------------|---------|
| Device | its `deviceId` | its device secret | `device` |
| Browser session | `s-<sessionId>` | random, issued by `/api/auth/mqtt-token`, replaced on each call | `user-<userId>` |
| Backend admin | `admin` | `MQTT_ADMIN_PASSWORD` | dynsec admin (only reachable on 127.0.0.1:1883) |
| Backend publisher | `backend` | env | `backend` (publish `d/+/mode`, `cmd`, `music/#`; subscribe `d/+/status`) |

`allow_anonymous false`. Topic permissions (`d/<deviceId>/…`):

| Topic | Role `device` (own ID via `%u`) | Role `user-<userId>` (one ACL set per owned device) | Role `backend` |
|-------|----------------------|-------------------------|---------|
| `status` | publish (+ LWT) | subscribe | subscribe |
| `mode`, `cmd`, `music/*` | subscribe | subscribe (read-only mirror) | publish |
| `imu` | subscribe | **publish** | — |
| anything else / other device IDs | denied | denied | — |

Mosquitto checks these permissions itself, in memory, so there is no
database query per message. The backend updates a user's role whenever
they add or remove a device.

### 4.4 Linking a phone ("copy to the phone")

The phone gets **its own login**, never the device's secret. If the phone
held the device secret, anyone with the phone could pretend to *be* the
device. With a pairing code, the phone can only *control* it.

1. On the laptop dashboard: **"Link a phone"** → `POST /api/auth/pair-codes` → 6-digit code + QR (5 min, single use).
2. Phone opens the frontend → **"Pair"** → scan the QR or type the code → `POST /api/auth/pair` → the phone gets its own tokens.
3. The phone now sees every device on the account. Each session can be
   revoked under Settings → Sessions.

### 4.5 Other protections

- Sign-up is closed by default. The first admin is created with
  `scripts/seed-admin.js`; more users need `SIGNUP_CODE` (env).
- Rate limits: login (5/min/IP), pairing (5/min/IP), search, AI generation.
- `helmet` headers, CORS only for the frontend origin, request body size
  limit. Mosquitto `max_packet_size` 16 KB; both Mosquitto listeners bound
  to `127.0.0.1`, so the only way in from outside is the `/mqtt` pipe.
- Production firmware **refuses `ws://`**: the build fails unless the URL is
  `wss://`. `ws://` is allowed only with `DEV_INSECURE=1` for a local backend.
- ESP32 verifies the server certificate with the built-in CA bundle
  (`esp_crt_bundle_attach`).
- Firmware binaries contain the device secret. Treat `out/` like the `.env`
  files: git-ignored, never uploaded.

---

## 5. Data model (MongoDB)

| Collection | Fields (main) | Indexes | Phase |
|------------|---------------|---------|-------|
| `users` | `_id, email, passwordHash, role (admin/user), createdAt` | `email` unique | 1 |
| `sessions` | `_id, userId, refreshHash, device (UA), createdAt, lastUsedAt, expiresAt` | `refreshHash` unique, TTL `expiresAt` | 1 |
| `pair_codes` | `codeHash, userId, expiresAt` | TTL `expiresAt` | 1 |
| `devices` | `_id (deviceId), ownerId, name, kind (hardware/simulator), display (sh1106/ssd1306), secretEnc, secretVersion, wifi {ssid, passEnc}, createdAt, lastSeenAt, online, fw {version, gitSha, builtAt}, net {rssi, ip}, mode` | `ownerId` | 1 |
| `device_events` | `deviceId, type (connect/disconnect/auth_fail/rotate/created/wifi_changed), at, meta` | `deviceId+at`, TTL 30 days | 1 |

`*Enc` fields hold `{iv, tag, data}` from AES-256-GCM with `SECRETS_KEY`.
Mosquitto keeps no state of its own that matters: logins come from
`devices` and `sessions`, and retained messages are re-published from
`devices.mode` / `playback`.
| `songs` | `_id (lrclibId), title, artist, album, durationMs, lines [[ms,text]], plainLyrics, fetchedAt` | text index on `title, artist` | 3 |
| `playback` | `_id (deviceId), songId, lyrics (bool), positionMs, playing, updatedAt` | — | 3 |
| `timelines` | `songId, promptVersion, model, fx, usage {in,out}, createdAt, status` | `songId+promptVersion` unique | 4 |

TTL indexes and short-lived events keep the database well under the 512 MB
free-tier limit.

---

## 6. MQTT topic map

Prefix `d/<deviceId>/`. Payloads are compact JSON.

| Topic | From → to | Retained | QoS | Payload | Phase |
|-------|-----------|----------|-----|---------|-------|
| `status` | device → backend, browser | yes | 1 | `{"online":true,"fw":"0.1.0","sha":"a1b2c3","rssi":-58,"heap":182000,"mode":"eyes"}`; LWT `{"online":false}` | 1 |
| `cmd` | backend → device | no | 1 | `{"op":"identify"}` / `{"op":"reboot"}` / `{"op":"brightness","v":128}` | 1 |
| `mode` | backend → device | yes | 1 | `{"mode":"idle"}` / `eyes` / `music` | 1 |
| `imu` | browser → device | no | 0 | `[pitch, roll, accelG, seq]` e.g. `[-12.3,4.1,1.02,881]` | 2 |
| `music/track` | backend → device | yes | 1 | `{"id":123,"title":"…","artist":"…","dur":215000,"lyrics":true}` | 3 |
| `music/lines` | backend → device | yes | 1 | `[[12340,"First line"],[15800,"Second"]]` | 3 |
| `music/sync` | backend → device | no | 0 | `{"pos":53210,"playing":true,"at":1730000000000}` | 3 |
| `music/fx` | backend → device | yes | 1 | animation timeline (phase 4) | 4 |

---

## 7. REST API (all phases)

Base: `https://<backend>.onrender.com/api`. JSON. `🔒` = needs
`Authorization: Bearer <access token>`. Device routes check that the
caller owns the device (otherwise `404`, so other users can't even
confirm a device ID exists).

| Method & path | Purpose | Phase |
|---------------|---------|-------|
| `GET /healthz` | Liveness + DB check (no `/api` prefix) | 1 |
| `POST /api/auth/signup` | `{email, password, signupCode}` | 1 |
| `POST /api/auth/login` | `{email, password}` → `{accessToken, refreshToken, user}` | 1 |
| `POST /api/auth/refresh` | `{refreshToken}` → new pair (old one revoked) | 1 |
| `POST /api/auth/logout` 🔒 | revoke current session | 1 |
| `GET /api/auth/me` 🔒 | current user | 1 |
| `GET /api/auth/sessions` 🔒 / `DELETE /api/auth/sessions/:id` 🔒 | list / revoke sessions (e.g. a lost phone) | 1 |
| `POST /api/auth/pair-codes` 🔒 | create a pairing code + QR payload | 1 |
| `POST /api/auth/pair` | `{code}` → tokens for the new phone | 1 |
| `GET /api/auth/mqtt-token` 🔒 | `{url, username, password}` for MQTT.js (creates or refreshes this session's MQTT login) | 1 |
| `GET /api/devices` 🔒 | list with online / last seen / fw | 1 |
| `POST /api/devices` 🔒 | `{name, kind, display, wifi: {ssid, password}}` → `{device, envFile}` | 1 |
| `GET /api/devices/:id` 🔒 | details + recent events (Wi-Fi SSID shown, password never returned) | 1 |
| `PATCH /api/devices/:id` 🔒 | rename, change Wi-Fi `{wifi: {ssid, password}}` (needs a rebuild) | 1 |
| `DELETE /api/devices/:id` 🔒 | remove + disconnect | 1 |
| `POST /api/devices/:id/rotate-secret` 🔒 | new secret, old one disconnected → new env file | 1 |
| `GET /api/devices/:id/env` 🔒 | download the complete `.env` (re-authenticate: requires the account password again) | 1 |
| `PUT /api/devices/:id/mode` 🔒 | `{mode}` → saved + published | 1 |
| `POST /api/devices/:id/commands` 🔒 | `{op, …}` → `cmd` topic (identify, reboot, brightness) | 1 |
| `POST /api/devices/:id/messages` 🔒 | **testing helper**: `{topic: "mode"/"cmd"/"imu", payload}` → publishes after validation. Lets you drive a device with `curl` | 1 |
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
| `JWT_SECRET` | backend | generated by Render (`generateValue: true`) |
| `SECRETS_KEY` | backend | 32 random bytes, base64 (set once and back it up: losing it means re-registering every device) |
| `MQTT_ADMIN_PASSWORD`, `MQTT_BACKEND_PASSWORD` | backend | generated by Render |
| `CORS_ORIGIN` | backend | `https://oled-frontend.onrender.com` |
| `PUBLIC_MQTT_URL` | backend | `wss://oled-backend.onrender.com/mqtt` (written into device env files) |
| `SIGNUP_CODE` | backend | optional |
| `LRCLIB_USER_AGENT` | backend | `esp32-oled/0.1 (+github url)` (LRCLIB asks clients to identify themselves) |
| `ANTHROPIC_API_KEY` | backend | phase 4 |
| `VITE_API_URL`, `VITE_MQTT_URL` | frontend (build time) | backend URLs |
| `DEVICE_ID`, `DEVICE_SECRET`, `BROKER_URL`, `WIFI_SSID`, `WIFI_PASS` | `devices/<id>.env` → firmware build | from the dashboard |

**Local development** (`make dev` → `docker-compose`): backend on
`:8080`, frontend on `:5173`, MongoDB either a local container or an Atlas
"dev" database. iOS only gives motion sensors to HTTPS pages, so phone
sensor testing uses the deployed Render site, or Vite with a
self-signed certificate.

**Deploy:** `render.yaml` Blueprint, connected to the GitHub repo. Push to
`main` → Render rebuilds both. The static site gets a rewrite rule
`/* → /index.html` so React routes work on reload.

**CI (GitHub Actions):** backend tests, frontend build, firmware Docker
build for all envs with a dummy device env, and optionally a Wokwi smoke
test (`wokwi-cli`, needs a `WOKWI_CLI_TOKEN` secret) that checks the serial
log for `MQTT connected`.

---

## 9. Out of scope (possible later)

- Auto-detect the playing song (Spotify with Premium, or Last.fm "now playing").
- Wi-Fi setup without rebuilding (captive-portal provisioning).
- Over-the-air firmware updates from the dashboard.
- Flashing from the browser (ESP Web Tools / esptool-js).
- Sharing a device with another account (roles: owner/controller/viewer).
- Mutual TLS (needs a host with raw TCP).
- Non-Latin lyrics fonts.

## 10. Decisions log

| Date | Decision |
|------|----------|
| 2026-11-01 | MQTT over WebSockets (not a custom WebSocket protocol) |
| 2026-11-01 | **Mosquitto** with the Dynamic Security plugin, run inside the backend container (Aedes considered and rejected) |
| 2026-11-01 | Phones link with a one-time **pairing QR** |
| 2026-11-01 | Wi-Fi entered in the **Add device** form, stored encrypted, built into the firmware |

## 11. Open questions

1. **Device ID format** `oled-` + 6 random characters (e.g. `oled-7k2m9q`), with a free-text name next to it: OK?
