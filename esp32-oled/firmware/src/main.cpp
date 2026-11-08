// esp32-oled firmware: registers itself with the backend on first boot,
// shows a pairing QR, and moves robot eyes as the paired phone tilts.
//
// Settings (Wi-Fi, backend URLs, PROVISION_KEY) come from firmware.env at
// build time, through scripts/gen_config.py. See app.h for the states.

#include <Arduino.h>

#include "app.h"
#include "display.h"

constexpr uint32_t SERIAL_BAUD = 115200;  // matches monitor_speed
constexpr int STATUS_LED = 2;

void setup() {
  Serial.begin(SERIAL_BAUD);
  pinMode(STATUS_LED, OUTPUT);

  if (!display::begin()) {
    // No screen to explain it on: blink the LED and say so on serial.
    Serial.println("[main] no OLED at 0x3C: check wiring, run `make scanner`");
    while (true) {
      digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
      delay(250);
    }
  }
  app::begin();
}

void loop() {
  app::tick();
  delay(1);  // let other tasks on this core run
}
