// The device's life, as a state machine (docs/plan/phase-1-foundation.md §4.4):
//
//   WIFI ─► no login saved? ─► REGISTERING ─► ok ─► CONNECTING ─► ONLINE
//                                  └─ error: SETUP_FAILED, retry in 60 s
//   CONNECTING / ONLINE ─► login refused 3 times ─► forget it, reboot, register again
//   ONLINE: pairing code present ─► pairing screen (ID, QR, code)
//           otherwise           ─► the current mode (idle, eyes, music)
//
// Every state has its own screen, so problems show without a laptop.
#pragma once

#include <Arduino.h>

namespace app {

void begin();
void tick();  // call from loop(); never blocks except while registering

}  // namespace app
