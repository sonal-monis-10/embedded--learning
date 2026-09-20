/* =============================================================================
 *  control.cpp — steering
 * =============================================================================
 *  See control.h for why this is a ladder rather than a PID controller.
 * ========================================================================== */

#include <Arduino.h>
#include "config.h"
#include "pins.h"
#include "conversion.h"
#include "motors.h"
#include "sensors.h"
#include "control.h"

int g_error = 0;
int g_lastSeenSide = 0;
const char *g_state = "boot";

/* Centre of the position scale: 2000 on a five-sensor array. */
static const int POSITION_CENTRE = (SENSOR_COUNT - 1) * 1000 / 2;

/* -----------------------------------------------------------------------------
 *  Turn by holding the wheel-speed DIFFERENCE fixed.
 *
 *  The naive approach is "outer = cruise + d, inner = cruise - d". It fails on
 *  this robot, because cruise sits only 11 counts above the stall floor: any
 *  meaningful d pushes the inner wheel below the floor, where it stalls
 *  instead of turning slowly. The turn then comes from one wheel driving and
 *  one wheel dead, which is neither the requested rate nor a repeatable one.
 *
 *  So: compute the pair, and if the inner wheel would fall through the floor,
 *  slide BOTH up by the shortfall. The difference — which is what actually
 *  sets turn rate — is preserved exactly. The robot turns at the requested
 *  rate while travelling slightly faster than cruise.
 *
 *  The symmetric clamp at the ceiling slides both down the same way, so the
 *  difference survives at the top of the range too.
 *
 *  Worked example on this robot, DIFF_NEAR_V = 0.90 V = 20 counts:
 *      outer = 99 + 10 = 109
 *      inner = 99 - 10 =  89
 *      inner (89) is above floor (88), no slide needed
 *      difference = 20   as requested
 *
 *  And with DIFF_FAR_V = 1.60 V = 35 counts:
 *      outer = 99 + 17 = 116
 *      inner = 99 - 17 =  82   below floor
 *      slide both up by 6:  outer 122, inner 88
 *      difference = 34   preserved (1 count lost to integer halving)
 * -------------------------------------------------------------------------- */
static void applyDifferential(float differentialVolts, bool turnRight,
                              const char *nameRight, const char *nameLeft) {
  const int base   = cruiseDuty();
  const int floorD = floorDuty();
  const int cap    = ceilingDuty();

  const int difference = dutyFor(differentialVolts);

  int outer = base + difference / 2;
  int inner = base - difference / 2;

  if (inner < floorD) {
    const int lift = floorD - inner;
    inner += lift;
    outer += lift;
  }
  if (outer > cap) {
    const int drop = outer - cap;
    outer -= drop;
    inner -= drop;
  }

  /* Last resort. Only reachable if the whole floor..ceiling band is narrower
   * than the requested difference, which means the pack has sagged so far that
   * the robot cannot both drive and steer. The difference is sacrificed to
   * keep the inner wheel turning rather than stalled. */
  if (inner < floorD) inner = floorD;

  g_state = turnRight ? nameRight : nameLeft;

  if (turnRight) setWheels(outer, inner);
  else           setWheels(inner, outer);
}

/* -----------------------------------------------------------------------------
 *  The ladder.
 *
 *  Five error magnitudes, five responses. Read from the extremes inward:
 *
 *      0     centred, drive straight
 *      500   gentle differential
 *      1000  firmer differential
 *      1500  brake the inner wheel outright
 *      2000  counter-rotate
 *
 *  The 1500 case brakes rather than slowing, because at that error the line is
 *  under a sensor two positions off centre and a mere speed difference will
 *  not bring it back quickly enough. Braking pins the inner wheel so the robot
 *  pivots about it — much tighter than any differential can achieve.
 *
 *  The 2000 case means the line is under an outer channel ONLY. The robot is
 *  nearly off the line; forward motion would carry it off entirely, so it
 *  stops translating and rotates on the spot until the line comes back.
 * -------------------------------------------------------------------------- */
static void applySteering(int error) {
  const int  magnitude = abs(error);
  const bool turnRight = (error > 0);

  if (magnitude <= ERROR_DEADBAND) {
    const int base = cruiseDuty();
    setWheels(base, base);
    g_state = "straight";
    return;
  }

  if (magnitude > 1500) {
    spinInPlace(turnRight ? 1 : -1);
    g_state = turnRight ? "spin R" : "spin L";
    return;
  }

  if (magnitude > 1000) {
    const int outer = min(cruiseDuty() + dutyFor(DIFF_FAR_V), ceilingDuty());
    if (turnRight) setWheels(outer, WHEEL_BRAKE);
    else           setWheels(WHEEL_BRAKE, outer);
    g_state = turnRight ? "hard R" : "hard L";
    return;
  }

  if (magnitude > 500) applyDifferential(DIFF_FAR_V,  turnRight, "turn R", "turn L");
  else                 applyDifferential(DIFF_NEAR_V, turnRight, "trim R", "trim L");
}

/* -----------------------------------------------------------------------------
 *  One frame of following.
 *
 *  The all-black case is handled here rather than passed to the ladder,
 *  because it carries no directional information at all — the position would
 *  compute to dead centre, which is indistinguishable from genuinely being
 *  centred. Creeping straight is the honest response: keep moving, do not
 *  pretend to know which way to steer, and let the caller decide by DURATION
 *  whether this is a stop bar or a passing corner blob.
 *
 *  Note that g_lastSeenSide is deliberately NOT updated in that branch. An
 *  all-black frame would otherwise overwrite good directional memory with
 *  noise, and that memory is what seeds the recovery sweep.
 * -------------------------------------------------------------------------- */
void followLine() {
  if (allChannelsBlack()) {
    const int base = cruiseDuty();
    setWheels(base, base);
    g_state = "all-black";
    return;
  }

  g_error = g_line.position - POSITION_CENTRE;

  if (g_error > 0)      g_lastSeenSide =  1;
  else if (g_error < 0) g_lastSeenSide = -1;

  applySteering(g_error);
}