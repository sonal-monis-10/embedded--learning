/* =============================================================================
 *  main.cpp — line follower
 * =============================================================================
 *  Build and run:   make robot
 *
 *  OPERATION — NO INPUT REQUIRED
 *  -----------------------------
 *      power on          -> WAITING, motors off, watching for a line
 *      place on the line -> starts immediately
 *      all five black    -> FINISHED, brakes held
 *      lift clear        -> back to WAITING
 *
 *  The console exists for diagnosis but nothing requires it. 'i' is always an
 *  emergency stop.
 *
 *  THE LOOP
 *  --------
 *      read input -> sense -> act -> report -> pace
 *
 *  Sensing happens ONCE per cycle and every consumer reads the same frame, so
 *  no two decisions within a cycle can disagree about what was observed.
 *
 *  THE ALL-BLACK PROBLEM
 *  ---------------------
 *  All five channels reading black is used as the stop signal, but it also
 *  happens innocently: parked square on the tape, crossing a corner blob, or
 *  the array lifted out of sensing range. A single frame cannot tell these
 *  apart. Two mechanisms separate them.
 *
 *  DURATION. A real stop bar gives several hundred milliseconds at cruise; a
 *  corner transient gives tens. ALL_BLACK_STOP_MS sits between.
 *
 *  AN ARMING LATCH. The stop detector stays inert until a clean, non-all-black
 *  line has been seen during this run. Without it, starting while parked on
 *  the tape would trigger a stop ALL_BLACK_STOP_MS later, every single time.
 *
 *  Note that ALL_BLACK_STOP_MS encodes a DISTANCE, not really a time. If you
 *  change V_CRUISE, it must change inversely — a slower robot takes LONGER to
 *  cross the same bar, so the timeout goes UP. Getting that backwards makes
 *  the robot halt at corners instead of turning them.
 * ========================================================================== */

#include <Arduino.h>
#include "config.h"
#include "pins.h"
#include "conversion.h"
#include "motors.h"
#include "sensors.h"
#include "control.h"
#include "recovery.h"
#include "telemetry.h"

/* =============================================================================
 *  MODES
 *
 *  WAITING   motors off, watching for a line. Entered on boot.
 *  FOLLOWING the recovery state machine is running.
 *  FINISHED  stopped on an armed, debounced all-black. Brakes held.
 *  IDLE      manual stop, console only.
 * ========================================================================== */

enum Mode { MODE_WAITING, MODE_FOLLOWING, MODE_FINISHED, MODE_IDLE };
static Mode g_mode = MODE_WAITING;

static unsigned long g_lineSeenSinceMs = 0;
static bool g_lineSeen = false;

static unsigned long g_clearSinceMs = 0;
static bool g_clearActive = false;

/* All-black stop state. Both are needed — see the header. */
static bool g_stopArmed = false;
static bool g_allBlackActive = false;
static unsigned long g_allBlackSinceMs = 0;

/* Loop timing, for telemetry. A rising peak is the clearest early warning that
 * something is blocking the control loop. */
float g_loopMs = 0;
float g_loopMsPeak = 0;
unsigned long g_loopCount = 0;

/* =============================================================================
 *  MODE TRANSITIONS
 * ========================================================================== */

static void enterWaiting() {
  g_mode = MODE_WAITING;
  g_lineSeen = false;
  g_clearActive = false;
  g_allBlackActive = false;
  g_stopArmed = false;
  recoveryReset();
  coastWheels();
  g_state = "waiting";
  telemetryEvent("WAITING: place the robot on the line.");
}

static void enterFollowing() {
  g_mode = MODE_FOLLOWING;
  g_allBlackActive = false;

  /* Disarmed deliberately. The robot may be starting while parked on tape wide
   * enough to read all-black, and that must not be mistaken for a stop bar. */
  g_stopArmed = false;

  g_error = 0;
  recoveryReset();
  telemetryFollowing();
}

static void enterFinished() {
  g_mode = MODE_FINISHED;
  g_clearActive = false;
  brakeWheels();
  g_state = "FINISHED";
  telemetryEvent("FINISHED: stop bar detected. Lift clear to re-arm.");
}

static void enterIdle() {
  g_mode = MODE_IDLE;
  recoveryReset();
  coastWheels();
  g_state = "idle";
}

/* =============================================================================
 *  MODE HANDLERS
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 *  WAITING — watch for a line, then start.
 *
 *  The condition is just "something detected", NOT "a clean non-all-black
 *  line". That distinction matters: at this ride height the array parked on
 *  70 mm tape can read all five channels black, so requiring a clean pattern
 *  here would leave the robot waiting forever on its own starting position.
 *  The all-black stop is protected by its arming latch instead.
 * -------------------------------------------------------------------------- */
static void updateWaiting() {
  coastWheels();
  g_error = g_line.found ? (g_line.position - (SENSOR_COUNT - 1) * 1000 / 2) : 0;

  if (supplyTooLow()) {
    g_state = "low battery";
    g_lineSeen = false;
    return;
  }

  if (!g_line.found) {
    g_lineSeen = false;
    g_state = "waiting";
    return;
  }

  if (!g_lineSeen) {
    g_lineSeen = true;
    g_lineSeenSinceMs = millis();
  }

  if (millis() - g_lineSeenSinceMs >= LINE_HOLD_MS) {
    enterFollowing();
    return;
  }

  g_state = "arming";
}

/* -----------------------------------------------------------------------------
 *  FOLLOWING — run the recovery machine, plus the all-black stop test.
 *
 *  The stop test lives here rather than inside the control layer so that the
 *  decision to stop sits at the top level, next to the mode change it causes,
 *  instead of being buried three calls deep in the steering path.
 * -------------------------------------------------------------------------- */
static void updateFollowing() {
  if (allChannelsBlack()) {
    if (!g_stopArmed) {
      /* No clean line seen yet this run, so this is the starting position or a
       * lifted array — not a finish line. Creep straight and keep looking. */
      const int base = cruiseDuty();
      setWheels(base, base);
      g_state = "ab:unarmed";
      g_allBlackActive = false;
      return;
    }

    if (!g_allBlackActive) {
      g_allBlackActive = true;
      g_allBlackSinceMs = millis();
    }

    if (millis() - g_allBlackSinceMs >= ALL_BLACK_STOP_MS) {
      enterFinished();
      return;
    }

    /* Armed but not yet confirmed. Creep straight while the debounce runs —
     * stopping now and resuming if it turns out to be a corner would be far
     * worse than continuing for another 150 ms. */
    const int base = cruiseDuty();
    setWheels(base, base);
    g_state = "all-black";
    return;
  }

  /* A clean, non-all-black frame. From here on, an all-black reading really
   * does mean a bar rather than a starting position. */
  g_allBlackActive = false;
  g_stopArmed = true;

  updateRecovery();
}

/* -----------------------------------------------------------------------------
 *  FINISHED — stay stopped until lifted clear, then re-arm.
 *
 *  Requiring "nothing detected" rather than a keypress means the whole cycle
 *  is hands-on-robot: it stops on the bar, you pick it up, you put it back on
 *  the line, it goes again.
 * -------------------------------------------------------------------------- */
static void updateFinished() {
  brakeWheels();
  g_state = "FINISHED";

  if (!nothingDetected()) {
    g_clearActive = false;
    return;
  }

  if (!g_clearActive) {
    g_clearActive = true;
    g_clearSinceMs = millis();
  }

  if (millis() - g_clearSinceMs >= RE_ARM_CLEAR_MS) enterWaiting();
}

/* -----------------------------------------------------------------------------
 *  IDLE — manual stop.
 *
 *  Still computes the error, so sensor response can be checked by hand without
 *  arming the motors. Useful for confirming a repair without a full run.
 * -------------------------------------------------------------------------- */
static void updateIdle() {
  coastWheels();
  g_state = "idle";
  g_error = g_line.found ? (g_line.position - (SENSOR_COUNT - 1) * 1000 / 2) : 0;
}

/* =============================================================================
 *  CONSOLE
 *
 *  Optional throughout, but always compiled: 'i' is the emergency stop and
 *  must work even in a build with telemetry disabled.
 * ========================================================================== */

static void handleCommand(char c) {
  switch (c) {
    case 'i':
      enterIdle();
      telemetryEvent("Idle. Press 'w' to resume automatic operation.");
      break;

    case 'w':
      enterWaiting();
      break;

    case 'r':
      telemetryReport();
      break;

    case 's':
      telemetryToggleStream();
      break;

    case 'h':
      telemetryHelp();
      break;

    default:
      break;
  }
}

static void pollConsole() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c > ' ') handleCommand(c);   /* ignore CR, LF, spaces */
  }
}

/* =============================================================================
 *  ENTRY POINTS
 * ========================================================================== */

void setup() {
  Serial.begin(115200);
  delay(300);

  sensorsBegin();
  motorsBegin();
  coastWheels();

  telemetryBegin();
  enterWaiting();
}

/* -----------------------------------------------------------------------------
 *  One control cycle.
 *
 *  Measure elapsed time, take input, sense once, act, report, pace.
 *
 *  The loop period is deliberately short. The sampling limit is
 *      omega_max = sensor_spot / (samples_needed * loop_period * radius)
 *  and at 4 ms a fast in-place spin can outrun the sensors, so the robot
 *  rotates past the line without ever seeing it. At 1 ms there is margin
 *  across the whole usable speed range.
 *
 *  The peak loop time is tracked because anything that blocks — a long serial
 *  write, most commonly — shows up there first, long before it becomes visible
 *  as erratic driving.
 * -------------------------------------------------------------------------- */
void loop() {
  static unsigned long previousUs = micros();
  const unsigned long nowUs = micros();
  const unsigned long periodUs = nowUs - previousUs;
  previousUs = nowUs;

  g_loopMs = periodUs / 1000.0f;
  if (g_loopCount > 200 && g_loopMs > g_loopMsPeak) g_loopMsPeak = g_loopMs;
  g_loopCount++;

  pollConsole();
  sampleSensors();

  switch (g_mode) {
    case MODE_WAITING:   updateWaiting();   break;
    case MODE_FOLLOWING: updateFollowing(); break;
    case MODE_FINISHED:  updateFinished();  break;
    case MODE_IDLE:      updateIdle();      break;
  }

  telemetryUpdate();

  delay(LOOP_PERIOD_MS);
}