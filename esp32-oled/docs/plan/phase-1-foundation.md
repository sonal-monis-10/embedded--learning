# Phase 1: Foundation

**Goal:** register a device on the admin page, build its firmware with one
Docker command, and run it on real hardware **or** in Wokwi. It connects
over encrypted MQTT, shows up as **online** on your phone, and responds to
an "identify" command. No eyes or music yet. This phase is the plumbing
everything else uses.

Shared design (security, data model, topics, API list): [README.md](README.md).

---

## A. Repository restructure

| # | Task | Details |
|---|------|---------|
| A1 | Move the PlatformIO project into `firmware/` | `git mv` `platformio.ini src include lib test tools Makefile` → `firmware/`. History is kept |
| A2 | Update paths | `.vscode/` (PlatformIO project path), `.gitignore` (`firmware/.pio/`, `devices/*.env`, `out/`, `node_modules/`, `.env`), docs links |
| A3 | Root `Makefile` | `make firmware DEVICE=<id> [TARGET=hw\|sim]`, `make flash DEVICE=<id> PORT=…`, `make sim DEVICE=<id>`, `make dev`, `make test` |
| A4 | `devices/README.md` (committed) | Explains that `*.env` files here are secrets and git-ignored |
| A5 | Scaffold `backend/` and `frontend/` | Done: Express 5 skeleton (`/healthz`, config validation, error shape, tests) and Vite + React app calling it; ESLint + shared Prettier config, `.nvmrc` (Node 24) |

---

## B. Firmware: config, Docker build, Wokwi

### B1. Build-time configuration

`firmware/scripts/gen_config.py` is a PlatformIO `extra_scripts = pre:`
script. It:
1. Reads `DEVICE_ID`, `DEVICE_SECRET`, `BROKER_URL`, `WIFI_SSID`, `WIFI_PASS`
   from the environment (or a file given in `DEVICE_ENV`).
2. **Fails the build** if any are missing, if `DEVICE_ID` doesn't match
   `^oled-[a-z0-9]{6}$`, or if `BROKER_URL` is not `wss://` (unless
   `DEV_INSECURE=1`).
3. Writes `.pio/build/<env>/generated/device_config.h` (outside `src/`,
   never committed), escaping strings safely, plus `FW_VERSION`,
   `FW_GIT_SHA` and `FW_BUILT_AT`.

Why a script instead of `-DDEVICE_SECRET=\"${sysenv.DEVICE_SECRET}\"`
in `build_flags`: proper validation, no quoting bugs, and the secret
doesn't show up in the compiler command lines printed in logs.

### B2. PlatformIO environments

| Env | Display driver | Wi-Fi | Used for |
|-----|----------------|-------|----------|
| `hw_sh1106` (default) | SH1106 | from env file | your 1.3" module |
| `hw_ssd1306` | SSD1306 | from env file | 0.96" modules |
| `sim_ssd1306` | SSD1306 | forced to `Wokwi-GUEST`, no password | Wokwi. It has **no SH1106 part**, only `board-ssd1306` |
| `scanner` | — | — | I2C scanner, unchanged |

The `#ifdef USE_SH1106` code from today's `main.cpp` moves into
`src/display/display.cpp`, so the rest of the firmware calls one
`Display` interface and doesn't care which chip is fitted.

### B3. Docker build (`firmware/Dockerfile`)

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.12-slim AS toolchain
RUN pip install --no-cache-dir platformio==<pinned>
WORKDIR /fw
COPY platformio.ini ./
RUN pio pkg install                      # cached layer: toolchain + libraries

FROM toolchain AS build
ARG PIO_ENV=hw_sh1106
COPY . .
RUN --mount=type=secret,id=device_env,target=/run/secrets/device.env \
    DEVICE_ENV=/run/secrets/device.env pio run -e "$PIO_ENV" \
 && python scripts/package.py "$PIO_ENV" /out     # merged bin + manifest

FROM scratch AS export
COPY --from=build /out/ /
```

`make firmware DEVICE=oled-7k2m9q TARGET=hw` runs:

```bash
docker build firmware/ \
  --secret id=device_env,src=devices/oled-7k2m9q.env \
  --build-arg PIO_ENV=hw_sh1106 \
  --output type=local,dest=out/oled-7k2m9q
```

- `--secret` makes the env file available **only during that `RUN`**. It is
  not stored in any image layer.
- `--output type=local` copies the files out. No image is tagged or pushed.
- The toolchain layer is cached, so after the first build only your code
  recompiles.

Outputs in `out/<deviceId>/`:

| File | Use |
|------|-----|
| `firmware-merged.bin` | Bootloader + partitions + app in one file, flash at `0x0` (esptool, or Wokwi) |
| `firmware.bin`, `bootloader.bin`, `partitions.bin` | Separate parts, if you need them |
| `firmware.elf` | Wokwi (symbols) and debugging |
| `manifest.json` | `deviceId, env, display, fwVersion, gitSha, builtAt`. **No secret** |

### B4. Flashing and simulation

- **Hardware:** `make flash DEVICE=oled-7k2m9q PORT=/dev/ttyUSB0` runs
  `esptool.py write_flash 0x0 out/…/firmware-merged.bin`. It runs in a
  container with `--device /dev/ttyUSB0`, or with the local esptool from
  PlatformIO.
- **Wokwi:** `firmware/wokwi/diagram.json` has an ESP32 DevKit V1 and a
  `board-ssd1306` on GPIO 21/22. `make sim DEVICE=<sim-id>` writes
  `wokwi.toml` pointing at that device's merged bin + elf, then starts the
  simulation via the Wokwi VS Code extension or `wokwi-cli`.
- Register simulated devices with **kind = simulator**, a separate device
  with its own secret. The Wokwi public network gateway is monitored by
  Wokwi. The traffic is TLS-encrypted, but keeping simulator secrets
  separate means one is never reused on hardware.

### B5. Firmware structure

```
firmware/src/
  main.cpp              setup(): init → app.begin(); loop(): app.tick()
  app/app.cpp/.h        state machine + fixed-rate frame loop (no delay())
  app/events.h          queue between the network task and the loop
  display/display.*     SH1106/SSD1306 wrapper, contrast, I2C clock fix
  net/wifi.*            connect, back-off reconnect, RSSI
  net/mqtt.*            esp-mqtt client: wss, CA bundle, LWT, subscribe, dispatch
  net/protocol.*        topic names, JSON parse/serialize (ArduinoJson)
  screens/status.*      boot / Wi-Fi / broker / auth-failed / online / identify screens
  modes/idle.*          clock-like idle screen (phase 2+ adds eyes, music)
```

Runtime states (shown on the OLED, so problems are visible without a laptop):

```
BOOT → WIFI_CONNECTING → MQTT_CONNECTING → ONLINE ──(mode)──► IDLE / EYES / MUSIC
           ▲     │              │   │
           └─────┘ retry        │   └─ auth rejected → AUTH_FAILED screen (shows device ID,
             with back-off      │      "re-register or rotate secret"), retry every 60 s
                                └─ TLS / network error → retry with back-off
```

MQTT client details:
- `esp-mqtt` (part of arduino-esp32 2.0.17), `uri = BROKER_URL`,
  `crt_bundle_attach = esp_crt_bundle_attach`, `keepalive = 30`,
  `client_id = username = DEVICE_ID`, `password = DEVICE_SECRET`.
- LWT: topic `d/<id>/status`, payload `{"online":false}`, retained, QoS 1.
- On connect: publish retained `status` (fw, sha, rssi, heap, mode),
  subscribe `d/<id>/mode`, `d/<id>/cmd` (later `d/<id>/imu`, `d/<id>/music/#`).
- `buffer_size` 16 KB (needed for lyrics timelines later).
- Messages go into a FreeRTOS queue and are handled in `loop()`. Drawing
  is never blocked by the network, and the network is never blocked by I2C.
- `cmd` ops in this phase: `identify` (shows the device ID and name in large
  text, blinks the LED for 10 s), `reboot`, `brightness`.
- Status re-published every 60 s (RSSI, heap), so the web pages stay current.

---

## C. Backend (`backend/`)

### C1. Stack

| Concern | Choice |
|---------|--------|
| Runtime | Node.js 24 LTS, ES modules (`"type": "module"`) |
| HTTP | Express 5, `helmet`, `cors` |
| MQTT broker | **Mosquitto 2.x** (Alpine package, version pinned) + Dynamic Security plugin, started by the backend as a child process |
| MQTT client (backend) | `mqtt` (MQTT.js): admin client for `$CONTROL`, presence/publisher client |
| `/mqtt` pipe | `node:http` `upgrade` event → `node:net` socket to 127.0.0.1:9001, piped both ways |
| Container | `backend/Dockerfile`: `node:24-alpine` + `apk add mosquitto`; Render **Docker** runtime |
| DB | `mongoose` (one schema per entity in `entity/`) |
| Validation | `zod` (request bodies, env config, MQTT payloads from browsers) |
| Auth | No passwords. `node:crypto` random tokens (sessions, pairing codes) stored as SHA-256 hashes; `ADMIN_KEY` checked with `timingSafeEqual` |
| Scheduling | Nightly cleanup: `Intl` date in `Asia/Kolkata` + a 15-min check (catches up after the free instance slept) |
| Logging | `pino` (JSON logs, readable in Render's log view) |
| Rate limits | `express-rate-limit` |
| Tests | `node:test`, `supertest`, `mongodb-memory-server`, `mqtt` (as a test client) |

### C2. Startup (`server.js` → `createApp()` in `app.js`)

1. Parse and validate env (`utils/config.js`); exit with a clear message if
   anything is missing (including a `SECRETS_KEY` that isn't 32 bytes).
2. Connect to MongoDB with Mongoose (in `app.js`); indexes come from the `entity/` schemas.
3. **Start Mosquitto** (`mqtt/supervisor.js`): write a fresh dynsec config
   with only the admin user (`mosquitto_ctrl dynsec init`), then spawn
   `mosquitto -c mosquitto/mosquitto.conf`. Its stdout is read line by line
   for logging and for failed-login detection.
4. **Sync logins** (`mqtt/sync.js`): the admin client connects to
   127.0.0.1:1883, creates roles `device` and `backend`, then for every
   device `createClient` (secret decrypted in memory only) and for every
   user a role `user-<userId>`. Commands are sent in batches.
5. Backend publisher connects; re-publishes retained `mode` (and later
   music state) from MongoDB; subscribes `d/+/status`.
6. Create the Express app; mount routes. `/healthz` returns `503` until
   steps 3–5 are done.
7. One `http.createServer(app)`. On `upgrade` with path `/mqtt` → pipe to
   127.0.0.1:9001 (`mqtt/proxy.js`). Other upgrade paths → closed.
8. Listen on `process.env.PORT` (Render sets it).
9. On `SIGTERM` (Render deploys): stop accepting connections, stop
   Mosquitto (`SIGTERM`, wait), close Mongo. Devices reconnect to the new instance.

### C3. Mosquitto config (`backend/mosquitto/mosquitto.conf`)

```conf
per_listener_settings false
allow_anonymous false
plugin /usr/lib/mosquitto_dynamic_security.so
plugin_opt_config_file /tmp/dynsec.json   # rebuilt on every start, MongoDB is the truth

listener 9001 127.0.0.1
protocol websockets

listener 1883 127.0.0.1                     # backend clients only
max_packet_size 16384
max_keepalive 120
persistence false                           # retained state is re-published from MongoDB
log_dest stdout
log_type error
log_type warning
log_type notice
log_type information
connection_messages true
```

### C4. Dynamic Security operations (`mqtt/dynsec.js`)

| Backend event | Commands sent to `$CONTROL/dynamic-security/v1` |
|---------------|-------------------------------------------------|
| Startup | `createRole device` (ACLs with `%u`), `createRole backend`, then per device `createClient`, per user `createRole user-<id>` |
| Device added | `createClient {username: deviceId, password, roles: [device]}` + `addRoleACL` on the owner's `user-<id>` role (`status` subscribe, `imu` publish, `mode`/`cmd`/`music/#` subscribe) |
| Device deleted | `deleteClient` (disconnects it) + `removeRoleACL` from the owner's role |
| Secret rotated | `deleteClient` + `createClient` with the new secret |
| `/api/mqtt-credentials` | `createClient s-<sessionId>` (or `setClientPassword` if it exists) with a new random password, role `user-<userId>` |
| Logout / session revoked | `deleteClient s-<sessionId>` |
| Member added / removed | `addRoleACL` / `removeRoleACL` on that user's role |
| Nightly cleanup | `deleteClient` every `s-*` client, `deleteRole` every `user-*` role |

Every command checks the response on `$CONTROL/dynamic-security/v1/response`
and raises an error if it fails. The API call that triggered it then
fails too, so MongoDB and Mosquitto never disagree silently.

Presence (`mqtt/presence.js`):
- `d/+/status` with `online: true` → `devices.online = true`, `lastSeenAt`, `fw`, `net`, event `connect`.
- `{online: false}` (Last Will, or a clean shutdown) → `online = false`, event `disconnect`.
- Mosquitto log line `Client <id> … not authorised` → event `auth_fail`
  (throttled to one per device per minute).
- On backend start: every device is set to `online = false`; clients reconnect within seconds and set it back.

### C5. Routes in this phase

> **Status (2026-11-01):** done except the Mosquitto parts. Admin, pairing,
> device and cleanup routes are implemented and tested (63 tests); the places
> that will talk to Mosquitto are marked `// TODO(mqtt):` in the code.
> `GET /api/mqtt-credentials`, `POST /api/devices/:id/commands` and
> `/messages` come with the broker.

All routes from README §7 marked **phase 1**, one router file each,
mounted in `app.js`:

| File | Mounted at | Middleware in `app.js` |
|------|-----------|------------------------|
| `routes/health.js` | `/healthz` | — |
| `routes/admin.js` | `/api/admin` | `requireAdmin` (`X-Admin-Key`), rate limit on failures |
| `routes/pairing.js` | `/api` (`/pair`, `/me`, `/logout`, `/mqtt-credentials`) | `optionalSession` on `/pair`, `requireSession` on the rest |
| `routes/devices.js` | `/api/devices` | `requireSession`; `requireMember` / `requireOwner` per route |

New entities: `entity/session.js`, `entity/pairingCode.js`,
`entity/deviceEvent.js`; `entity/device.js` changes `owner` into
`members: [{user, role, joinedAt}]`.

Example: registering a device (Wi-Fi entered in the same form):

```http
POST /api/admin/devices
X-Admin-Key: ••••••••
{"kind": "hardware", "display": "sh1106",
 "wifi": {"ssid": "HomeWiFi", "password": "••••••••"}}

201 Created
{
  "device": {"id": "oled-7k2m9q", "kind": "hardware", "display": "sh1106",
             "wifi": {"ssid": "HomeWiFi"}, "members": [],
             "online": false, "lastSeenAt": null},
  "envFile": "DEVICE_ID=oled-7k2m9q\nDEVICE_SECRET=Qm9…\nBROKER_URL=wss://…/mqtt\nWIFI_SSID=HomeWiFi\nWIFI_PASS=…\n"
}
```

Steps inside: validate → generate ID + 32-byte secret → encrypt secret and
Wi-Fi password → insert into MongoDB → dynsec `createClient`. If the
dynsec step fails, the MongoDB insert is rolled back.

Example: pairing a phone (the admin page made the code, the phone scanned it):

```http
POST /api/pair
{"code": "K3F9QXW2", "name": "Sonal"}

200 OK
{
  "sessionToken": "Zk1…43 chars…",            ← stored on the phone, valid until 00:00 IST
  "user": {"id": "6724…", "name": "Sonal"},
  "device": {"id": "oled-7k2m9q", "name": "Sonal's OLED", "role": "owner", "online": true}
}
```

Codes are 8 characters from an alphabet without look-alikes (no `0/O`,
`1/I/L`), so they can also be typed if a camera won't scan. Wrong or used
codes all return the same `invalid_code` error. Brute force is blocked by
the rate limit: 8 characters from 31 symbols is about 850 billion
combinations against 10 tries per minute.

Wi-Fi validation: SSID 1–32 bytes, password empty (open network) or 8–63
characters (WPA2 rule). Simulator devices get `Wokwi-GUEST` / empty password
automatically.

Example: testing without the UI:

```bash
curl -X POST "$API/api/devices/oled-7k2m9q/messages" \
  -H "Authorization: Bearer $SESSION_TOKEN" -H "Content-Type: application/json" \
  -d '{"topic":"cmd","payload":{"op":"identify"}}'
```

### C6. Scripts

- `scripts/mqtt-smoke.js --env devices/<id>.env`: connects **as that device**
  from your laptop with MQTT.js, publishes a status, and prints every
  message it receives. Lets you test the backend before any firmware exists.

---

## D. Frontend (`frontend/`)

### D1. Stack

Vite + React (JavaScript), `react-router`, `mqtt` (MQTT.js browser build),
`qrcode` (pairing QR). Plain CSS modules, mobile-first. No UI framework
needed yet.

### D2. Pages in this phase

| Route | Page | Content |
|-------|------|---------|
| `/` | Home | Paired: your devices. Not paired: "Scan a device's pairing QR to start" |
| `/pair/:code` | Pair | Opened by the phone's camera from the QR. Asks **"Your name?"**, then `POST /api/pair` → device page. Also has a field to type a code by hand |
| `/devices/:id` | Device (phone) | Status, **Identify**, **Reboot**, brightness, mode selector (only `idle` this phase); owner only: rename, **Add phone** (shows a member QR, 2 min countdown), members list with remove |
| `/admin` | Admin | Asks for the `ADMIN_KEY` once (kept in localStorage, **Forget key** button). Device list: ID, kind badge, status dot (never seen / online / offline since …), fw, RSSI, members. Per device: **Pair** (owner QR), **Download .env**, Wi-Fi edit ("rebuild needed" badge), rotate secret, delete, recent events. **Run cleanup now** button |
| `/admin/devices/new` | Add device | Form: kind (hardware / simulator), display (SH1106 / SSD1306), **Wi-Fi SSID + password** (show/hide toggle; hidden and pre-filled for simulators). Submit → "Download .env" + copy-paste build command (`make firmware DEVICE=…`), a note that the file is a secret, and the device's **Pair** QR |

### D3. Plumbing

- `services/client.js`: adds the session token (or the admin key on
  `/api/admin/*`). On `401` it clears the token and shows "Session ended,
  scan a pairing QR again" (expected after midnight).
- `mqtt/useMqtt.js`: gets this session's MQTT username/password from
  `/api/mqtt-credentials`, connects, and subscribes to `d/<id>/status` for
  the user's devices. If the broker rejects the login (backend restarted,
  session revoked), it fetches new credentials once before reconnecting.
- Build-time env: `VITE_API_URL`, `VITE_MQTT_URL`.

---

## E. Infrastructure

| # | Task |
|---|------|
| E1 | MongoDB Atlas: create database `oled`, a DB user with access to that database only, network access `0.0.0.0/0` (Render has no fixed outgoing IP) |
| E2 | `render.yaml` Blueprint: `oled-backend` (web, **runtime docker**, `dockerfilePath: backend/Dockerfile`, plan free, `healthCheckPath: /healthz`) and `oled-frontend` (static, `rootDir: frontend`, publish `dist`, rewrite `/* → /index.html`) |
| E3 | Render env vars: `MONGODB_URI`, `MONGODB_DB`, `ADMIN_KEY`, `SECRETS_KEY` (set by you, backed up), `MQTT_ADMIN_PASSWORD`, `MQTT_BACKEND_PASSWORD` (generated), `CORS_ORIGIN`, `PUBLIC_MQTT_URL`, `CLEANUP_TZ` |
| E4 | `docker-compose.yml` for local dev (backend + frontend, optional local `mongo` container) |
| E5 | GitHub Actions: backend lint + tests, frontend build, firmware Docker build for all 3 envs with a dummy CI device env |

---

## F. Tests

| Area | Test |
|------|------|
| Admin | Wrong/missing `X-Admin-Key` → 401 on every `/api/admin` route; failures rate-limited |
| Pairing | Admin code makes the scanner owner; owner code makes a member; a code works once and expires after 2 min; wrong, used and expired codes give the same error; a phone with a session reuses its user; non-owner can't create codes |
| Cleanup | After cleanup: users, sessions, codes, events gone, devices keep ID/secret/Wi-Fi but lose members/name/mode, browser MQTT logins removed. A session from yesterday is rejected even if cleanup hasn't run yet. Cleanup runs on startup if the scheduled one was missed |
| Devices | Create with Wi-Fi → env file contains it; `GET` never returns the secret or Wi-Fi password; MongoDB holds only encrypted values; `.env` download requires the password again; another user gets `404`; rotate invalidates the old secret; delete disconnects a live client |
| Broker (real Mosquitto in tests) | Device connects with correct secret; rejected with wrong secret or unknown ID; anonymous rejected; device can't publish to another device's topics or subscribe to `#`; user session can't subscribe to a device they don't own; revoked session's MQTT login stops working; Mosquitto ports not reachable from outside the container |
| Sync | Kill and restart the container → all device logins rebuilt from MongoDB, devices reconnect without a rebuild; a failed dynsec command makes the API call fail and rolls back MongoDB |
| Presence | Connect → online; kill the socket without disconnecting → LWT → offline; backend restart → devices back online after reconnect |
| Firmware build | Build fails with a missing secret, a malformed ID, or a `ws://` URL; manifest contains no secret (`grep` check in CI) |
| End to end | Real board and Wokwi both reach ONLINE; Identify from the phone shows the ID on the OLED within 1 s |

---

## G. Done when

- [ ] Repo is split into `firmware/`, `backend/`, `frontend/`; old `make oled` workflow still works inside `firmware/`.
- [ ] Backend and frontend are deployed on Render from `render.yaml`.
- [ ] With the admin key you can register a device, download its `.env`, run `make firmware`, and flash the result. The device appears **online** on the admin page.
- [ ] The same flow works for a **simulator** device in Wokwi.
- [ ] A phone scans the device's pairing QR, enters a name, and controls it: **Identify** works on the board and in Wokwi. A second phone joins through the owner's **Add phone** QR.
- [ ] After the midnight cleanup (or **Run cleanup now**) the phones must scan again, and the devices stay online.
- [ ] Wrong secret / rotated secret / deleted device are all rejected and shown in device events.
- [ ] Unplugging Wi-Fi or redeploying the backend: the device shows its reconnecting state and recovers by itself.
- [ ] No secrets in git (`git grep` + CI check), no secrets in logs.

## H. Risks

| Risk | Mitigation |
|------|------------|
| TLS handshake on ESP32 takes 1–3 s and ~40 KB RAM | Fine on ESP32. Measure free heap after connect and show it in `status` |
| Mosquitto and MongoDB disagree (e.g. a crash between the two writes) | MongoDB is the truth; every startup rebuilds Mosquitto from it. An admin "re-sync" button on the admin page forces the same at runtime |
| Losing `SECRETS_KEY` makes stored secrets unreadable | Back it up outside Render. Recovery path: rotate every device's secret and rebuild |
| Two processes in one container | Backend supervises Mosquitto (restart on exit, health check fails until both are up). Render restarts the container on repeated failure |
| Mosquitto package version changes on Alpine updates | Pin the package version in the Dockerfile; tests run against the same image |
| Render free cold start (~1 min) after everything was off | Device shows "connecting" and retries with back-off. The web app shows "waking server…" |
| Wokwi public gateway is slow/unstable at times | Simulation is for development, not timing tests; hardware is the reference |
