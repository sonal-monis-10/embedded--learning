# =============================================================================
#  Makefile — top-level shortcuts for the esp32-oled project
# =============================================================================
#
#  The firmware has its own Makefile in firmware/. Every target listed in
#  FIRMWARE_TARGETS is passed straight to it, so `make oled` works from here
#  as well as from inside firmware/.
#
#      make oled       flash the OLED demo (SH1106) AND open the monitor
#      make check      compile every firmware environment
#      make help       list every firmware target
#
#  IMPORTANT: the indented lines below MUST use real TAB characters.
# =============================================================================

FIRMWARE_TARGETS := help oled oled-ssd1306 scanner monitor \
                    build build-ssd1306 build-scanner check \
                    upload upload-ssd1306 upload-scanner \
                    clean clean-all ports

.PHONY: $(FIRMWARE_TARGETS) install lint test dev-backend dev-frontend

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

# Each in its own terminal. Backend: http://localhost:8080, frontend: :5173
dev-backend:
	cd backend && npm run dev

dev-frontend:
	cd frontend && npm run dev
