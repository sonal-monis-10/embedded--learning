#include "screens.h"

#include <qrcode.h>  // ESP-IDF's QR encoder (components/qrcode)

#include "display.h"

namespace screens {
namespace {

using display::OFF;
using display::ON;

constexpr int CHAR_W = 6;  // the GFX built-in font at size 1, with spacing
constexpr int QR_AREA = 64;  // the left half of the screen

void text(int x, int y, const String &value, uint8_t size = 1) {
  Adafruit_GFX &g = display::gfx();
  g.setTextSize(size);
  g.setTextColor(ON);
  g.setCursor(x, y);
  g.print(value);
}

void centred(int y, const String &value, uint8_t size = 1) {
  int width = value.length() * CHAR_W * size;
  text((display::WIDTH - width) / 2, y, value, size);
}

// esp_qrcode_generate() calls this while it still holds the encoded code.
void drawQr(esp_qrcode_handle_t qr) {
  Adafruit_GFX &g = display::gfx();
  int modules = esp_qrcode_get_size(qr);
  // Version 3 (29 modules) fits at 2 px; anything larger drops to 1 px.
  int scale = modules * 2 <= QR_AREA - 4 ? 2 : 1;
  int offset = (QR_AREA - modules * scale) / 2;

  // A lit square with dark modules, like ink on paper: the quiet zone
  // around the code is the lit border.
  g.fillRect(0, 0, QR_AREA, QR_AREA, ON);
  for (int y = 0; y < modules; y++) {
    for (int x = 0; x < modules; x++) {
      if (esp_qrcode_get_module(qr, x, y)) {
        g.fillRect(offset + x * scale, offset + y * scale, scale, scale, OFF);
      }
    }
  }
}

}  // namespace

void status(const char *title, const String &line1, const String &line2) {
  display::clear();
  centred(12, title);
  display::gfx().drawFastHLine(24, 24, display::WIDTH - 48, ON);
  centred(32, line1);
  centred(44, line2);
}

void pairing(const String &deviceId, const String &code, const String &url) {
  display::clear();

  esp_qrcode_config_t cfg = ESP_QRCODE_CONFIG_DEFAULT();
  cfg.display_func = drawQr;
  cfg.max_qrcode_version = 4;
  cfg.qrcode_ecc_level = ESP_QRCODE_ECC_LOW;
  esp_qrcode_generate(&cfg, url.c_str());

  // Right half: "oled-" / "abc123", then the code large on two lines.
  constexpr int x = QR_AREA + 4;
  int dash = deviceId.indexOf('-');
  text(x, 0, deviceId.substring(0, dash + 1));
  text(x, 9, deviceId.substring(dash + 1));
  text(x, 28, code.substring(0, 4), 2);
  text(x, 46, code.substring(4), 2);
}

void idle() {
  display::clear();
  Adafruit_GFX &g = display::gfx();
  // Two closed eyes, resting.
  g.fillRoundRect(16, 30, 36, 4, 2, ON);
  g.fillRoundRect(76, 30, 36, 4, 2, ON);
  centred(52, "pick a mode");
}

void music() {
  status("Music", "coming in phase 3");
}

}  // namespace screens
