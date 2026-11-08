// Robot eyes that look where the phone tilts.
//
// Readings set a target; every frame the eyes move a fraction of the way
// there, so network jitter (readings arrive 30/s, unevenly, ~150 ms late)
// shows as smooth motion. Without readings for 2 s the eyes wander.
#pragma once

#include <Arduino.h>

namespace eyes {

// pitch: tilting toward / away from you; roll: left / right, in degrees.
void look(float pitchDeg, float rollDeg, uint32_t nowMs);

// Advances the motion and draws one frame.
void draw(uint32_t nowMs);

}  // namespace eyes
