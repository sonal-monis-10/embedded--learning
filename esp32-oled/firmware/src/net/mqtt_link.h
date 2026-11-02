// MQTT over wss:// to the backend's Mosquitto (through Render's HTTPS port).
//
// esp-mqtt runs in its own FreeRTOS task. Its callbacks only copy events
// into a queue; the main loop drains it with poll(), so drawing never
// waits on the network and no state is shared between tasks.
//
// Topics (docs/plan/README.md §6), all under d/<deviceId>/:
//   status   device → backend, retained  {"online":true,"fw":…,"rssi":…}
//                                        Last Will {"online":false}
//   pairing  backend → device, retained  {"code","url","expiresAt"} or empty
//   mode     backend → device, retained  {"mode":"idle"|"eyes"|"music"}
//   imu      backend → device            [pitch, roll, accelG, seq]
//   cmd      backend → device            {"op":"identify"|"reboot"|"brightness",…}
#pragma once

#include <Arduino.h>

namespace mqtt_link {

enum class EventType : uint8_t { Connected, Disconnected, AuthRejected, Message };
enum class Topic : uint8_t { Pairing, Mode, Imu, Cmd, Other };

struct Event {
  EventType type;
  Topic topic;
  char payload[256];  // NUL-terminated; empty for a cleared retained message
};

void start(const String &deviceId, const String &secret);
bool poll(Event &out);  // false when the queue is empty

}  // namespace mqtt_link
