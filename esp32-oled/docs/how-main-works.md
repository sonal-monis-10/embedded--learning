# How `firmware/src/main.cpp` works

A walk through the OLED demo, from power-on to pixels on the glass.
For the memory layout behind it, see [display-ram.md](display-ram.md).
For what to read next, see [README.md](README.md).

---

## 1. The big picture

```
 ESP32 (your code)                          OLED module (SH1106 chip + panel)
 ┌───────────────────────────┐              ┌──────────────────────────────┐
 │ display.print("Count:")   │              │                              │
 │ display.drawLine(...)     │              │  GDDRAM (in the SH1106 chip) │
 │        │                  │              │  132 x 64 bits               │
 │        ▼                  │   I2C bus    │        │                     │
 │ framebuffer in ESP32 RAM  │ ───────────► │        ▼                     │
 │ uint8_t buffer[1024]      │  SDA = GPIO21│  panel scans GDDRAM ~100x/s  │
 │        ▲                  │  SCL = GPIO22│  and lights the pixels       │
 │ display.display() sends it│              │                              │
 └───────────────────────────┘              └──────────────────────────────┘
```

There are **two** copies of the picture:

| Copy | Where it lives | Who changes it | Size |
|------|----------------|----------------|------|
| Framebuffer | ESP32 RAM (heap), `display.getBuffer()` | Every drawing call (`print`, `drawLine`, `fillRect`, `clearDisplay`) | 128 × 64 / 8 = **1024 bytes** |
| GDDRAM | Inside the SH1106 chip on the OLED module | Only bytes that arrive over I2C | 132 × 64 / 8 = 1056 bytes |

Drawing calls only touch the first copy. `display.display()` copies it into the
second. The panel always shows whatever is in GDDRAM, so if you forget
`display()` nothing changes on screen.

---

## 2. Build-time choice: SH1106 or SSD1306 (lines 22–34, 53–57)

```cpp
#ifdef USE_SH1106
#include <Adafruit_SH110X.h>
...
#else
#include <Adafruit_SSD1306.h>
...
#endif
```

`USE_SH1106` is not defined in the code. It comes from `firmware/platformio.ini`:

```ini
[env:oled_sh1106]
build_flags = ${env.build_flags} -DUSE_SH1106
```

`-DUSE_SH1106` is the compiler flag for `#define USE_SH1106`. So:

- `pio run` (default env `oled_sh1106`) → SH1106 code is compiled (your module).
- `pio run -e oled` → SSD1306 code is compiled.

The preprocessor removes the unused branch before the compiler sees it, so
the wrong library is never even linked.

**Why two chips matter:** both chips understand most of the same commands, but
the SSD1306 can take the whole screen in one 1024-byte stream ("horizontal
addressing mode"). The SH1106 cannot. It only has "page addressing mode", so
the driver must send 8 separate rows of 128 bytes. Use the SSD1306 driver on an
SH1106 and the data lands in the wrong place: you see noise. Details in
[display-ram.md §4](display-ram.md#4-how-the-bytes-get-into-the-chip).

---

## 3. Configuration constants (lines 39–50)

| Constant | Value | Meaning | Change it when… |
|----------|-------|---------|-----------------|
| `SCREEN_WIDTH/HEIGHT` | 128 × 64 | Visible pixels | you use a 128×32 module |
| `OLED_RESET` | -1 | No reset pin wired | you wire the module's RES pin to a GPIO |
| `OLED_ADDR` | `0x3C` | 7-bit I2C address | the scanner (`make scanner`) shows `0x3D` |
| `PIN_SDA/PIN_SCL` | 21 / 22 | ESP32 default I2C pins | you rewire. Any output-capable GPIO works, the ESP32 routes I2C through its GPIO matrix |
| `I2C_FREQ_HZ` | 400 kHz | Bus speed | see the note below |
| `SERIAL_BAUD` | 115200 | USB serial speed | must equal `monitor_speed` in `platformio.ini` |

`constexpr` means "a compile-time constant". It costs no RAM and the compiler
checks the type, which `#define` does not.

> **Note on the I2C clock.** The SH110X library changes the clock itself.
> Its constructor has two hidden parameters, `preclk = 400000` and
> `postclk = 100000`. During each `display()` call it switches to 400 kHz, and
> afterwards it drops back to 100 kHz. So `Wire.setClock(400000)` in `setup()`
> only holds until the first `display()`. To change the frame speed, pass the
> values to the constructor instead:
> `Adafruit_SH1106G display(128, 64, &Wire, -1, 400000, 400000);`

---

## 4. The `display` object (lines 53–57)

```cpp
Adafruit_SH1106G display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
```

This is a global object, built before `setup()` runs. The constructor only
stores the settings. It does **not** talk to the hardware and does **not**
allocate the framebuffer yet. That happens in `begin()`.

Class family (each one adds a layer):

```
Adafruit_GFX          shapes, text, fonts. Knows nothing about hardware.
                      Everything ends in one call: drawPixel(x, y, color)
  └─ Adafruit_GrayOLED  owns the framebuffer, implements drawPixel(),
                        sends commands (oled_command)
       └─ Adafruit_SH110X   display(): sends the buffer page by page
            └─ Adafruit_SH1106G  init sequence + the 2-column offset
```

`&Wire` is the address of the global `Wire` object, the ESP32's first
hardware I2C controller (`Wire1` is the second).

---

## 5. `setup()`, step by step (lines 87–107)

1. **`Serial.begin(115200)`**: starts the UART that goes through the USB chip
   to your PC. This is what `make monitor` shows.
2. **`pinMode(LED_BUILTIN, OUTPUT)`**: GPIO 2 on the DOIT DevKit V1. Used as
   the "something is wrong" light.
3. **`Wire.begin(21, 22)`**: connects the I2C peripheral to those two pins and
   turns on the internal pull-ups. (Most OLED modules also have their own
   pull-up resistors, which is what actually keeps the bus reliable.)
4. **`Serial.printf(...)` banner**: prints the build's assumptions so you can
   compare them with your wiring.
5. **`while (!initDisplay())`**: `begin()` does three things:
   - `malloc(1024)` for the framebuffer (only the first time),
   - checks that a device ACKs at `0x3C`,
   - sends the init command list (display off, clock, multiplex = 64 rows,
     charge pump, contrast, segment remap, COM scan direction, display on).
   It returns `false` if no device answers. The loop blinks the LED and
   retries every second, so a loose wire can be fixed without a reset.
6. **`showSplash()` + `delay(2000)`**.

## 6. `loop()` (lines 109–114)

Runs forever, once a second: draw a frame, print the counter, increment,
wait 1000 ms. `delay()` blocks the CPU. That is fine here. When you add
buttons or sensors, replace it with a `millis()` timer so the code can
do other work while it waits.

## 7. The drawing functions (lines 141–174)

Every frame follows the same three-step pattern:

```cpp
display.clearDisplay();   // 1. set all 1024 bytes of the framebuffer to 0
/* draw */                // 2. change bits in the framebuffer
display.display();        // 3. send the framebuffer over I2C
```

What each call in `drawFrame()` does to RAM:

| Call | Effect on the framebuffer |
|------|---------------------------|
| `setTextSize(1)` | No pixels. Sets a scale factor: built-in font is 5×8 in a 6×8 cell, ×1 |
| `setCursor(0, 0)` | No pixels. Moves the text cursor to the top-left |
| `println("ESP32 + OLED demo")` | For each character, looks up 5 bytes in the built-in font table and calls `drawPixel()` for every lit dot |
| `drawLine(0,10,127,10)` | 128 calls to `drawPixel(x, 10)`. Row 10 is page 1, bit 2 |
| `setTextSize(2)` | Every font dot becomes a 2×2 block, so the cell is 12×16 |
| `drawRect` / `fillRect` | Outline / solid rectangle made of pixels |
| `map(value % 10, 0, 9, 0, 124)` | Scales 0..9 to 0..124 px, so the bar fills over 10 s |

All of these end in `drawPixel()`, which does:

```cpp
buffer[x + (y / 8) * 128] |= (1 << (y & 7));   // WHITE: set one bit
```

That single line is the key to the whole display. It is explained in
[display-ram.md](display-ram.md).

---

## 8. Where to make changes

| You want to… | Change |
|--------------|--------|
| Show different text or layout | `drawFrame()`: `setCursor`, `setTextSize`, `print` |
| Use a nicer font | `#include <Fonts/FreeSans9pt7b.h>` then `display.setFont(&FreeSans9pt7b);` (the cursor y becomes the text **baseline**) |
| Draw a logo | Convert the image with image2cpp (see README), then `display.drawBitmap(x, y, logo, w, h, OLED_WHITE);` |
| Flip the screen | `display.setRotation(2);` (0–3, in 90° steps) |
| Dim the screen | `display.setContrast(0x20);` (0x00–0xFF) |
| Invert black/white | `display.invertDisplay(true);` (done by the chip, no buffer change) |
| Edit raw bytes | `uint8_t *buf = display.getBuffer();` see [display-ram.md §5](display-ram.md#5-accessing-the-framebuffer-directly) |
| Send a raw command | `display.oled_command(0xA7);` (SH1106) / `display.ssd1306_command(0xA7);` (SSD1306) |
| Faster updates | Raise `postclk` in the constructor (§3); only redraw what changed |
