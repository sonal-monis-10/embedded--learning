# Deploying esp32-oled

Three things get deployed, in this order:

| # | What | Where | How |
|---|------|-------|-----|
| 1 | Backend (Express + Mosquitto, Docker) | Render: `esp32-oled-api` | auto-deploys on push |
| 2 | Frontend (Vite + React, static) | Render: `esp32-oled-web` | GitHub workflow, after the backend is live |
| 3 | Firmware | your ESP32 over USB | `make oled` |

Live addresses:

- API: https://esp32-oled-api.onrender.com (health: `/healthz`)
- Web: https://esp32-oled-web.onrender.com
- Broker (for boards): `wss://esp32-oled-api.onrender.com/mqtt`

---

## Everyday redeploy (everything already set up)

Run from `esp32-oled/`.

```bash
# 1. Check before pushing
nvm use
make lint
make test
make check                 # compiles every firmware environment

# 2. Push: Render rebuilds the backend, then the workflow deploys the frontend
git push origin feature/oled-phase-1-foundation     # or main

# 3. Watch it go live (free plan: ~3-5 min, first request after sleep ~1 min)
curl -s https://esp32-oled-api.onrender.com/healthz
#   want: {"status":"ok","db":"up","broker":"ready","commit":"<your sha>",...}
git rev-parse HEAD         # compare with "commit" above
```

Then check GitHub → Actions → **esp32-oled deploy** is green, and open the web URL.

**Firmware** only needs reflashing if you changed `firmware/` or `firmware/firmware.env`:

```bash
make oled                  # build, flash (SH1106), open serial monitor
```

### Redeploy without a code change

- Backend: Render dashboard → `esp32-oled-api` → **Manual Deploy → Deploy latest commit**.
- Frontend: GitHub → Actions → **esp32-oled deploy** → **Run workflow** (waits for the backend, then deploys).

---

## First-time setup (only once)

### 1. MongoDB

Create a free Atlas cluster, a database user, and allow access from anywhere
(`0.0.0.0/0`, Render has no fixed IP). Copy the `mongodb+srv://...` connection string.

### 2. Render Blueprint

1. Render → **New → Blueprint** → pick the `embedded--learning` repo and the branch.
2. **Blueprint Path:** `esp32-oled/render.yaml`.
3. It asks for `MONGODB_URI`: paste the Atlas string.
4. Apply. Render creates both services and generates `PROVISION_KEY`, `ADMIN_KEY`,
   `SECRETS_KEY` and the two MQTT passwords.

> Never change `SECRETS_KEY` after boards have registered: every board would
> have to be erased and register again.

### 3. Frontend deploy hook (GitHub secret)

1. Render → `esp32-oled-web` → Settings → **Deploy Hook** → copy the URL.
2. GitHub → repo Settings → Secrets and variables → Actions → **New repository secret**
   - Name: `RENDER_FRONTEND_DEPLOY_HOOK`
   - Value: that URL

Without it the workflow fails at "Deploy the frontend".

### 4. Firmware config

Edit `firmware/firmware.env` (git-ignored, values in double quotes):

```ini
WIFI_SSID="your-wifi-name"
WIFI_PASS="your-wifi-password"
PROVISION_KEY="<Render → esp32-oled-api → Environment → PROVISION_KEY>"
API_URL="https://esp32-oled-api.onrender.com"
BROKER_URL="wss://esp32-oled-api.onrender.com/mqtt"
```

The build fails on purpose if a value is missing or a URL is not `https://` / `wss://`.

```bash
make oled
```

On first boot the board registers itself, saves its ID and secret in flash,
connects to the broker and shows the pairing QR. Scan it with the phone.

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `/healthz` hangs ~1 min | Free plan was asleep. Wait and retry. |
| `/healthz` shows `"db":"down"` | Wrong `MONGODB_URI`, or Atlas IP allow-list missing `0.0.0.0/0`. |
| `/healthz` has no `commit` / an old one | Backend still building, or the push didn't change `backend/`. Check the Render deploy log. |
| Browser: CORS error | `CORS_ORIGIN` in `render.yaml` must be exactly `https://esp32-oled-web.onrender.com`. |
| Frontend calls the wrong API | `VITE_API_URL` is baked in at build time: fix `render.yaml`, redeploy the frontend. |
| Workflow: "never reported commit ... as healthy" | Backend build failed or took >25 min. Check Render logs, then re-run the workflow. |
| Workflow: "Add the RENDER_FRONTEND_DEPLOY_HOOK secret" | Do First-time setup step 3. |
| Board: registration fails (401/403) | `PROVISION_KEY` in `firmware.env` doesn't match Render's. Copy it again, `make oled`. |
| Board: stuck after Render secrets changed | `make erase` then `make oled`: it registers as a new device. |
| Board: no Wi-Fi | Check `WIFI_SSID` / `WIFI_PASS`; ESP32 only joins 2.4 GHz networks. |

Admin calls (need `ADMIN_KEY` from Render → Environment):

```bash
export ADMIN_KEY=...       # paste from Render
API=https://esp32-oled-api.onrender.com
curl -s $API/api/admin/devices            -H "X-Admin-Key: $ADMIN_KEY"   # list boards
curl -s -X POST $API/api/admin/devices/<id>/release -H "X-Admin-Key: $ADMIN_KEY"   # free a board
curl -s -X POST $API/api/admin/cleanup    -H "X-Admin-Key: $ADMIN_KEY"   # run nightly wipe now
```
