# Project plan: connected OLED (Robot Eyes + Music/Lyrics)

Status: **draft v2, waiting for confirmation**. Nothing here is built yet.

| Phase | Goal | File |
|-------|------|------|
| 1 | **Foundation**: repo split (`firmware/` `backend/` `frontend/`), QR pairing (no accounts), admin-key device registry in MongoDB, per-device secrets, Docker firmware build (hardware + Wokwi), secure MQTT connection, device dashboard | [phase-1-foundation.md](phase-1-foundation.md) |
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
| Device credentials | A random secret per device, created by the backend when you add the device, stored encrypted, delivered to the firmware build in an env file | Every device is known to the server before it exists, so nothing goes missing. See §4 |
| Wi-Fi credentials | Entered in the **Add device** form (editable later), stored encrypted, included in the device's env file | One form gives you everything the build needs |
| Phone sign-in | **No email or password.** A phone scans a one-time **pairing QR** on a web page, enters a name, and gets a session for that device. Users and sessions are deleted every night at 00:00 IST; people simply scan again | Nothing to sign up for or remember; no personal data kept. See §4.4 |
| Who can add devices | Whoever has the **`ADMIN_KEY`** (Render env var), typed once on the Add device page | The site is public; without it anyone could create devices on your broker |
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
 │ QR pairing (name only)       │─────┼─► /api/*   REST (JSON, session token)          │     │ Wi-Fi                  │
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
| `ADMIN_KEY` | You / Render | Render env var; your browser's localStorage on the Add device page | Not stored (compared with `timingSafeEqual`) |
| Session token | Backend, when a phone pairs | Phone's localStorage; expires at the next 00:00 IST | SHA-256 hash, TTL index, deleted nightly |
| Pairing code | Backend, on request | Inside the pairing QR (URL), 2 min, single use | SHA-256 hash, TTL index |
| **Device secret** | Backend when you add a device | `devices/<id>.env` → baked into that device's firmware; Mosquitto's in-memory user list | **Encrypted** (AES-256-GCM) |
| Wi-Fi password | You, in the Add device form | `devices/<id>.env` → firmware | **Encrypted** (AES-256-GCM) |
| Browser MQTT password | Backend, per web session | Browser memory; Mosquitto's user list | Not stored; re-issued on request |
| `SECRETS_KEY` (32 bytes) | You / Render | Render env var only, **never in MongoDB** | — |
| `MONGODB_URI`, `MQTT_ADMIN_PASSWORD`, `MQTT_BACKEND_PASSWORD`, `ANTHROPIC_API_KEY` | You / Render | Render env vars only | — |

Session tokens are random 32-byte values looked up in MongoDB on each
request, not JWTs. With a few phones and a nightly reset this costs
nothing, and revoking a session takes effect immediately.

Why the device secret is encrypted rather than hashed: after every
restart the backend has to give Mosquitto each device's password again,
so it needs a reversible form. The key lives only in the Render env.
Someone with only a copy of the database gets no usable secrets. This
also lets you re-download a device's complete `.env` at any time.

### 4.2 Device lifecycle

```
 1. REGISTER      "Add device" page (needs ADMIN_KEY):
                    kind (hardware | simulator), display (sh1106 | ssd1306),
                    Wi-Fi SSID + password  (simulator: filled with Wokwi-GUEST, no password)
                  POST /api/admin/devices → backend creates  deviceId = oled-7k2m9q + secret,
                    stores both secrets encrypted, adds the MQTT user to Mosquitto
                  → "Download .env"  → devices/oled-7k2m9q.env
                     DEVICE_ID=oled-7k2m9q
                     DEVICE_SECRET=…
                     BROKER_URL=wss://<backend>.onrender.com/mqtt
                     WIFI_SSID=HomeWiFi
                     WIFI_PASS=…
                  (download again any time from the admin device list; Wi-Fi editable → rebuild)
 2. BUILD         make firmware DEVICE=oled-7k2m9q        (Docker, see phase 1 §B)
                  → out/oled-7k2m9q/firmware-merged.bin, firmware.elf, manifest.json
 3. FLASH / RUN   hardware: make flash DEVICE=oled-7k2m9q PORT=/dev/ttyUSB0
                  Wokwi:    make sim DEVICE=oled-7k2m9q
 4. FIRST CONNECT device → MQTT (user=oled-7k2m9q, pass=secret) → status "online"
                  admin list: "never seen" → "online, fw 0.1.0, RSSI -58"
 5. PAIR          admin page shows a pairing QR for the device → phone scans →
                  "Your name?" → phone is the device's owner (see §4.4)
 6. CONTROL       paired phones see the device and control it
 7. MIDNIGHT      00:00 IST: users, sessions, names, members, mode, events wiped.
                  The device login stays: the board keeps connecting, nobody controls it
                  until someone pairs again (back to step 5)
 8. ROTATE        POST /api/admin/devices/:id/rotate-secret → Mosquitto deleteClient (drops the
                  live connection) + createClient with the new secret → new .env → rebuild
 9. REMOVE        DELETE /api/admin/devices/:id → deleteClient: connection dropped, login gone
```

"Not missing any devices": the backend has the full list from step 1,
and it survives the nightly cleanup. Each device shows one of **never
seen / online / offline since …**. A connection with an unknown ID or
wrong secret is rejected and recorded as a `device_events` entry, visible
in the admin list (until midnight).

### 4.3 MQTT authentication and permissions

All of these are Mosquitto Dynamic Security clients:

| Client | MQTT username | MQTT password | Role(s) |
|--------|---------------|---------------|---------|
| Device | its `deviceId` | its device secret | `device` |
| Browser session | `s-<sessionId>` | random, issued by `/api/mqtt-credentials`, replaced on each call | `user-<userId>` |
| Backend admin | `admin` | `MQTT_ADMIN_PASSWORD` | dynsec admin (only reachable on 127.0.0.1:1883) |
| Backend publisher | `backend` | env | `backend` (publish `d/+/mode`, `cmd`, `music/#`; subscribe `d/+/status`) |

`allow_anonymous false`. Topic permissions (`d/<deviceId>/…`):

| Topic | Role `device` (own ID via `%u`) | Role `user-<userId>` (one ACL set per device they are a member of) | Role `backend` |
|-------|----------------------|-------------------------|---------|
| `status` | publish (+ LWT) | subscribe | subscribe |
| `mode`, `cmd`, `music/*` | subscribe | subscribe (read-only mirror) | publish |
| `imu` | subscribe | **publish** | — |
| anything else / other device IDs | denied | denied | — |

Mosquitto checks these permissions itself, in memory, so there is no
database query per message. The backend updates a user's role whenever
they add or remove a device.

### 4.4 Pairing a phone (QR, no login)

The phone gets **its own session**, never the device's secret. If the
phone held the device secret, anyone with the phone could pretend to *be*
the device. With a session, the phone can only *control* it.

**Who can show a pairing QR** (a code is single-use and lives 2 min):

| Situation | Who shows the QR | Scanner becomes |
|-----------|------------------|-----------------|
| Device has no members (new, or after midnight) | Admin page, device row → **Pair** | **owner** |
| Device already has an owner | The owner's phone → **Add phone** (QR on the phone's own screen) | **member** |
| Owner's phone lost | Admin page → **Pair** again (replaces the owner) | **owner** |

**Flow:**
1. `POST /api/admin/devices/:id/pairing-codes` (admin) or
   `POST /api/devices/:id/pairing-codes` (owner) → `{url, expiresAt}`.
   The URL is `https://<frontend>/pair/<code>`. The page renders it as a QR.
2. The phone's camera opens that URL. The page asks **"Your name?"** (1–40 characters).
3. `POST /api/pair {code, name}` → backend checks the code (unused, not
   expired) → creates the user, adds them to the device's `members`,
   creates a session (expires 00:00 IST) → `{sessionToken, user, device}`.
4. The phone stores the token and goes to the device's control page.
   If the phone already has a session (it paired another device today),
   the same user is reused and the new device is added to it.

**Nightly cleanup (00:00 Asia/Kolkata):**
- Deletes `users`, `sessions`, `pairing_codes`, `device_events`,
  `playback`; resets every device's `members`, `name` and `mode`.
- Removes every browser MQTT login (`s-*` clients) and user role from
  Mosquitto. Phones show "Session ended at midnight, scan again".
- Device logins and Wi-Fi are **not** touched.
- The free Render instance may be asleep at midnight, so the job can't
  rely on a timer alone. The date of the last cleanup is stored; on
  startup and every 15 min the backend runs it if today's (IST) cleanup
  hasn't happened. Sessions also carry `expiresAt` = next midnight, so
  an old token is rejected even before the cleanup runs.

### 4.5 Other protections

- Admin routes (`/api/admin/*`) require the `X-Admin-Key` header.
- Rate limits: pairing (10/min/IP), admin key failures (5/min/IP), search, AI generation.
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
Mongoose schemas live in `backend/entity/`. **Kept** = survives the
nightly cleanup.

| Collection (entity) | Fields (main) | Indexes | Kept? | Phase |
|---------------------|---------------|---------|-------|-------|
| `devices` (`device.js`) | `_id (deviceId), kind, display, secret (enc), secretVersion, wifi {ssid, password (enc)}, createdAt` | — | **yes** | 1 |
| ↳ same documents | `name, members [{user, role owner/member, joinedAt}], mode` | `members.user` | reset nightly | 1 |
| ↳ same documents | `online, lastSeenAt, fw {version, gitSha, builtAt}, net {rssi, ip}` (live status, refreshed by the device) | — | yes | 1 |
| `users` (`user.js`) | `_id, name, createdAt, lastSeenAt` (no email, no password) | — | no | 1 |
| `sessions` (`session.js`) | `_id, user, tokenHash, userAgent, createdAt, lastUsedAt, expiresAt` | `tokenHash` unique, TTL `expiresAt` | no | 1 |
| `pairing_codes` (`pairingCode.js`) | `codeHash, device, role (owner/member), createdBy (admin / userId), expiresAt, usedAt` | `codeHash` unique, TTL `expiresAt` | no | 1 |
| `device_events` (`deviceEvent.js`) | `device, type (connect/disconnect/auth_fail/rotate/created/wifi_changed/paired), at, meta` | `device+at` | no | 1 |
| `meta` | `_id: "cleanup", lastRunDate (IST, YYYY-MM-DD)` | — | yes | 1 |
| `songs` (`song.js`) | `_id (lrclibId), title, artist, album, durationMs, lines [[ms,text]], plainLyrics, fetchedAt` | text index on `title, artist` | yes (cache) | 3 |
| `playback` (`playback.js`) | `_id (deviceId), song, lyrics (bool), positionMs, playing, updatedAt` | — | no | 3 |
| `timelines` (`timeline.js`) | `song, promptVersion, model, fx, usage {in,out}, createdAt, status` | `song+promptVersion` unique | yes (cache) | 4 |

`(enc)` fields hold `{iv, tag, data}` from AES-256-GCM with `SECRETS_KEY`,
are `select: false`, and never appear in API responses. Mosquitto keeps no
state of its own that matters: logins come from `devices` and `sessions`,
and retained messages are re-published from `devices.mode` / `playback`.
The nightly cleanup and caches keep the database well under the 512 MB
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

Base: `https://<backend>.onrender.com/api`. JSON.
- `🔒` = needs `Authorization: Bearer <session token>` (a paired phone).
  Device routes check that the caller is a member of the device
  (otherwise `404`, so others can't even confirm a device ID exists).
  `👑` = the caller must be the device's owner.
- `🛠` = needs `X-Admin-Key: <ADMIN_KEY>`.

| Method & path | Purpose | Phase |
|---------------|---------|-------|
| `GET /healthz` | Liveness + DB check (no `/api` prefix) | 1 |
| **Admin** | | |
| `GET /api/admin/devices` 🛠 | all devices with online / last seen / fw / members | 1 |
| `POST /api/admin/devices` 🛠 | `{kind, display, wifi: {ssid, password}}` → `{device, envFile}` | 1 |
| `GET /api/admin/devices/:id` 🛠 | one device with members and its last 50 events | 1 |
| `PATCH /api/admin/devices/:id` 🛠 | change Wi-Fi `{wifi: {ssid, password}}` (needs a rebuild) | 1 |
| `DELETE /api/admin/devices/:id` 🛠 | remove + disconnect | 1 |
| `POST /api/admin/devices/:id/rotate-secret` 🛠 | new secret, old one disconnected → new env file | 1 |
| `GET /api/admin/devices/:id/env` 🛠 | download the complete `.env` | 1 |
| `POST /api/admin/devices/:id/pairing-codes` 🛠 | pairing QR that makes the scanner the **owner** (replaces any owner) | 1 |
| `POST /api/admin/cleanup` 🛠 | run the nightly cleanup now (testing) | 1 |
| **Pairing and session** | | |
| `POST /api/pair` | `{code, name}` → `{sessionToken, user, device}` (reuses the caller's user if a valid token is sent) | 1 |
| `GET /api/me` 🔒 | current user + their devices | 1 |
| `PATCH /api/me` 🔒 | change name | 1 |
| `POST /api/logout` 🔒 | end this session | 1 |
| `GET /api/mqtt-credentials` 🔒 | `{url, username, password}` for MQTT.js (creates or refreshes this session's MQTT login) | 1 |
| **Devices (paired phones)** | | |
| `GET /api/devices` 🔒 | the caller's devices with live status | 1 |
| `GET /api/devices/:id` 🔒 | details + members | 1 |
| `PATCH /api/devices/:id` 🔒👑 | rename (e.g. "Sonal's desk") | 1 |
| `POST /api/devices/:id/pairing-codes` 🔒👑 | pairing QR that makes the scanner a **member** | 1 |
| `DELETE /api/devices/:id/members/:userId` 🔒👑 | remove a member (or yourself) | 1 |
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
| `MONGODB_DB` | backend | `oled` (default) |
| `ADMIN_KEY` | backend | long random string you choose; typed once on the Add device page |
| `CLEANUP_TZ` | backend | `Asia/Kolkata` (default); the nightly cleanup runs at 00:00 in this zone |
| `SECRETS_KEY` | backend | 32 random bytes, base64 (set once and back it up: losing it means re-registering every device) |
| `MQTT_ADMIN_PASSWORD`, `MQTT_BACKEND_PASSWORD` | backend | generated by Render |
| `CORS_ORIGIN` | backend | `https://oled-frontend.onrender.com` |
| `PUBLIC_MQTT_URL` | backend | `wss://oled-backend.onrender.com/mqtt` (written into device env files) |
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
| 2026-11-01 | Backend layout: `server.js`, `app.js` (MongoDB + middleware + route paths), `routes/` (logic), `entity/` (Mongoose schemas), no `src/` |
| 2026-11-01 | **No email/password accounts.** Phones pair by QR and give a name; users, sessions and pairings are wiped nightly at 00:00 IST. Device logins are kept |
| 2026-11-01 | Pairing QR shown on a **web page** (admin page for the first owner, owner's phone for more members) |
| 2026-11-01 | Device registration guarded by an **`ADMIN_KEY`** |
| 2026-11-01 | No `.env*` files committed, not even `.env.example` |

## 11. Open questions

1. **Device ID format** `oled-` + 6 random characters (e.g. `oled-7k2m9q`), with a free-text name next to it: OK?
