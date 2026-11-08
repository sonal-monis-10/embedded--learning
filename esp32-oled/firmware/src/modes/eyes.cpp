#include "eyes.h"

#include "display.h"

namespace eyes {
namespace {

constexpr int EYE_W = 36;
constexpr int EYE_H = 36;
constexpr int RADIUS = 8;
constexpr int LEFT_X = 32;  // eye centres
constexpr int RIGHT_X = 96;
constexpr int CENTRE_Y = 32;

constexpr float MAX_DX = 18;   // px the eyes travel sideways
constexpr float MAX_DY = 12;   // px up or down
constexpr float FULL_TILT = 40;  // degrees of tilt for full travel
constexpr float EASE = 0.25f;    // fraction of the remaining distance per frame

constexpr uint32_t QUIET_MS = 2000;  // no readings this long: start wandering

float x = 0, y = 0;              // current offset
float targetX = 0, targetY = 0;  // where the eyes are heading
uint32_t lastReadingMs = 0;
uint32_t nextWanderMs = 0;

float scaled(float degrees, float travel) {
  return constrain(degrees / FULL_TILT, -1.0f, 1.0f) * travel;
}

void wander(uint32_t nowMs) {
  if (nowMs < nextWanderMs) return;
  // Mostly glance around the middle, sometimes back to centre.
  bool centre = random(4) == 0;
  targetX = centre ? 0 : random(-MAX_DX, MAX_DX + 1);
  targetY = centre ? 0 : random(-MAX_DY / 2, MAX_DY / 2 + 1);
  nextWanderMs = nowMs + random(1500, 3500);
}

void drawEye(int centreX) {
  int left = centreX + static_cast<int>(x) - EYE_W / 2;
  int top = CENTRE_Y + static_cast<int>(y) - EYE_H / 2;
  display::gfx().fillRoundRect(left, top, EYE_W, EYE_H, RADIUS, display::ON);
}

}  // namespace

void look(float pitchDeg, float rollDeg, uint32_t nowMs) {
  targetX = scaled(rollDeg, MAX_DX);
  targetY = scaled(pitchDeg, MAX_DY);
  lastReadingMs = nowMs;
}

void draw(uint32_t nowMs) {
  if (nowMs - lastReadingMs > QUIET_MS) wander(nowMs);

  x += (targetX - x) * EASE;
  y += (targetY - y) * EASE;

  display::clear();
  drawEye(LEFT_X);
  drawEye(RIGHT_X);
}

}  // namespace eyes
