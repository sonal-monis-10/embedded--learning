/* =============================================================================
 *  conversion.cpp — volts to PWM duty
 * =============================================================================
 *  See conversion.h for why this layer exists. Nothing here touches hardware
 *  or holds state; every function is a pure calculation on the constants in
 *  config.h.
 * ========================================================================== */

#include <Arduino.h>
#include "config.h"
#include "pins.h"
#include "conversion.h"

/* -----------------------------------------------------------------------------
 *  What actually reaches the motor.
 *
 *  The L298 is a Darlington bridge and swallows a fixed voltage regardless of
 *  duty, so the usable range is always less than the pack voltage. On this
 *  robot: 13.10 - 1.50 = 11.60 V.
 * -------------------------------------------------------------------------- */
float availableVolts() {
  return V_BATT_NOMINAL - V_DROP_L298;
}

/* -----------------------------------------------------------------------------
 *  The central conversion.
 *
 *      duty = 255 * V_target / V_avail
 *
 *  Three guards, each preventing a specific failure:
 *
 *  1. avail <= 0.1  -> return 0. Protects against a division by zero or a
 *     nonsense negative duty if V_BATT_NOMINAL is ever set below V_DROP_L298
 *     (a typo, or a pack measured while almost dead).
 *
 *  2. volts > V_MOTOR_MAX -> clamp. This is the last line of defence against
 *     over-driving the motor. Clamping the VOLTAGE rather than the resulting
 *     duty means the limit holds no matter what the pack voltage is: a request
 *     for 8 V becomes 6 V whether the pack is full or flat.
 *
 *  3. constrain(0, 255) -> the PWM peripheral's own range.
 *
 *  The + 0.5f rounds to nearest rather than truncating. At 0.0455 V per count
 *  a truncation is worth up to 0.045 V, which is small but free to avoid.
 * -------------------------------------------------------------------------- */
int dutyFor(float volts) {
  const float avail = availableVolts();
  if (avail <= 0.1f) return 0;
  if (volts > V_MOTOR_MAX) volts = V_MOTOR_MAX;
  return constrain((int)(PWM_MAX * volts / avail + 0.5f), 0, PWM_MAX);
}

/* Inverse, for reporting. Not used in the control path. */
float voltsFor(int duty) {
  return availableVolts() * (float)duty / (float)PWM_MAX;
}

/* -----------------------------------------------------------------------------
 *  The three operating speeds.
 *
 *  Each is a function rather than a constant because they all depend on
 *  availableVolts(). Should battery sensing ever be added, these would follow
 *  the live pack voltage with no other change to the firmware.
 * -------------------------------------------------------------------------- */

int ceilingDuty() {
  return dutyFor(V_MOTOR_MAX);
}

/* The stall floor.
 *
 * Note the ordering: dutyFor() first, then multiply by the margin. Doing it
 * the other way — dutyFor(V_START * START_MARGIN) — would give nearly the same
 * answer, but this way the margin is visibly a safety factor applied to a
 * measured duty rather than a fudge buried inside a voltage.
 *
 * Clamped to the ceiling so that a large margin on a sagging pack cannot push
 * the floor above the motor's rating. */
int floorDuty() {
  return constrain((int)(dutyFor(V_START) * START_MARGIN), 0, ceilingDuty());
}

int cruiseDuty() {
  return constrain(dutyFor(V_CRUISE), 0, ceilingDuty());
}

/* Spin is floored as well as capped. A pivot that falls below the stall
 * threshold does not rotate slowly — it does not rotate at all, and the robot
 * sits still while the state machine waits for a sensor reading that will
 * never come. */
int spinDuty() {
  return constrain(dutyFor(V_SPIN), floorDuty(), ceilingDuty());
}

/* -----------------------------------------------------------------------------
 *  Is there enough voltage left to work with?
 *
 *  If cruise has sagged to the floor, the robot can still drive straight but
 *  has no headroom left to slow the inner wheel for a turn. It would drive
 *  forward and fail to steer — which looks like a control bug rather than a
 *  flat battery. Better to refuse to start and say why.
 * -------------------------------------------------------------------------- */
bool supplyTooLow() {
  return cruiseDuty() <= floorDuty();
}

/* -----------------------------------------------------------------------------
 *  Corner geometry.
 *
 *  The sensor array sits SENSOR_AHEAD_MM in front of the wheel axle. When the
 *  array runs off the end of the tape at a corner, the axle is still short of
 *  the junction by that distance, minus half a tape width (the outgoing leg's
 *  centreline sits half a width back from the end of the incoming one).
 *
 *      90 - 70/2 = 55 mm
 *
 *  Rolling that far before pivoting puts the axle on the corner, so the robot
 *  rotates about the junction instead of about a point behind it.
 * -------------------------------------------------------------------------- */
float advanceDistanceMm() {
  return SENSOR_AHEAD_MM - LINE_WIDTH_MM / 2.0f;
}

/* Time to cover that distance.
 *
 * CAUTION: ROBOT_SPEED_MMPS is currently a measurement taken at duty 132, not
 * at the cruise duty this firmware uses. Until it is re-measured at cruise
 * speed, this duration is wrong — it will be too SHORT, because the robot is
 * actually travelling slower than the constant claims, so it will pivot before
 * reaching the corner.
 *
 * Note also the direction of the dependency: this is a fixed DISTANCE, so a
 * slower robot needs a LONGER time. If you reduce V_CRUISE, this value rises.
 * Getting that backwards is an easy mistake and produces corners that are
 * consistently cut short. */
unsigned long advanceDurationMs() {
  if (ROBOT_SPEED_MMPS < 1.0f) return 0;
  return (unsigned long)(advanceDistanceMm() / ROBOT_SPEED_MMPS * 1000.0f);
}