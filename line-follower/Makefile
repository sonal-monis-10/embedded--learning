# =============================================================================
#  Makefile — shortcuts for the two firmware builds in this project
# =============================================================================
#
#  QUICK REFERENCE
#      make cal        flash the calibration tool AND open the monitor
#      make robot      flash the line follower  AND open the monitor
#      make help       list every target
#
#  IMPORTANT: the indented lines below MUST use real TAB characters, not
#  spaces. Make requires this. If your editor converts tabs to spaces you
#  will get "missing separator" errors.
# =============================================================================

# ?= means "use this value unless the caller supplies one". So if pio is not
# on your PATH you can override it per command without editing this file:
#     make cal PIO=~/.platformio/penv/bin/pio
PIO ?= pio

# .PHONY tells make these names are COMMANDS, not files to be produced.
# Without it, a file or directory named "test" or "check" sitting in the
# project root would make think the target was already up to date and refuse
# to run it.
.PHONY: help cal calibrate robot monitor \
        build-cal build-robot upload-cal upload-robot \
        clean clean-all check ports

# ---------------------------------------------------------------------------
#  DEFAULT TARGET
#  The first target in the file is what a bare `make` runs. Making it help
#  rather than a build means `make` on its own never flashes anything
#  unexpected.
# ---------------------------------------------------------------------------
help:
	@echo ""
	@echo "  LINE FOLLOWER — build targets"
	@echo "  ============================="
	@echo ""
	@echo "  EVERYDAY USE"
	@echo "    make cal            flash calibration tool + open monitor"
	@echo "    make robot          flash line follower  + open monitor"
	@echo "    make monitor        open serial monitor only"
	@echo ""
	@echo "  COMPILE WITHOUT FLASHING"
	@echo "    make build-cal      compile calibration tool only"
	@echo "    make build-robot    compile line follower only"
	@echo "    make check          compile BOTH — run before committing"
	@echo ""
	@echo "  FLASH WITHOUT MONITOR"
	@echo "    make upload-cal"
	@echo "    make upload-robot"
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
#
#  Each runs two commands in sequence: upload, then monitor. They are combined
#  because you nearly always want to watch the output immediately after
#  flashing, and typing two commands every time gets tedious during a
#  calibration session.
#
#  If the upload fails, make stops and never runs the monitor — that is
#  standard make behaviour and it is what you want here.
# ---------------------------------------------------------------------------

# `cal` is an alias for `calibrate`. A target whose recipe is just another
# target name simply runs that one. Worth having because you will type it
# many times while working through the ten tests.
cal: calibrate

calibrate:
	$(PIO) run -e calibrate -t upload
	$(PIO) device monitor -e calibrate

robot:
	$(PIO) run -e robot -t upload
	$(PIO) device monitor -e robot

# Monitor without flashing. Useful when the board is already running and you
# just closed the terminal, or when you want to watch a power-on reset.
monitor:
	$(PIO) device monitor -e robot

# ---------------------------------------------------------------------------
#  COMPILE-ONLY TARGETS
#
#  No upload, so these work with no board connected. This is the fast way to
#  catch syntax errors while writing the module files.
# ---------------------------------------------------------------------------
build-cal:
	$(PIO) run -e calibrate

build-robot:
	$(PIO) run -e robot

# Compile BOTH environments.
#
# This matters more than it looks. Because platformio.ini uses
# build_src_filter, each environment compiles a DIFFERENT subset of src/. It
# is therefore entirely possible to break one environment while the other
# still builds cleanly, and not notice until you next flash it.
#
# Run this before committing.
check:
	@echo "--- compiling calibrate ---"
	$(PIO) run -e calibrate
	@echo "--- compiling robot ---"
	$(PIO) run -e robot
	@echo "--- both environments compiled ---"

# ---------------------------------------------------------------------------
#  FLASH WITHOUT MONITOR
#  For when you want to flash and then carry the robot to the track without a
#  terminal attached.
# ---------------------------------------------------------------------------
upload-cal:
	$(PIO) run -e calibrate -t upload

upload-robot:
	$(PIO) run -e robot -t upload

# ---------------------------------------------------------------------------
#  MAINTENANCE
# ---------------------------------------------------------------------------

# Removes compiled object files only. Use when a build behaves oddly after
# renaming or moving files — stale object files can survive a rename and
# produce confusing link errors.
clean:
	$(PIO) run -t clean

# Deletes the ENTIRE .pio directory, including the downloaded ESP32 toolchain
# and framework. The next build re-downloads them, which takes several
# minutes. Only needed if the platform installation itself is suspect.
clean-all:
	rm -rf .pio

# Lists serial ports PlatformIO can see. First thing to check when an upload
# fails with a connection error.
ports:
	$(PIO) device list