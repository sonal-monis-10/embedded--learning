# =============================================================================
#  Makefile — top-level shortcuts for the esp32-oled project
# =============================================================================
#
#  The firmware has its own Makefile in firmware/. Every target listed in
#  FIRMWARE_TARGETS is passed straight to it, so `make oled` works from here
#  as well as from inside firmware/.
#
#      make oled       flash the app (SH1106) AND open the monitor
#      make check      compile every firmware environment
#      make help       list every firmware target
#
#  IMPORTANT: the indented lines below MUST use real TAB characters.
# =============================================================================

FIRMWARE_TARGETS := help oled oled-ssd1306 demo scanner monitor erase \
                    build build-ssd1306 build-scanner check \
                    upload upload-ssd1306 upload-scanner \
                    clean clean-all ports

.PHONY: $(FIRMWARE_TARGETS) install lint test test-docker dev-backend dev-frontend

# -C firmware: run make inside firmware/, where platformio.ini lives.
$(FIRMWARE_TARGETS):
	$(MAKE) -C firmware $@

# ---------------------------------------------------------------------------
#  BACKEND + FRONTEND (Node.js 24, see .nvmrc; run `nvm use` first)
# ---------------------------------------------------------------------------

# npm ci installs exactly what package-lock.json lists.
install:
	cd backend && npm ci
	cd frontend && npm ci

lint:
	cd backend && npm run lint && npm run format:check
	cd frontend && npm run lint && npm run format:check

# Frontend has no tests yet; a successful production build is the check.
test:
	cd backend && npm test
	cd frontend && npm run build

# The full backend suite, broker tests included, inside the backend image
# (which has Mosquitto), next to a throwaway MongoDB container.
test-docker:
	docker build --target test -t esp32-oled-backend-test backend
	docker network create oled-test >/dev/null 2>&1 || true
	docker run -d --rm --name oled-test-mongo --network oled-test mongo:latest >/dev/null
	docker run --rm --network oled-test \
	  -e TEST_MONGODB_URI=mongodb://oled-test-mongo:27017 \
	  esp32-oled-backend-test; status=$$?; \
	  docker stop oled-test-mongo >/dev/null; exit $$status

# Each in its own terminal. Backend: http://localhost:8080, frontend: :5173.
# Without Mosquitto installed, set MQTT_ENABLED=false in backend/.env.
dev-backend:
	cd backend && npm run dev

dev-frontend:
	cd frontend && npm run dev
