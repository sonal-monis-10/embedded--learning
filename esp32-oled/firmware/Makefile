# =============================================================================
#  Makefile — shortcuts for the firmware builds in this project
# =============================================================================
#
#  QUICK REFERENCE
#      make oled       flash the app (SH1106)  AND open the monitor
#      make scanner    flash the I2C scanner   AND open the monitor
#      make help       list every target
#
#  IMPORTANT: the indented lines below MUST use real TAB characters, not
#  spaces. Make requires this. If your editor converts tabs to spaces you
#  will get "missing separator" errors.
# =============================================================================

# Use pio from PATH if it is there, otherwise PlatformIO's own install
# location. ?= still lets you override it per command:
#     make oled PIO=/some/other/pio
PIO ?= $(shell command -v pio 2>/dev/null || echo $(HOME)/.platformio/penv/bin/pio)

# .PHONY tells make these names are COMMANDS, not files to be produced.
.PHONY: help oled oled-ssd1306 demo scanner monitor \
        build build-ssd1306 build-scanner upload upload-ssd1306 upload-scanner \
        erase clean clean-all check ports

# ---------------------------------------------------------------------------
#  DEFAULT TARGET
#  A bare `make` prints help rather than building, so it never flashes
#  anything unexpected.
# ---------------------------------------------------------------------------
help:
	@echo ""
	@echo "  ESP32 OLED — build targets"
	@echo "  =========================="
	@echo ""
	@echo "  The app reads firmware.env (Wi-Fi, backend URLs, PROVISION_KEY)."
	@echo ""
	@echo "  EVERYDAY USE"
	@echo "    make oled           flash the app (SH1106)    + open monitor"
	@echo "    make oled-ssd1306   flash the app (SSD1306)   + open monitor"
	@echo "    make demo           flash the Hello demo      + open monitor"
	@echo "    make scanner        flash I2C scanner         + open monitor"
	@echo "    make monitor        open serial monitor only"
	@echo ""
	@echo "  COMPILE WITHOUT FLASHING"
	@echo "    make build          compile the app (SH1106)"
	@echo "    make build-ssd1306  compile the app (SSD1306)"
	@echo "    make build-scanner  compile I2C scanner"
	@echo "    make check          compile EVERY environment — run before committing"
	@echo ""
	@echo "  FLASH WITHOUT MONITOR"
	@echo "    make upload"
	@echo "    make upload-ssd1306"
	@echo "    make upload-scanner"
	@echo ""
	@echo "  MAINTENANCE"
	@echo "    make erase          wipe the board's flash: it forgets its device"
	@echo "                        login and registers as a new device next boot"
	@echo "    make clean          remove build artifacts"
	@echo "    make clean-all      also remove downloaded toolchains"
	@echo "    make ports          list detected serial ports"
	@echo ""
	@echo "  Exit the serial monitor with Ctrl+C."
	@echo ""

# ---------------------------------------------------------------------------
#  EVERYDAY TARGETS
#  Upload, then monitor. If the upload fails, make stops before the monitor.
# ---------------------------------------------------------------------------

# Our module is an SH1106, so this is the one you normally want.
oled:
	$(PIO) run -e hw_sh1106 -t upload
	$(PIO) device monitor -e hw_sh1106

# For 0.96" modules with the SSD1306 controller. On an SH1106 this leaves
# only random dots on the screen.
oled-ssd1306:
	$(PIO) run -e hw_ssd1306 -t upload
	$(PIO) device monitor -e hw_ssd1306

# The original "Hello, ESP32!" counter (tools/oled_demo.cpp), no network.
demo:
	$(PIO) run -e demo_sh1106 -t upload
	$(PIO) device monitor -e demo_sh1106

# First thing to run when the screen stays blank: it should report a device
# at 0x3C (or 0x3D).
scanner:
	$(PIO) run -e scanner -t upload
	$(PIO) device monitor -e scanner

monitor:
	$(PIO) device monitor -e hw_sh1106

# ---------------------------------------------------------------------------
#  COMPILE-ONLY TARGETS
#  No upload, so these work with no board connected.
# ---------------------------------------------------------------------------
build:
	$(PIO) run -e hw_sh1106

build-ssd1306:
	$(PIO) run -e hw_ssd1306

build-scanner:
	$(PIO) run -e scanner

# The app, the demo and the scanner compile different files, and each
# display takes a different #ifdef branch (USE_SH1106), so one can break
# while the others still build. Run this before committing.
check:
	$(PIO) run -e hw_sh1106 -e hw_ssd1306 -e demo_sh1106 -e demo_ssd1306 -e scanner

# ---------------------------------------------------------------------------
#  FLASH WITHOUT MONITOR
# ---------------------------------------------------------------------------
upload:
	$(PIO) run -e hw_sh1106 -t upload

upload-ssd1306:
	$(PIO) run -e hw_ssd1306 -t upload

upload-scanner:
	$(PIO) run -e scanner -t upload

# ---------------------------------------------------------------------------
#  MAINTENANCE
# ---------------------------------------------------------------------------

# Erases the whole flash, the saved device login (NVS) included. Flash
# again afterwards (`make oled`). The old device stays in the database
# until deleted with the ADMIN_KEY.
erase:
	$(PIO) run -e hw_sh1106 -t erase

# Removes compiled object files only.
clean:
	$(PIO) run -t clean

# Deletes the ENTIRE .pio directory, including the downloaded toolchain. The
# next build re-downloads it, which takes several minutes.
clean-all:
	rm -rf .pio

# Lists serial ports PlatformIO can see. First thing to check when an upload
# fails with a connection error.
ports:
	$(PIO) device list
