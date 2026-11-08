# esp32-oled docs

| File | What it covers |
|------|----------------|
| [DEPLOY.md](DEPLOY.md) | **Deployment steps**: everyday redeploy, first-time Render setup, troubleshooting |
| [architecture.html](architecture.html) | **Architecture diagram** (open in a browser): phone, frontend, Express + Mosquitto on Render, MongoDB, ESP32, later-phase LRCLIB and Claude |
| [how-main-works.md](how-main-works.md) | Walk-through of `firmware/tools/oled_demo.cpp`: build flags, `setup()`, `loop()`, drawing calls, where to make changes |
| [plan/](plan/README.md) | **Draft plan**: architecture, security, API, and 4 phases (foundation, robot eyes, music, AI animations) |
| [display-ram.md](display-ram.md) | The framebuffer and the OLED's GDDRAM: page layout, the pixel formula, the I2C bytes, raw buffer access, raw commands |

All links below were checked on 2026-11-01.

---

## Reading list

Read roughly in this order. ★ = read first.

### 1. Datasheets (primary sources)

| Doc | Read these parts | Link |
|-----|------------------|------|
| ★ **SH1106** OLED controller (our chip) | Pin/interface description (I2C), "Graphic Display Data RAM", the **command table**, the power-on sequence | [sh1106_datasheet.pdf](https://www.velleman.eu/downloads/29/infosheets/sh1106_datasheet.pdf) |
| SSD1306 OLED controller (the 0.96" cousin) | 8.1.5 I2C interface, 8.7 GDDRAM, 9 command table, 10.1.3 addressing modes. Clearer than the SH1106 sheet, and the concepts are the same | [SSD1306.pdf](https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf) |
| ESP32 datasheet | Block diagram, memory overview, peripheral list, GPIO restrictions | [esp32_datasheet_en.pdf](https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf) |
| ESP32-WROOM-32 module | Pin layout of the module on the DevKit, flash size, strapping pins | [esp32-wroom-32_datasheet_en.pdf](https://www.espressif.com/sites/default/files/documentation/esp32-wroom-32_datasheet_en.pdf) |
| ESP32 Technical Reference Manual | Chapter "I2C Controller" (registers, FIFO, timing) and "System and Memory". Needed when you go below the Arduino layer | [esp32_technical_reference_manual_en.pdf](https://www.espressif.com/sites/default/files/documentation/esp32_technical_reference_manual_en.pdf) |

### 2. Concepts

| Topic | Why you need it | Link |
|-------|-----------------|------|
| ★ I2C basics | Addresses, start/stop, ACK, why there are two wires | [SparkFun: I2C](https://learn.sparkfun.com/tutorials/i2c/all) |
| I2C in depth | Timing, clock stretching, pull-up sizing | [TI: Understanding the I2C Bus (SLVA704)](https://www.ti.com/lit/an/slva704/slva704.pdf) |
| Pull-up resistors | Why SDA/SCL need them, what goes wrong without them | [SparkFun: Pull-up Resistors](https://learn.sparkfun.com/tutorials/pull-up-resistors/all) |
| ★ Bitwise operations | `\|=`, `&= ~`, `^=`, `<<`: the whole framebuffer is bit twiddling | [Wikipedia: Bitwise operation](https://en.wikipedia.org/wiki/Bitwise_operation), [Arduino: bitshift](https://docs.arduino.cc/language-reference/en/structure/bitwise-operators/bitshiftLeft/) |
| ESP32 memory types | DRAM vs IRAM vs flash, what `const` and the heap mean on this chip | [ESP-IDF: Memory Types](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/memory-types.html) |
| ESP32 pins | Which GPIOs are safe to use, input-only pins, strapping pins | [Random Nerd Tutorials: ESP32 pinout](https://randomnerdtutorials.com/esp32-pinout-reference-gpios/) |
| Non-blocking timing | Replacing `delay()` with `millis()` once you add more features | [Arduino: millis()](https://docs.arduino.cc/language-reference/en/functions/time/millis/) |

### 3. Libraries used in this project

| Library | Read | Link |
|---------|------|------|
| ★ Adafruit GFX | The guide: coordinates, shapes, text, fonts, bitmaps | [Adafruit GFX guide](https://learn.adafruit.com/adafruit-gfx-graphics-library), [source](https://github.com/adafruit/Adafruit-GFX-Library) |
| Adafruit SH110X (v2.1.15) | `Adafruit_SH110X.cpp` → `display()`; `Adafruit_SH1106G.cpp` → init sequence | [source](https://github.com/adafruit/Adafruit_SH110X) |
| Adafruit SSD1306 | Compare its `display()` with SH110X's to see addressing modes in practice | [source](https://github.com/adafruit/Adafruit_SSD1306) |
| Adafruit OLED guide | Wiring, module variants, troubleshooting | [Monochrome OLED breakouts](https://learn.adafruit.com/monochrome-oled-breakouts) |
| Arduino-ESP32 `Wire` | `begin(sda, scl)`, `setClock`, `beginTransmission`/`write`/`endTransmission` | [Arduino-ESP32 I2C API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/i2c.html) |
| Arduino-ESP32 `Serial` | `begin`, `printf` | [Arduino-ESP32 Serial API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/serial.html) |

The exact library source used by your build is on disk, under
`firmware/.pio/libdeps/oled_sh1106/`. That is the code your firmware actually runs.

### 4. Tools

| Tool | Use | Link |
|------|-----|------|
| image2cpp | Convert a PNG/JPG into a C byte array. Choose "Horizontal" for `drawBitmap()` or "Vertical" for a raw framebuffer copy (see [display-ram.md §5](display-ram.md#5-accessing-the-framebuffer-directly)) | [javl.github.io/image2cpp](https://javl.github.io/image2cpp/) |
| PlatformIO `platformio.ini` | Environments, `build_flags`, `lib_deps` | [PlatformIO project config](https://docs.platformio.org/en/latest/projectconf/index.html) |
| I2C scanner | Find the OLED's address: `make scanner` | `firmware/tools/i2c_bus_scanner.cpp` |

---

## Suggested path

1. Read [how-main-works.md](how-main-works.md) with `firmware/tools/oled_demo.cpp` open beside it.
2. SparkFun I2C + the bitwise operations page.
3. [display-ram.md](display-ram.md). Then try the `rawDemo()` example in §5.
4. SH1106 datasheet: the GDDRAM section and the command table. Check each
   byte of `Adafruit_SH1106G::begin()`'s init list against it.
5. Read `Adafruit_SH110X::display()` in `firmware/.pio/libdeps/`. You should now
   understand every line.
6. Stage 2: write your own driver ([display-ram.md §7](display-ram.md#7-stage-2-preview-the-minimum-your-own-driver-needs)).
