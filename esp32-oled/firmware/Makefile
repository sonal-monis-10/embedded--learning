# =============================================================================
#  Makefile — shortcuts for the firmware builds in this project
# =============================================================================
#
#  QUICK REFERENCE
#      make oled       flash the OLED demo (SH1106) AND open the monitor
#      make scanner    flash the I2C scanner        AND open the monitor
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
.PHONY: help oled oled-ssd1306 scanner monitor \
        build build-ssd1306 build-scanner upload upload-ssd1306 upload-scanner \
        clean clean-all check ports

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
	@echo "  EVERYDAY USE"
	@echo "    make oled           flash OLED demo (SH1106)  + open monitor"
	@echo "    make oled-ssd1306   flash OLED demo (SSD1306) + open monitor"
	@echo "    make scanner        flash I2C scanner         + open monitor"
	@echo "    make monitor        open serial monitor only"
	@echo ""
	@echo "  COMPILE WITHOUT FLASHING"
	@echo "    make build          compile OLED demo (SH1106)"
	@echo "    make build-ssd1306  compile OLED demo (SSD1306)"
	@echo "    make build-scanner  compile I2C scanner"
	@echo "    make check          compile ALL three — run before committing"
	@echo ""
	@echo "  FLASH WITHOUT MONITOR"
	@echo "    make upload"
	@echo "    make upload-ssd1306"
	@echo "    make upload-scanner"
	@echo ""
	@echo "  MAINTENANCE"
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
	$(PIO) run -e oled_sh1106 -t upload
	$(PIO) device monitor -e oled_sh1106

# For 0.96" modules with the SSD1306 controller. On an SH1106 this leaves
# only random dots on the screen.
oled-ssd1306:
	$(PIO) run -e oled -t upload
	$(PIO) device monitor -e oled

# First thing to run when the screen stays blank: it should report a device
# at 0x3C (or 0x3D).
scanner:
	$(PIO) run -e scanner -t upload
	$(PIO) device monitor -e scanner

monitor:
	$(PIO) device monitor -e oled_sh1106

# ---------------------------------------------------------------------------
#  COMPILE-ONLY TARGETS
#  No upload, so these work with no board connected.
# ---------------------------------------------------------------------------
build:
	$(PIO) run -e oled_sh1106

build-ssd1306:
	$(PIO) run -e oled

build-scanner:
	$(PIO) run -e scanner

# The scanner compiles tools/ while the OLED builds compile src/, and the two
# OLED builds take different #ifdef branches (USE_SH1106), so one can break
# while the others still build. Run this before committing.
check:
	@echo "--- compiling oled_sh1106 ---"
	$(PIO) run -e oled_sh1106
	@echo "--- compiling oled (ssd1306) ---"
	$(PIO) run -e oled
	@echo "--- compiling scanner ---"
	$(PIO) run -e scanner
	@echo "--- all environments compiled ---"

# ---------------------------------------------------------------------------
#  FLASH WITHOUT MONITOR
# ---------------------------------------------------------------------------
upload:
	$(PIO) run -e oled_sh1106 -t upload

upload-ssd1306:
	$(PIO) run -e oled -t upload

upload-scanner:
	$(PIO) run -e scanner -t upload

# ---------------------------------------------------------------------------
#  MAINTENANCE
# ---------------------------------------------------------------------------

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
