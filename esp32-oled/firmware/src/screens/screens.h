// Full-screen messages. Each draws into the display's RAM copy; the caller
// decides when to display::show().
#pragma once

#include <Arduino.h>

namespace screens {

// A title and up to two short lines (21 characters each fit at size 1).
void status(const char *title, const String &line1 = "", const String &line2 = "");

// The free device's invitation: QR of `url` on the left; device ID and the
// code (split XXXX / XXXX, large) on the right.
void pairing(const String &deviceId, const String &code, const String &url);

// Resting screen while the controller has not picked a mode.
void idle();

// Placeholder until phase 3 brings the music mode.
void music();

}  // namespace screens
