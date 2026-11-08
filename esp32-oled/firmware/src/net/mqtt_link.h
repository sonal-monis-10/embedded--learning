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
//   music/track  backend → device, retained  {"id","title","artist","durationMs","lyrics","hasLyrics"}
//   music/lines  backend → device, retained  "#<id>\n<ms>\t<text>\n…" (plain text, up to 15 KB)
//   music/sync   backend → device, retained  {"id","pos","playing","at"}
#pragma once

#include <Arduino.h>

namespace mqtt_link {

enum class EventType : uint8_t { Connected, Disconnected, AuthRejected, Message };
enum class Topic : uint8_t { Pairing, Mode, Imu, Cmd, MusicTrack, MusicLines, MusicSync, Other };

struct Event {
  EventType type;
  Topic topic;
  char payload[256];      // NUL-terminated; empty for a cleared retained message
  char *large = nullptr;  // messages that don't fit in payload (the lyrics), on the heap
  const char *text() const { return large ? large : payload; }
};

// Frees an event's heap copy once it has been handled.
void release(Event &event);

void start(const String &deviceId, const String &secret);
bool poll(Event &out);  // false when the queue is empty

}  // namespace mqtt_link
