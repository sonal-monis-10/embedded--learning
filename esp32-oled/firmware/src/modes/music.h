// Music mode (docs/plan/phase-3-music.md). The ESP32 plays no audio: the
// visitor plays the song on their phone, and the backend keeps the song's
// clock. This module keeps a local copy of that clock and draws either the
// lyrics in time with the song, or a spinning disc with the progress.
//
// Fed by three retained MQTT messages (see net/mqtt_link.h): music/track,
// music/lines and music/sync. Each carries the song ID; pieces from
// another song are ignored. An empty message clears that piece.
#pragma once

#include <Arduino.h>

namespace music {

void onTrack(const char *payload);
void onLines(const char *payload);
void onSync(const char *payload, uint32_t nowMs);

void draw(uint32_t nowMs);

}  // namespace music
