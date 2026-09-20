/* =============================================================================
 *  recovery.cpp — what to do when the line disappears
 * =============================================================================
 *  See recovery.h for the geometry and the reasoning behind each phase.
 * ========================================================================== */

#include <Arduino.h>
#include "config.h"
#include "pins.h"
#include "conversion.h"
#include "motors.h"
#include "sensors.h"
#include "control.h"
#include "recovery.h"

Phase g_phase = PHASE_TRACK;

static unsigned long g_phaseStartMs = 0;
static int g_pivotDirection = 1;

void recoveryReset() {
  g_phase = PHASE_TRACK;
  g_phaseStartMs = millis();
}

/* -----------------------------------------------------------------------------
 *  Phase entry.
 *
 *  Each of these does three things together: set the phase, start its clock,
 *  and issue the first motor command. Keeping them in one place means a
 *  transition cannot half-happen — there is no window where the phase has
 *  changed but the motors are still doing what the previous phase wanted.
 * -------------------------------------------------------------------------- */

static void enterAdvance() {
  g_phase = PHASE_ADVANCE;
  g_phaseStartMs = millis();
  const int base = cruiseDuty();
  setWheels(base, base);
  g_state = "lost:adv";
}

static void enterPivotA() {
  g_phase = PHASE_PIVOT_A;
  g_phaseStartMs = millis();

  /* Sweep toward wherever the line was last seen. g_lastSeenSide is kept
   * current by the steering layer on every frame that carries directional
   * information — and deliberately not updated on all-black frames, which
   * carry none. The >= 0 makes an unset value (0) sweep right rather than
   * being undefined. */
  g_pivotDirection = (g_lastSeenSide >= 0) ? 1 : -1;

  spinInPlace(g_pivotDirection);
  g_state = "lost:pivA";
}

static void enterPivotB() {
  g_phase = PHASE_PIVOT_B;
  g_phaseStartMs = millis();
  g_pivotDirection = -g_pivotDirection;
  spinInPlace(g_pivotDirection);
  g_state = "lost:pivB";
}

static void enterHalted() {
  g_phase = PHASE_HALTED;
  brakeWheels();
  g_state = "HALTED";
}

/* Return to normal following and immediately steer on the current frame, so
 * no cycle is wasted between reacquiring the line and acting on it. */
static void resumeTracking() {
  g_phase = PHASE_TRACK;
  followLine();
}

/* -----------------------------------------------------------------------------
 *  TRACK — following normally, and deciding what kind of loss just happened.
 *
 *  The gate on g_error is the important part. Note it uses the error from the
 *  LAST frame in which the line was visible, since the current frame has none.
 *
 *      small error at the moment of loss   ->  ran off the end of the tape at
 *                                              a corner; the axle is behind
 *                                              the junction, so advance first
 *
 *      large error at the moment of loss   ->  already well off the line;
 *                                              advancing would make it worse,
 *                                              so pivot immediately
 * -------------------------------------------------------------------------- */
static void handleTrack() {
  if (g_line.found) {
    followLine();
    return;
  }

  if (abs(g_error) <= ADVANCE_MAX_ERR) enterAdvance();
  else                                 enterPivotA();
}

/* -----------------------------------------------------------------------------
 *  ADVANCE — roll forward until the axle reaches the corner.
 *
 *  Any channel reacquiring is enough to exit here. If the line reappears
 *  during the advance, it was never really lost — a brief dropout, a scuff in
 *  the tape — and the current heading is still correct, so normal following
 *  resumes without a pivot.
 *
 *  That is a deliberate contrast with the pivot phases, which demand the
 *  CENTRE channel. The difference is what the robot is trying to establish: an
 *  advance is asking "is the line still there?", a pivot is asking "am I
 *  aligned with it?"
 * -------------------------------------------------------------------------- */
static void handleAdvance() {
  if (g_line.found) {
    resumeTracking();
    return;
  }

  if (millis() - g_phaseStartMs < advanceDurationMs()) {
    const int base = cruiseDuty();
    setWheels(base, base);
    g_state = "lost:adv";
    return;
  }

  enterPivotA();
}

/* -----------------------------------------------------------------------------
 *  PIVOT_A — sweep toward the last-seen side.
 * -------------------------------------------------------------------------- */
static void handlePivotA() {
  if (centreOnLine()) {
    resumeTracking();
    return;
  }

  if (millis() - g_phaseStartMs < PIVOT_TIMEOUT_MS) {
    spinInPlace(g_pivotDirection);
    g_state = "lost:pivA";
    return;
  }

  enterPivotB();
}

/* -----------------------------------------------------------------------------
 *  PIVOT_B — sweep the other way.
 *
 *  Given twice the budget, because it has to undo the whole of the first sweep
 *  before it covers any ground the first one did not. A symmetric timeout
 *  would give it only half as much genuinely new search as PIVOT_A got.
 * -------------------------------------------------------------------------- */
static void handlePivotB() {
  if (centreOnLine()) {
    resumeTracking();
    return;
  }

  if (millis() - g_phaseStartMs < PIVOT_TIMEOUT_MS * 2) {
    spinInPlace(g_pivotDirection);
    g_state = "lost:pivB";
    return;
  }

  enterHalted();
}

/* -----------------------------------------------------------------------------
 *  Dispatch.
 *
 *  Every branch below issues a motor command, including HALTED. A phase that
 *  returned without touching the motors would silently leave them running at
 *  whatever the previous frame commanded — which on a previous build produced
 *  a robot stuck mid-command with no error message and no motion.
 * -------------------------------------------------------------------------- */
void updateRecovery() {
  switch (g_phase) {
    case PHASE_TRACK:   handleTrack();   break;
    case PHASE_ADVANCE: handleAdvance(); break;
    case PHASE_PIVOT_A: handlePivotA();  break;
    case PHASE_PIVOT_B: handlePivotB();  break;
    case PHASE_HALTED:  brakeWheels(); g_state = "HALTED"; break;
  }
}