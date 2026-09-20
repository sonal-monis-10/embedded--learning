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

## 4. Build and flash

```bash
pio run                  # compile
pio run -t upload        # compile and flash
pio device monitor       # serial output
```

Exit the monitor with `Ctrl+C`.

The monitor defaults to 9600 baud. To match a different `Serial.begin()` rate, add it to `platformio.ini` so everyone gets the same setting:

```ini
monitor_speed = 115200
```
