// The OLED: an SH1106 (our 1.3" module) or an SSD1306, chosen at build time
// with -DUSE_SH1106. Everything else draws through gfx() (Adafruit GFX), so
// it does not care which controller is fitted.
#pragma once

#include <Adafruit_GFX.h>

namespace display {

constexpr int WIDTH = 128;
constexpr int HEIGHT = 64;
constexpr uint16_t ON = 1;   // pixel lit
constexpr uint16_t OFF = 0;  // pixel dark

// "SH1106" or "SSD1306", sent to the backend when the device registers.
const char *controllerName();

// Starts I2C and the controller. False when nothing answers at 0x3C.
bool begin();

Adafruit_GFX &gfx();
void clear();
void show();  // sends the RAM copy to the screen (~7 ms at 400 kHz)

void setBrightness(uint8_t value);  // 0..255
void setInverted(bool inverted);

}  // namespace display
