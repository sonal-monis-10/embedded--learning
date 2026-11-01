# Phase 1: Foundation

**Goal:** flash the firmware (real board or Wokwi). On first boot it
registers itself, connects over encrypted MQTT, and the OLED shows its
**device ID, a pairing QR and the code**. A visitor scans it, types a
name, and becomes the device's only controller: they pick a mode and
**tilt their phone to move the robot eyes**. When they leave (or stay
idle 10 minutes, or at midnight) the OLED shows a fresh QR for the next
person.

Shared design (security, data model, topics, API): [README.md](README.md),
especially §4.2 (device lifecycle) and §4.4 (pairing).

---

## Steps and status

| # | Step | Status |
|---|------|--------|
| A | Repo split into `firmware/`, `backend/`, `frontend/`; backend and frontend scaffolds | **Done** |
| C0 | Backend: MongoDB, entities, sessions, pairing codes, nightly cleanup (first model, with members and an admin-issued QR) | **Done**, being reworked in step 2 |
| D0 | Frontend first pass: pair, home, device pages in the warm consumer world | **Done**; finish review said **rebuild** (see §D) |
| 1 | Plan updated to the self-registering, one-phone-per-device model | **Done** (this document) |
| 2 | Backend rework: provisioning, single controller, release, `/api/live` | Next |
| 3 | Mosquitto inside the backend container | |
| 4 | Firmware: provisioning, MQTT, pairing screen, eyes | |
| 5 | Frontend rebuild for the new flow, with the review fixes | |
| E | Deploy on Render | Last |

---

## Step 2. Backend rework

### 2.1 Provisioning (`routes/admin.js`)

`POST /api/admin/devices` with `X-Provision-Key`:

```http
POST /api/admin/devices
X-Provision-Key: ••••••••
{"kind": "hardware", "display": "sh1106", "fw": {"version": "0.1.0", "gitSha": "a1b2c3d"}}

201 Created
{"deviceId": "oled-7k2m9q", "secret": "Qm9…43 chars…", "brokerUrl": "wss://…/mqtt"}
```

- The server generates the ID and secret; the firmware never chooses them.
- Refused when `MAX_DEVICES` is reached (`409 device_limit`), and
  rate-limited to 5 per minute per IP.
- Simulators must use `ssd1306` (Wokwi has no SH1106 part).
- Wi-Fi is gone from the server: no Wi-Fi fields, no `.env` download.
- The other admin routes stay behind `X-Admin-Key`: list, details +
  events, delete, rotate secret (the device re-provisions on next boot),
  release, run cleanup.

### 2.2 One controller per device (`entity/device.js`, `routes/pairing.js`)

- `members[]` becomes `controller: {user, since, lastActiveAt} | null`.
  A unique sparse index on `controller.user` makes "a phone controls one
  device" a database rule.
- `PairingCode` loses `role` and `createdBy`: every code means "become
  the controller of this free device".
- `POST /api/pair`: redeem the code atomically; release the phone's
  previous device; set the controller **only if the device is still free**
  (atomic `findOneAndUpdate` on `controller: null`); clear the device's
  pairing message. Two phones racing for the same device: one wins, the
  other gets `device_taken`.
- Removed: member pairing codes, member removal, owner/member roles,
  `/api/mqtt-credentials`.

### 2.3 Release (`utils/turns.js`)

`release(deviceId, reason)` clears the controller, records a `released`
event (`left`, `idle`, `logout`, `admin`, `cleanup`), notifies the phone
over `/api/live`, and hands the device to the pairing-code issuer. Called
by:
- `POST /api/devices/:id/leave` and `POST /api/logout`;
- a one-minute check: `controller.lastActiveAt` older than
  `IDLE_RELEASE_MIN` (default 10); every tilt batch and mode change bumps
  `lastActiveAt` (tilt at most once every 10 s, to keep writes low);
- the nightly cleanup (all devices at once).

### 2.4 Pairing codes for free devices (`utils/pairingIssuer.js`)

For every device that is online and has no controller: issue a code and
publish retained `d/<id>/pairing`; issue a new one 15 s before the
current one expires. Triggered by "device came online", "device
released", and a 15-second sweep (covers a restarted backend). When the
device is taken or goes offline, publish an empty retained message to
clear it. Until step 3 lands, publishing is a no-op behind the same
interface, so the logic and its tests are done in step 2.

### 2.5 `/api/live` WebSocket (`live/server.js`)

- Upgrade on the existing HTTP server at `/api/live` (the `ws` package).
- The first message must be `{"t":"auth","token":"…"}` within 5 s; the
  token is a session for the controller of a device, else close `4401`.
  (Tokens in the URL would land in logs.)
- Phone → server: `{"t":"imu","v":[pitch,roll,accelG,seq]}`. Validated
  (numbers, ranges), throttled to 30/s per socket, forwarded to
  `d/<id>/imu`.
- Server → phone: `{"t":"status","online":…,"mode":…}` on connect and on
  change; `{"t":"released","reason":"idle"}` before closing when a turn ends.
- Pings every 25 s keep Render's proxy and the free instance awake.

### 2.6 Tests

Provisioning (key, limit, rate limit, simulator display rule); pairing
(only free devices, atomic race, previous device released, same error for
wrong/used/expired codes); release (leave, logout, idle timer with a fake
clock, cleanup); issuer (issues for free+online, re-issues before expiry,
clears when taken); `/api/live` (auth timeout, wrong device, readings
forwarded, throttle, released message).

---

## Step 3. Mosquitto in the backend container

### 3.1 Stack

| Concern | Choice |
|---------|--------|
| Broker | **Mosquitto 2.x** (Alpine package, version pinned) + Dynamic Security plugin, started by the backend as a child process |
| Backend MQTT client | `mqtt` (MQTT.js): an admin client for `$CONTROL` and a backend client for publish/subscribe |
| `/mqtt` pipe | `node:http` `upgrade` event → `node:net` socket to 127.0.0.1:9001, piped both ways |
| Container | `backend/Dockerfile`: `node:24-alpine` + `apk add mosquitto`; Render **Docker** runtime |

### 3.2 Startup order

1. Validate env; connect MongoDB.
2. **Start Mosquitto** (`mqtt/supervisor.js`): fresh dynsec config with
   only the admin user (`mosquitto_ctrl dynsec init`), then spawn
   `mosquitto -c mosquitto/mosquitto.conf`; stdout is read line by line
   for logs and failed-login detection.
3. **Sync logins** (`mqtt/sync.js`): roles `device` and `backend`, then
   `createClient` for every device (secret decrypted in memory only),
   in batches.
4. Backend client connects, subscribes `d/+/status`, re-publishes
   retained `mode` from MongoDB, and starts the pairing-code issuer.
5. Mount routes; `/healthz` returns `503` until steps 2–4 are done.
6. One HTTP server: `/mqtt` → pipe to Mosquitto, `/api/live` → the
   phone WebSocket, everything else → Express.
7. `SIGTERM`: stop accepting, close sockets, stop Mosquitto, close Mongo.

### 3.3 `backend/mosquitto/mosquitto.conf`

```conf
per_listener_settings false
allow_anonymous false
plugin /usr/lib/mosquitto_dynamic_security.so
plugin_opt_config_file /tmp/dynsec.json   # rebuilt on every start; MongoDB is the truth

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

### 3.4 Dynamic Security operations (`mqtt/dynsec.js`)

| Backend event | Commands to `$CONTROL/dynamic-security/v1` |
|---------------|---------------------------------------------|
| Startup | `createRole device` (ACLs with `%u`), `createRole backend`, `createClient` per device |
| Device provisioned | `createClient {username: deviceId, password, roles: [device]}`; if it fails, the device record is deleted again |
| Device deleted / secret rotated | `deleteClient` (disconnects it) |

Every command waits for its response on
`$CONTROL/dynamic-security/v1/response` and fails loudly, so MongoDB and
Mosquitto never disagree silently.

### 3.5 Presence (`mqtt/presence.js`)

- `d/+/status` `online: true` → `online`, `lastSeenAt`, `fw`, `net`, event `connect`; the issuer is told.
- `{online: false}` (Last Will or clean shutdown) → `online = false`, event `disconnect`.
- Mosquitto log `Client <id> … not authorised` → event `auth_fail`, throttled.
- On backend start every device is `online = false` until it reconnects.

---

## Step 4. Firmware

### 4.1 Build configuration

`firmware/firmware.env` (git-ignored; values are JSON strings):

```env
PROVISION_KEY="…"
API_URL="https://oled-backend.onrender.com"
BROKER_URL="wss://oled-backend.onrender.com/mqtt"
WIFI_SSID="HomeWiFi"
WIFI_PASS="…"
```

`firmware/scripts/gen_config.py` (PlatformIO `extra_scripts = pre:`)
reads it, **fails the build** on a missing value or a non-`https`/`wss`
URL (unless `DEV_INSECURE=1` for a local backend), and writes
`.pio/build/<env>/generated/build_config.h` with the values escaped,
plus `FW_VERSION`, `FW_GIT_SHA`, `FW_BUILT_AT`. Secrets stay out of
compiler command lines and logs. The simulator env forces Wokwi-GUEST.

| Env | Display | Used for |
|-----|---------|----------|
| `hw_sh1106` (default) | SH1106 | your 1.3" module |
| `hw_ssd1306` | SSD1306 | 0.96" modules |
| `sim_ssd1306` | SSD1306 | Wokwi (no SH1106 part) |
| `scanner` | — | I2C scanner, unchanged |

### 4.2 Docker build (`firmware/Dockerfile`)

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
RUN --mount=type=secret,id=firmware_env,target=/run/secrets/firmware.env \
    FIRMWARE_ENV=/run/secrets/firmware.env pio run -e "$PIO_ENV" \
 && python scripts/package.py "$PIO_ENV" /out     # merged bin + manifest

FROM scratch AS export
COPY --from=build /out/ /
```

`make firmware TARGET=hw` (or `sim`) runs `docker build` with
`--secret id=firmware_env,src=firmware/firmware.env` and
`--output type=local,dest=out/<target>`. The secret file is mounted only
for that `RUN` and never stored in a layer; no image is pushed. Outputs:
`firmware-merged.bin` (flash at `0x0`, also what Wokwi loads),
`firmware.elf`, `manifest.json` (env, display, version, git SHA; no
secrets). `make flash PORT=/dev/ttyUSB0` and `make sim` (Wokwi diagram
with an ESP32 DevKit V1 and `board-ssd1306` on GPIO 21/22).

One build serves any number of boards: every board provisions its own
ID and secret on first boot.

### 4.3 Structure

```
firmware/src/
  main.cpp              setup(): init → app.begin(); loop(): app.tick()
  app/app.*             state machine + fixed-rate frame loop (no delay())
  app/events.h          queue between the network task and the loop
  display/display.*     SH1106/SSD1306 wrapper, I2C clock fix
  net/wifi.*            connect, back-off reconnect, RSSI
  net/provision.*       first-boot HTTPS call, credentials in NVS (Preferences)
  net/mqtt.*            esp-mqtt over wss, CA bundle, LWT, subscribe, dispatch
  net/protocol.*        topic names, JSON parse (ArduinoJson)
  screens/status.*      boot / Wi-Fi / setting up / connecting / error screens
  screens/pairing.*     device ID + QR (QR library) + the code
  modes/eyes.*          robot eyes driven by imu readings, idle wander without them
  modes/idle.*          resting screen
```

### 4.4 States (each shown on the OLED, so problems are visible without a laptop)

```
BOOT → WIFI ─► no credentials in NVS? → PROVISIONING (POST /api/admin/devices)
                                         ├─ ok → save ID + secret → MQTT
                                         └─ error → "Setup failed" + reason, retry 60 s
      └─► MQTT_CONNECTING ─► auth rejected → erase NVS → PROVISIONING
                          └─► ONLINE ─► pairing message present → PAIRING screen
                                                                   (ID, QR, code)
                                     └─► pairing cleared → current mode
                                         (eyes follow imu; no readings for 2 s → wander)
```

MQTT: `esp-mqtt` (arduino-esp32 2.0.17), `crt_bundle_attach`, keep-alive
30 s, `client_id = username = deviceId`, LWT `{"online":false}` retained
on `d/<id>/status`; subscribes `pairing`, `mode`, `cmd`, `imu`;
`buffer_size` 16 KB. Incoming messages go through a FreeRTOS queue, so
drawing never waits on the network.

Pairing screen on 128×64: device ID in small text across the top, a QR
(version 3, 29×29 modules at 2 px = 58 px) on the left, the code split
as `K3F9-QXW2` on the right. The QR holds the full URL
`https://<frontend>/pair/<code>` (about 55 characters, fits version 3
at error level L at 2 px).

---

## Step 5. Frontend rebuild

The finish review of the first pass returned **rebuild**. This step
applies its findings to the new flow.

| Route | Page | Content |
|-------|------|---------|
| `/pair/:code`, `/pair` | Pair | Name field (and a code field on `/pair`), **Start playing**. Errors: wrong/used/expired code, `device_taken` ("Someone else just took this screen; wait for a new code") |
| `/` | Home | Your device (one) or how to start: "Scan the QR code on the screen" |
| `/devices/:id` | Play | Screen mirror; mode (Idle, Eyes, Music); **Eyes**: "Start tilt control" (iOS permission tap), a drag pad as the non-motion alternative, live status; **Leave** |

Review fixes carried in:
1. The screen mirror becomes truly pixel-drawn: integer pixel runs on the
   128×64 grid, no rounded vectors, drawn at an integer scale (e.g.
   256×128 CSS px), frames taken from the firmware's own drawing code.
2. No eyebrow labels above headings (a brand wordmark, if any, sits in a
   top row of its own).
3. Hover styles only under `@media (hover: hover)`, so taps don't leave
   buttons stuck in their hover colour.
4. Mode labels: Idle, Eyes, Music (approved names); no extra hint lines.
5. A larger greeting, closer to the world's display size; mode tiles get
   mini mirror thumbnails.
6. Secondary text on tinted surfaces is tinted from that surface.
7. The pair page cannot name the device before pairing (codes are only
   checked when redeemed); its copy says "the screen in front of you",
   and the device name appears right after.

---

## E. Infrastructure

| # | Task |
|---|------|
| E1 | MongoDB Atlas: database `oled`, a DB user limited to it, network access `0.0.0.0/0` (Render has no fixed outgoing IP) |
| E2 | `render.yaml`: `oled-backend` (web, **runtime docker**, `dockerfilePath: backend/Dockerfile`, plan free, `healthCheckPath: /healthz`) and `oled-frontend` (static, `rootDir: frontend`, publish `dist`, rewrite `/* → /index.html`) |
| E3 | Render env vars: `MONGODB_URI`, `MONGODB_DB`, `PROVISION_KEY`, `ADMIN_KEY`, `SECRETS_KEY` (set by you, backed up), `MQTT_ADMIN_PASSWORD`, `MQTT_BACKEND_PASSWORD` (generated), `CORS_ORIGIN`, `PUBLIC_MQTT_URL`, `CLEANUP_TZ`, `IDLE_RELEASE_MIN`, `MAX_DEVICES` |
| E4 | `docker-compose.yml` for local dev (backend + frontend, optional local `mongo`) |
| E5 | GitHub Actions: backend tests, frontend build, firmware Docker build for all envs with a dummy `firmware.env` |

---

## Done when

- [ ] Flashing the same build on a real board and in Wokwi: each registers itself and shows its own ID, QR and code.
- [ ] Scanning the QR with a phone, typing a name and tapping **Start playing** takes over the device; the QR disappears and the eyes appear.
- [ ] Tilting the phone moves the eyes; the drag pad does too.
- [ ] Pairing a second device from the same phone frees the first, which shows a new QR.
- [ ] **Leave**, 10 minutes idle, and the midnight cleanup each free the device and bring back a fresh QR.
- [ ] A second phone scanning while someone plays sees no QR; racing for the same code, only one wins.
- [ ] Wrong provision key, device limit, rotated secret and deleted device are all refused and recorded.
- [ ] Unplugging Wi-Fi or redeploying the backend: the device shows its reconnecting state and recovers; the player's turn survives.
- [ ] Backend and frontend deployed on Render from `render.yaml`.
- [ ] No secrets in git or logs.

## Risks

| Risk | Mitigation |
|------|------------|
| `PROVISION_KEY` extracted from a firmware binary | It can only register devices: rate limit, `MAX_DEVICES` cap, and it can be replaced without touching registered devices |
| TLS handshake on ESP32 takes 1–3 s and ~40 KB RAM | Fine on ESP32; free heap reported in `status` |
| Tilt latency over Render (~100–200 ms round trip) | Eyes ease toward targets on the device, so jitter and gaps don't show |
| Mosquitto and MongoDB disagree after a crash | MongoDB is the truth; every startup rebuilds Mosquitto from it |
| Losing `SECRETS_KEY` | Back it up; recovery is rotating every device (they re-provision) |
| Render free cold start (~1 min) | Device shows "connecting" with back-off; phone shows "waking up the server" |
| Wokwi public gateway is slow at times | Simulation is for development; hardware is the reference |
