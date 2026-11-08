// The device's own login (ID + secret), kept in NVS flash across reboots.
// On first boot there is none: register() asks the backend for one with
// the PROVISION_KEY built into the firmware.
#pragma once

#include <Arduino.h>

namespace provision {

struct Credentials {
  String deviceId;  // oled-xxxxxx, also the MQTT username and client ID
  String secret;    // the MQTT password
};

bool load(Credentials &out);
void save(const Credentials &creds);
void forget();  // next boot registers as a new device

struct Result {
  bool ok;
  String error;  // short, fits on the OLED: "HTTP 409 device_limit"
};

// POST /api/admin/devices. Blocks up to ~70 s: a sleeping Render instance
// takes about a minute to wake up.
Result registerDevice(Credentials &out);

}  // namespace provision
