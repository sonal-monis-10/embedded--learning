// =============================================================================
//  I2C bus scanner — lists every device that answers on the bus
// =============================================================================
//
//  PURPOSE
//      A diagnostic tool, not part of the OLED app. It answers two questions
//      before you write any driver code:
//        1. Is the device wired correctly and powered?
//        2. What I2C address does it use?
//      Run it whenever a display or sensor stays silent, or when you connect
//      a new I2C part and need its address.
//
//  WHY IT LIVES IN tools/ AND NOT src/
//      It is a complete program with its own setup() and loop(). The app in
//      src/main.cpp has its own too, and one firmware image can only contain
//      one of each. The `scanner` environment in platformio.ini compiles only
//      this file; the OLED environments compile only src/.
//
//  USAGE
//      make scanner        (flash it and open the serial monitor)
//      Then flash the app again with `make oled` when you are done.
//
//  HOW IT WORKS
//      For each address 1..126 we start a transmission and immediately stop
//      it. A device with that address pulls SDA low to ACK; endTransmission()
//      then returns 0. Our SH1106 OLED shows up at 0x3C (some modules use
//      0x3D). No device found at all usually means SDA/SCL swapped, a missing
//      GND, or no power to the module.
// =============================================================================

#include <Arduino.h>
#include <Wire.h>

constexpr int PIN_SDA = 21;
constexpr int PIN_SCL = 22;

void setup() {
    Serial.begin(115200);
    Wire.begin(PIN_SDA, PIN_SCL);
    delay(500);
    Serial.println("\nI2C scanner");
}

void loop() {
    int found = 0;

    for (uint8_t addr = 1; addr < 127; addr++) {
        Wire.beginTransmission(addr);
        uint8_t err = Wire.endTransmission();

        if (err == 0) {
            Serial.printf("  device at 0x%02X\n", addr);
            found++;
        } else if (err == 4) {
            Serial.printf("  unknown error at 0x%02X\n", addr);
        }
    }

    if (found == 0) {
        Serial.println("  no devices found - check SDA/SCL, GND and power");
    } else {
        Serial.printf("  %d device(s) found\n", found);
    }

    delay(3000);
}
