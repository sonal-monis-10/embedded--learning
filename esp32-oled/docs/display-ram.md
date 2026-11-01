# Display RAM: what it is, how it is laid out, how to change it

This explains the memory that holds the picture, both in the ESP32 and in the
OLED chip, so you can draw anything by setting bytes yourself. It is also the
groundwork for stage 2 (writing our own driver).

Our module uses an **SH1106** controller. Where the SSD1306 is different, it is
marked. Datasheet sections are named so you can find them in the PDFs listed in
[README.md](README.md).

---

## 1. RAM on the ESP32 side

The ESP32 (WROOM-32 module on the DOIT DevKit V1) has:

| Memory | Size | What lives there |
|--------|------|------------------|
| Flash (external SPI chip) | 4 MB | Your compiled program, `const` data such as fonts and bitmaps |
| SRAM (inside the chip) | 520 KB total | Variables, stack, heap. Of this, roughly 300 KB is free for your program after Wi-Fi/BT/RTOS take their share |
| RTC memory | 8 KB + 8 KB | Survives deep sleep |

"RAM" here means SRAM: fast, read/write, **lost on power-off**.

The framebuffer is a 1024-byte block on the **heap**. `display.begin()`
allocates it with `malloc()` (see `Adafruit_GrayOLED::_init`). You get a
pointer to it with:

```cpp
uint8_t *buf = display.getBuffer();   // buf[0] .. buf[1023]
```

Check how much RAM is left at any time:

```cpp
Serial.printf("free heap: %u bytes\n", ESP.getFreeHeap());
```

Images you draw should be `const` (or `PROGMEM`) so they stay in flash and do
not use RAM: `static const uint8_t logo[] = { ... };`

---

## 2. Framebuffer layout: pages, columns, bits

The screen is 128 columns × 64 rows = 8192 pixels. One bit per pixel
(1 = lit, 0 = dark), so 8192 / 8 = **1024 bytes**.

The bytes are **not** stored row by row. The display is split into
**8 horizontal stripes called pages**, each 8 pixels tall. Inside a page,
**one byte = one vertical column of 8 pixels**, with **bit 0 at the top**.

```
            column x →
            0      1      2            127
          ┌──────┬──────┬──────┬─ ─ ─┬──────┐
 page 0   │ b[0] │ b[1] │ b[2] │     │b[127]│   rows y = 0..7
 (y 0-7)  │      │      │      │     │      │
          ├──────┼──────┼──────┼─ ─ ─┼──────┤
 page 1   │b[128]│b[129]│b[130]│     │b[255]│   rows y = 8..15
          ├──────┼──────┼──────┼─ ─ ─┼──────┤
   ...    │      │      │      │     │      │
          ├──────┼──────┼──────┼─ ─ ─┼──────┤
 page 7   │b[896]│b[897]│      │     │b[1023]│  rows y = 56..63
          └──────┴──────┴──────┴─ ─ ─┴──────┘

 Zoom into one byte, e.g. b[130] (page 1, column 2):

      bit 0  ■  y = 8      ← LSB is the TOP pixel
      bit 1  □  y = 9
      bit 2  ■  y = 10
      bit 3  □  y = 11
      bit 4  □  y = 12
      bit 5  □  y = 13
      bit 6  □  y = 14
      bit 7  ■  y = 15     ← MSB is the BOTTOM pixel

      value = 0b1000_0101 = 0x85
```

### The formula

For a pixel at `(x, y)`:

```
page  = y / 8          (integer divide: which stripe, 0..7)
bit   = y % 8          (same as y & 7: which bit in the byte, 0..7)
index = x + page * 128 (which byte in the buffer, 0..1023)
```

So:

```cpp
buf[x + (y / 8) * 128] |=  (1 << (y & 7));   // turn pixel ON  (OR sets a bit)
buf[x + (y / 8) * 128] &= ~(1 << (y & 7));   // turn pixel OFF (AND with inverted mask clears it)
buf[x + (y / 8) * 128] ^=  (1 << (y & 7));   // TOGGLE pixel   (XOR flips it)
bool on = buf[x + (y / 8) * 128] &  (1 << (y & 7));  // READ pixel
```

This is exactly what `Adafruit_GrayOLED::drawPixel()` does
(`.pio/libdeps/oled_sh1106/Adafruit GFX Library/Adafruit_GrayOLED.cpp`).

### Worked example

Pixel `(10, 20)`:
`page = 20 / 8 = 2`, `bit = 20 % 8 = 4`, `index = 10 + 2 * 128 = 266`.
So set bit 4 of `buf[266]`: `buf[266] |= 0x10;`

The line in `drawFrame()`, `drawLine(0, 10, 127, 10)`:
row 10 → page 1, bit 2 → bytes `buf[128]` to `buf[255]` each get `|= 0x04`.

### Why this odd layout?

Because the controller chip stores its own RAM this way (§3), and the
framebuffer is a byte-for-byte copy of it. No conversion is needed when
sending.

---

## 3. RAM on the OLED side: GDDRAM

GDDRAM = **Graphic Display Data RAM**, inside the controller chip. The panel
hardware scans it continuously and lights pixels where bits are 1.

| | SH1106 (ours) | SSD1306 |
|---|---|---|
| GDDRAM size | **132** columns × 8 pages | 128 columns × 8 pages |
| Panel width | 128 | 128 |
| Visible columns | **2 .. 129** (panel is centered) | 0 .. 127 |
| Addressing modes | Page mode only | Page, horizontal, vertical |

The SH1106 has 4 extra columns, and the 128-pixel panel is wired to the middle
of them. That is why the library sets `_page_start_offset = 2`
(`Adafruit_SH1106G.cpp`): framebuffer column 0 must go to GDDRAM column 2.
Forget the offset and the image is shifted 2 px with a garbage strip on the
edge.

Datasheet: SH1106, section "Graphic Display Data RAM (DDRAM)" and the page /
column address command descriptions. SSD1306, section 8.7 "Graphic Display
Data RAM (GDDRAM)" and 10.1.3 "Set Memory Addressing Mode".

---

## 4. How the bytes get into the chip

### I2C basics in one paragraph

Two wires: SCL (clock, driven by the ESP32) and SDA (data, both directions).
Every transfer starts with the device **address**. Ours is `0x3C` (7 bits);
on the wire it becomes `0x78` (address shifted left by 1, plus a 0 bit for
"write"). The OLED answers each byte with an **ACK**. `begin()` failing
means no ACK: wrong address, or a wire problem.

### Control byte: command or data?

After the address, the OLED needs to know if the next bytes are **commands**
(settings) or **data** (pixels). The first byte says which:

| Control byte | Following bytes are |
|--------------|---------------------|
| `0x00` | Commands |
| `0x40` | Display data (written to GDDRAM) |

### What `display()` sends (SH1106)

For each page `p` from 0 to 7 (`Adafruit_SH110X::display()`):

```
[START] 0x78  0x00  0xB0+p  0x10+(col>>4)  0x00+(col&0x0F)  [STOP]   ← commands
                    │       │              └ column, low 4 bits
                    │       └ column, high 4 bits
                    └ "set page address" = page p

[START] 0x78  0x40  byte byte byte ... (up to 127 bytes)    [STOP]   ← pixel data
[START] 0x78  0x40  ... remaining bytes of this page        [STOP]
```

with `col = 0 + 2` (the offset). The chip writes each data byte at the current
column and moves the column pointer right by one. At the end of a page it does
**not** move to the next page by itself, which is why the driver must re-send
the page address 8 times.

Data goes in chunks because the ESP32 `Wire` library buffer is 128 bytes
(`I2C_BUFFER_LENGTH`), minus 1 for the control byte.

The SSD1306 driver can instead set "horizontal addressing mode"
(`0x20 0x00`), where the pointer wraps to the next page by itself, and stream
all 1024 bytes after one header. The SH1106 ignores that command, which is why
the SSD1306 driver shows noise on our module.

### Dirty window

The SH110X library tracks the smallest rectangle that changed since the last
`display()` (`window_x1..x2`, `window_y1..y2`). It only sends those columns,
starting at the first changed page. `clearDisplay()` marks the whole screen
dirty, so `drawFrame()` always sends everything.

---

## 5. Accessing the framebuffer directly

`getBuffer()` gives you the raw array. Use it for fast fills, custom effects,
or to test your understanding of the layout.

```cpp
void rawDemo() {
    display.clearDisplay();             // zeros + marks whole screen dirty (see warning)
    uint8_t *buf = display.getBuffer();

    // 1. A horizontal line across the top of page 3 (row y = 24):
    for (int x = 0; x < 128; x++) buf[x + 3 * 128] |= 0x01;

    // 2. Fill all of page 7 (bottom 8 rows) solid:
    memset(buf + 7 * 128, 0xFF, 128);

    // 3. Vertical stripes: every other column on page 0
    for (int x = 0; x < 128; x += 2) buf[x] = 0xFF;

    // 4. Checkerboard of single pixels on page 1
    for (int x = 0; x < 128; x++) buf[x + 128] = (x & 1) ? 0xAA : 0x55;

    display.display();
}
```

**Warning: the dirty window.** Writing into `buf[]` does not update the dirty
window (only `drawPixel()` and `clearDisplay()` do). If you write raw bytes
without calling `clearDisplay()` first in the same frame, `display()` may skip
your changes. Fix: call `clearDisplay()` at the start of the frame, as above,
or mark the corners dirty:
`display.drawPixel(0, 0, display.getPixel(0, 0));` and the same for
`(127, 63)`.

**Warning: rotation.** `setRotation()` only changes how `drawPixel()` maps
`(x, y)`. The buffer layout is always the physical one described in §2.

### Drawing your own image

`drawBitmap()` expects a **different** layout: row by row, 8 horizontal pixels
per byte, MSB on the left. image2cpp (see README) can produce either:

- "Horizontal, 1 bit per pixel" → use with `display.drawBitmap(...)`.
- "Vertical, 1 bit per pixel" → this is the page layout from §2. A full
  128×64 image in this format can be copied straight in:
  `memcpy(display.getBuffer(), myImage, 1024);` (after `clearDisplay()`).

---

## 6. Commands you can send yourself

Send with `display.oled_command(c)` (SH1106) or
`display.ssd1306_command(c)` (SSD1306). Some take a second byte: send it with
another `oled_command()` call.

| Command | Bytes | Effect |
|---------|-------|--------|
| Display off / on | `0xAE` / `0xAF` | Panel dark, GDDRAM kept. Useful to save power |
| Contrast | `0x81`, then `0x00..0xFF` | Brightness. Same as `setContrast()` |
| Normal / inverse | `0xA6` / `0xA7` | Swap black and white in hardware |
| Entire display on | `0xA5` (back: `0xA4`) | All pixels lit, ignores RAM. Good hardware test |
| Segment remap | `0xA0` / `0xA1` | Mirror left-right |
| COM scan direction | `0xC0` / `0xC8` | Mirror top-bottom |
| Display start line | `0x40 + n` (n = 0..63) | Which GDDRAM row is shown at the top. Changing it smoothly gives vertical scrolling without redrawing |
| Display offset | `0xD3`, then `0..63` | Shifts the picture vertically |
| Page address | `0xB0 + p` (p = 0..7) | Where the next data byte goes (page) |
| Column address | `0x10 + hi`, `0x00 + lo` | Where the next data byte goes (column, 0..131) |

Example: a 180° flip done in hardware, no buffer change:

```cpp
display.oled_command(0xA0);  // mirror left-right
display.oled_command(0xC0);  // mirror top-bottom
```

(With the SH1106, mirroring left-right makes the 2-column offset land on the
other side, so the image may shift. `setRotation(2)` is the safer software
alternative.)

The full init sequence the library sends is in `Adafruit_SH1106G::begin()`,
with each byte commented. Reading it next to the SH1106 datasheet's command
table is the best exercise before writing your own driver.

---

## 7. Stage 2 preview: the minimum your own driver needs

1. `Wire.beginTransmission(0x3C)`, write `0x00` + init commands, `endTransmission()`.
2. Keep your own `uint8_t fb[1024]`.
3. Your `setPixel(x, y)` = the formula in §2.
4. Your `flush()` = for each page: send `0x00, 0xB0+p, 0x10, 0x02`
   (column 2), then `0x40` + 128 data bytes, split into chunks under 128 bytes.

That's the whole driver. Everything else (text, lines, shapes) is drawing
into `fb[]`.
