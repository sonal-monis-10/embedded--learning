#include "display.h"

#include <Wire.h>

#ifdef USE_SH1106
#include <Adafruit_SH110X.h>
#else
#include <Adafruit_SSD1306.h>
#endif

namespace display {
namespace {

constexpr uint8_t I2C_ADDR = 0x3C;  // some modules use 0x3D: run `make scanner`
constexpr int PIN_SDA = 21;
constexpr int PIN_SCL = 22;
constexpr uint32_t I2C_FREQ_HZ = 400000;
constexpr int NO_RESET_PIN = -1;

#ifdef USE_SH1106
Adafruit_SH1106G screen(WIDTH, HEIGHT, &Wire, NO_RESET_PIN);
#else
Adafruit_SSD1306 screen(WIDTH, HEIGHT, &Wire, NO_RESET_PIN);
#endif

}  // namespace

const char *controllerName() {
#ifdef USE_SH1106
  return "sh1106";
#else
  return "ssd1306";
#endif
}

bool begin() {
  Wire.begin(PIN_SDA, PIN_SCL);
#ifdef USE_SH1106
  bool ok = screen.begin(I2C_ADDR, true);
#else
  bool ok = screen.begin(SSD1306_SWITCHCAPVCC, I2C_ADDR);
#endif
  // The libraries' begin() drops the bus back to 100 kHz; raise it after.
  Wire.setClock(I2C_FREQ_HZ);
  if (ok) {
    screen.clearDisplay();
    screen.display();
  }
  return ok;
}

Adafruit_GFX &gfx() { return screen; }

void clear() { screen.clearDisplay(); }

void show() { screen.display(); }

void setBrightness(uint8_t value) {
#ifdef USE_SH1106
  screen.setContrast(value);
#else
  screen.ssd1306_command(SSD1306_SETCONTRAST);
  screen.ssd1306_command(value);
#endif
}

void setInverted(bool inverted) { screen.invertDisplay(inverted); }

}  // namespace display
