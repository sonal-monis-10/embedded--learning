# Installation

Setup for building and flashing this project. Target board: **ESP32 DOIT DevKit v1** (`esp32doit-devkit-v1`).

Tested on Ubuntu. Commands assume `bash`.

---

## 1. PlatformIO IDE (VS Code extension)

Install from the Extensions marketplace, or from a terminal:

```bash
code --install-extension platformio.platformio-ide
```

Restart VS Code. Create a directory anywhere in your system for example `line-follower`. Open the `line-follower/` folder in the VSCode PlatformIO detects `platformio.ini` and installs the ESP32 toolchain on first build. At the bottom you will get a prompt when the toolchain is being installed this might take time.

The extension bundles its own PlatformIO Core. Install the CLI below only if you also want `pio` in your terminal. (Recommended)

---

## 2. PlatformIO Core (CLI)

> **Do not use `apt install platformio`.** The packaged version is 4.3.4 and crashes on every command with `AttributeError: 'PlatformioCLI' object has no attribute 'resultcallback'`, because click 8.x removed that API. Use the official installer instead.

Requires `python3` and `python3-venv`:

```bash
sudo apt install python3 python3-venv curl
```

Install Core into its own isolated environment:

```bash
curl -fsSL -o get-platformio.py https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py
python3 get-platformio.py
rm get-platformio.py
```

Add it to your `PATH`:

```bash
echo 'export PATH="$HOME/.platformio/penv/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

The `$HOME/.platformio/penv/bin` entry must come **before** `/usr/bin` so it shadows the apt binary if that package is still installed.

Verify:

```bash
pio --version
```

---

## 3. USB serial access (`dialout` group)

Without this, uploading fails with a permission error on `/dev/ttyUSB0`.

```bash
sudo usermod -aG dialout $USER
```

**Restart the system** for the change to apply a new terminal is not enough.

Verify:

```bash
groups | grep dialout
```

If the board still isn't detected, confirm the kernel sees it:

```bash
pio device list
```

A CP210x or CH340 USB-serial chip may need its driver package; most current kernels include both.

---

## 4. Project file layout

PlatformIO's initialised project already contains `include/` and `src/`. Create the
empty headers and translation units the project is split into, plus the docs folder.
Run these from the project root:

```bash
# Headers
touch include/pins.h include/config.h include/conversion.h \
      include/motors.h include/sensors.h include/control.h \
      include/recovery.h include/telemetry.h

# Implementations
touch src/main.cpp src/calibrate.cpp src/conversion.cpp \
      src/motors.cpp src/sensors.cpp src/control.cpp \
      src/recovery.cpp src/telemetry.cpp

# Documentation
mkdir -p docs
```

The project root should now look like this (`lib/`, `test/` and the `README`
placeholders come from PlatformIO's own scaffolding):

```
.
├── docs
│   └── installation.md
├── include
│   ├── config.h
│   ├── control.h
│   ├── conversion.h
│   ├── motors.h
│   ├── pins.h
│   ├── README
│   ├── recovery.h
│   └── sensors.h
├── lib
│   └── README
├── platformio.ini
├── readme
├── src
│   ├── calibrate.cpp
│   ├── control.cpp
│   ├── conversion.cpp
│   ├── main.cpp
│   ├── motors.cpp
│   ├── recovery.cpp
│   └── sensors.cpp
└── test
    └── README
```

PlatformIO compiles every `.cpp` under `src/` and resolves `#include` against
`include/`, so no build file needs updating when a module is added.

---

## 5. Build environments (`platformio.ini`)

Two environments share one board configuration so you can switch between the robot
firmware and the calibration/bench build without editing sources:

```ini
[platformio]
default_envs = robot

[env]
platform = espressif32
board = esp32doit-devkit-v1
framework = arduino
monitor_speed = 115200
build_flags = -Wall -Wextra

[env:robot]
build_src_filter = +<*> -<calibrate.cpp>

[env:calibrate]
build_src_filter = +<calibrate.cpp>
```

`[env]` holds everything common to both: board, framework, 115200 baud monitor, and
`-Wall -Wextra` so warnings surface in either build.

`build_src_filter` decides which files in `src/` are compiled:

- **`robot`** — production firmware. Everything except `calibrate.cpp`.
- **`calibrate`** — only `calibrate.cpp`, for dev tests, sensor calibration and design
  rule checks.

Both define their own `setup()`/`loop()`, so the filter is what keeps them from
colliding at link time. `default_envs = robot` means a bare `pio run` builds the robot.

---

## 6. Build and flash

Without `-e`, PlatformIO uses `default_envs`, so these act on `robot`:

```bash
pio run                  # compile
pio run -t upload        # compile and flash
pio device monitor       # serial output
```

Pass `-e <env>` to target the other one:

```bash
pio run -e calibrate                # compile the calibration build
pio run -e calibrate -t upload      # compile and flash it
pio run -t upload -e robot          # switch back to the robot firmware
```

Exit the monitor with `Ctrl+C`.

The monitor runs at 115200 to match `Serial.begin(115200)`. `monitor_speed` lives in
`[env]`, so both environments and everyone on the project get the same rate.
