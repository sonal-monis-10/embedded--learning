<div align="center">

# esp32-oled

An ESP32 with a 1.3" OLED that you control from your phone: robot eyes that follow its tilt, and song lyrics shown in sync with the music.

[![GitHub stars](https://img.shields.io/github/stars/sonal-monis-10/embedded--learning?style=for-the-badge)](https://github.com/sonal-monis-10/embedded--learning/stargazers)

</div>

## What is this?

Three parts that work together: **firmware** for an ESP32 with an SH1106 OLED, a **backend** on Render that registers devices and hosts the MQTT broker, and a **frontend** where a phone pairs with a device by scanning a QR code. The OLED shows its own pairing QR; there are no accounts: you type a name when you pair, one person plays at a time, and all people data is wiped every night at 00:00 IST.

**Status:** phases 1 and 3 of 4 ([plan](docs/plan/README.md)). Working end to end and deployed on Render: devices register themselves and show their pairing QR on the OLED, one phone per device, robot eyes that follow the phone's tilt, and music mode: search a song, play it in your own music app, and the OLED shows the lyrics in time (or a spinning disc and the progress).

**Live:** phone app https://esp32-oled-web.onrender.com · API https://esp32-oled-api.onrender.com

```mermaid
graph LR
    Phone[Phone browser] -->|HTTPS| Frontend[Frontend<br/>Vite + React]
    Phone -->|REST + WSS| API[Express API]
    subgraph render [Render web service]
        API -->|/mqtt pipe| Broker[Mosquitto]
    end
    API --> DB[(MongoDB Atlas)]
    Device[ESP32 + OLED] -->|MQTT over WSS + TLS| API
```

Full diagram: [docs/architecture.html](docs/architecture.html). Open it in a browser.

## Quick Start

The backend and phone app are already hosted, so to try the project you only
flash the firmware. You need the **`PROVISION_KEY` from the project owner**
(it lets a device register; keep it private).

### Run it on an ESP32

ESP32 DevKit V1 + 1.3" SH1106 I2C OLED (SDA → GPIO21, SCL → GPIO22, VCC → 3V3, GND → GND).
The parts and connections are also listed in `firmware/diagram.json`.
You need [PlatformIO](https://platformio.org/) (CLI or the VS Code extension).

```bash
git clone https://github.com/sonal-monis-10/embedded--learning.git
cd embedded--learning/esp32-oled/firmware
```

Create `firmware/firmware.env` (git-ignored; values in double quotes):

```ini
WIFI_SSID="your-wifi-name"        # 2.4 GHz only
WIFI_PASS="your-wifi-password"
PROVISION_KEY="from-the-project-owner"
API_URL="https://esp32-oled-api.onrender.com"
BROKER_URL="wss://esp32-oled-api.onrender.com/mqtt"
```

Then build, flash and open the serial monitor:

```bash
make oled
```

0.96" SSD1306 module? Use `make oled-ssd1306`. Blank screen? `make scanner`
checks the I2C address. The board shows its pairing QR once it's online:
scan it with your phone, pick **Eyes**, tap **Start tilting**.

### Develop the backend and frontend yourself (optional)

Only if you want your own copy instead of the hosted one. Deploying it to
Render: [docs/DEPLOY.md](docs/DEPLOY.md).

You need [nvm](https://github.com/nvm-sh/nvm) with Node 24 and a MongoDB connection string (the Atlas free tier works).

```bash
nvm use          # Node 24, from .nvmrc
make install     # npm ci in backend/ and frontend/
```

Create `backend/.env`. It is git-ignored, and every variable is checked at startup:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
PROVISION_KEY=<at least 24 random characters>   # also goes into firmware.env
ADMIN_KEY=<at least 24 random characters>
SECRETS_KEY=<32 random bytes, base64>   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Without Mosquitto on your laptop, add `MQTT_ENABLED=false` to run the API alone; the Docker image (`backend/Dockerfile`) runs the broker. With it enabled, also set `MQTT_ADMIN_PASSWORD` and `MQTT_BACKEND_PASSWORD` (16+ characters).

Back up `SECRETS_KEY`: it encrypts the device secrets, and losing it means re-registering every device.

Run the backend and frontend in two terminals:

```bash
make dev-backend    # http://localhost:8080/healthz
make dev-frontend   # http://localhost:5173
```

Point the firmware at it by setting `API_URL` / `BROKER_URL` in `firmware.env`
(`DEV_INSECURE=1 make oled` allows `http://` / `ws://` for a laptop backend).

Before committing, run the checks:

```bash
make test        # backend tests (in-memory MongoDB) + frontend build; broker tests skip without Mosquitto
make test-docker # the same inside the backend image, broker tests included (needs Docker)
make lint        # ESLint + Prettier for both
make check       # compile every firmware environment
```

## Project Structure

```
esp32-oled/
├── backend/          Express 5 API, run as `node server.js`
│   ├── entity/       Mongoose schemas: device, user, session, pairingCode, deviceEvent, meta
│   ├── live/         /api/live WebSocket: tilt in, status and "turn ended" out
│   ├── middleware/   auth (provision/admin keys, sessions, controller), errors, rate limits, validation
│   ├── mqtt/         Mosquitto: supervisor, logins (Dynamic Security), presence, /mqtt pipe
│   ├── routes/       admin (provisioning, maintenance), pairing, devices, health
│   ├── test/         node:test suites, shared in-memory MongoDB
│   ├── utils/        config, secrets (AES-GCM), turns (release, idle), pairing issuer, cleanup
│   ├── app.js        MongoDB connection, middleware, route mounting
│   └── server.js     entry point, graceful shutdown, cleanup schedule
├── docs/             guides, architecture diagram, project plan
├── firmware/         PlatformIO project for the ESP32
│   ├── src/          app (state machine), display, net/ (provisioning, MQTT, TLS roots), screens/, modes/eyes
│   ├── tools/        OLED demo, I2C bus scanner
│   ├── scripts/      gen_config.py: firmware.env -> generated config header
│   ├── diagram.json  wiring diagram (parts and connections)
│   └── platformio.ini  envs: hw_sh1106, hw_ssd1306, demo_*, scanner
├── frontend/         Vite + React app
│   ├── src/          pages/ (home, pair, device), components/, services/ (API, /api/live tilt)
│   └── vite.config.js
└── Makefile          shortcuts: install, dev-*, test, lint, oled, check, …
```

## Documentation

| Resource | Description |
|----------|-------------|
| [docs/DEPLOY.md](docs/DEPLOY.md) | Deploy and redeploy the backend and frontend on Render |
| [docs/plan/README.md](docs/plan/README.md) | Architecture decisions, security model, data model, MQTT topics, full API list |
| [docs/plan/phase-1-foundation.md](docs/plan/phase-1-foundation.md) | Current phase: pairing, devices, broker, firmware build, deploy |
| [docs/architecture.html](docs/architecture.html) | Architecture diagram (open in a browser) |
| [docs/how-main-works.md](docs/how-main-works.md) | Walk-through of the OLED demo firmware |
| [docs/display-ram.md](docs/display-ram.md) | OLED memory layout, pixel formula, raw I2C commands |
| [docs/README.md](docs/README.md) | Reading list: datasheets, I2C, libraries |
