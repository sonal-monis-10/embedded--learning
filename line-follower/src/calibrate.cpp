/* =============================================================================
 *  calibrate.cpp — HARDWARE MEASUREMENT TOOL
 * =============================================================================
 *  This is NOT the line follower. It is a standalone program whose only job is
 *  to measure the physical properties of one specific robot, so that the real
 *  firmware can be built from measured numbers instead of assumed ones.
 *
 *  Build and run:   make cal
 *
 *  ---------------------------------------------------------------------------
 *  WHY IT IS A SEPARATE PROGRAM
 *  ---------------------------------------------------------------------------
 *  The main firmware commands speeds in VOLTS, converting to PWM duty with
 *
 *      duty = 255 * V_target / (V_batt - V_drop)
 *
 *  That only works once V_batt, V_drop and the start threshold are known — and
 *  producing those numbers is precisely this tool's job. If the tool converted
 *  the same way, measuring the start threshold would require already knowing
 *  the start threshold.
 *
 *  So THIS TOOL WORKS ENTIRELY IN RAW DUTY (0..255). It commands a duty, you
 *  observe the result or read a multimeter, and you convert to volts by hand
 *  afterwards. That makes it immune to a wrong config.h, which matters because
 *  a wrong config.h is the exact situation you use it in.
 *
 *  It shares only pins.h with the firmware, because pin numbers are wiring
 *  facts both programs must agree on. Everything else is deliberately
 *  self-contained, even where that duplicates code.
 *
 *  ---------------------------------------------------------------------------
 *  SENSORS ARE DIGITAL
 *  ---------------------------------------------------------------------------
 *  This module has a potentiometer, which means it carries a comparator and
 *  outputs clean logic levels rather than a varying voltage. So we use
 *  digitalRead(), and there is no software threshold to set.
 *
 *  The consequence: THAT POT IS YOUR ONLY SENSITIVITY ADJUSTMENT. If a channel
 *  misreads, the fix is turning the pot, not editing a constant.
 *
 *  ---------------------------------------------------------------------------
 *  HOW TO USE
 *  ---------------------------------------------------------------------------
 *    1. Fill in the estimates below. Rough is fine — they only set a safety
 *       ceiling so the tool cannot over-drive the motors.
 *    2. Flash with `make cal`. The menu prints on boot.
 *    3. Press a number key to run a test. 'h' reprints the menu.
 *    4. SPACE or 'x' stops everything immediately, in any test.
 *    5. Work through the tests IN ORDER — later ones depend on earlier ones.
 *    6. Write every result down. This tool stores nothing.
 *
 *  ---------------------------------------------------------------------------
 *  TEST ORDER AND DEPENDENCIES
 *  ---------------------------------------------------------------------------
 *    1  sensor response      which channels work, which end is left   needs -
 *    2  sensor polarity      which logic level means "on the line"    needs 1
 *    3  battery, no load     multimeter only                          needs -
 *    4  motor identification which channel drives which wheel         needs 3
 *    5  motor direction      does positive duty drive forward         needs 4
 *    6  battery under load   pack voltage while motors run            needs 4
 *    7  bridge drop          supply minus motor terminals             needs 6
 *    8  start threshold      lowest duty each wheel turns at        needs 6,7
 *    9  straight-line trim   lateral drift over a measured run      needs 5,8
 *   10  chassis speed        distance covered in a timed run          needs 8
 *
 *  Geometry is measured with a ruler and needs no code. See the end of file.
 * ========================================================================== */

#include <Arduino.h>
#include "pins.h"

/* =============================================================================
 *  FILL THESE IN BEFORE FLASHING
 * -----------------------------------------------------------------------------
 *  These exist ONLY to compute a safety ceiling, so tests 4, 5 and 6 — which
 *  run before the real voltages are known — cannot over-drive the motors.
 * ========================================================================== */

/* Pack voltage, roughly, nothing running. Test 3 refines this. */
constexpr float PACK_VOLTS_ESTIMATE = 13.10f;   // was 14.80 (no-load)

/* The motor's RATED maximum, from its datasheet. The tool will never command
 * a duty that delivers more than this. Getting this right matters more than
 * the other two — it is what bounds every motor test. */
constexpr float MOTOR_RATED_VOLTS = 6.00f;

/* Assumed H-bridge loss until test 7 measures it. The L298 is a Darlington
 * bridge; its datasheet quotes about 1.8 V at 1 A. */
constexpr float BRIDGE_DROP_ESTIMATE = 1.50f;

/* =============================================================================
 *  DERIVED SAFETY CEILING
 * ========================================================================== */

static float estimatedAvailableVolts() {
  return PACK_VOLTS_ESTIMATE - BRIDGE_DROP_ESTIMATE;
}

/* Highest duty keeping the motor at or below its rated voltage. Every
 * motor-driving test clamps to this. */
static int safeMaxDuty() {
  const float avail = estimatedAvailableVolts();
  if (avail <= 0.1f) return 0;
  const int d = (int)(PWM_MAX * MOTOR_RATED_VOLTS / avail + 0.5f);
  return constrain(d, 0, PWM_MAX);
}

/* Duty back to volts, using the current estimates. Provisional until tests 6
 * and 7 replace those estimates with measurements. */
static float estimatedVoltsFor(int duty) {
  return estimatedAvailableVolts() * (float)duty / (float)PWM_MAX;
}

/* =============================================================================
 *  MOTOR DRIVER
 *  Deliberately duplicated rather than shared with motors.cpp — this tool must
 *  work while that module is unwritten or wrong, since verifying it is part of
 *  what this tool is for.
 * ========================================================================== */

static void motorsBegin() {
  pinMode(LEFT_IN_A, OUTPUT);
  pinMode(LEFT_IN_B, OUTPUT);
  pinMode(RIGHT_IN_A, OUTPUT);
  pinMode(RIGHT_IN_B, OUTPUT);

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(LEFT_EN,  PWM_FREQ_HZ, PWM_BITS);
  ledcAttach(RIGHT_EN, PWM_FREQ_HZ, PWM_BITS);
#else
  /* core 2.x — this is the branch that compiles on 2.0.17 */
  ledcSetup(LEFT_CH,  PWM_FREQ_HZ, PWM_BITS);
  ledcAttachPin(LEFT_EN, LEFT_CH);
  ledcSetup(RIGHT_CH, PWM_FREQ_HZ, PWM_BITS);
  ledcAttachPin(RIGHT_EN, RIGHT_CH);
#endif
}

/* core 2.x addresses LEDC by channel index; core 3.x by pin. */
static inline void writePwm(int channel, int duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite((channel == LEFT_CH) ? LEFT_EN : RIGHT_EN, duty);
#else
  ledcWrite(channel, duty);
#endif
}

/* Drive one bridge. NO invert flag here, on purpose: this tool DETERMINES
 * whether a wheel needs inverting, so it must drive the hardware exactly as
 * wired, with no interpretation applied. */
static void driveWheelRaw(int inA, int inB, int channel, int duty) {
  duty = constrain(duty, -safeMaxDuty(), safeMaxDuty());

  if (duty > 0) {
    digitalWrite(inA, HIGH); digitalWrite(inB, LOW);  writePwm(channel,  duty);
  } else if (duty < 0) {
    digitalWrite(inA, LOW);  digitalWrite(inB, HIGH); writePwm(channel, -duty);
  } else {
    digitalWrite(inA, LOW);  digitalWrite(inB, LOW);  writePwm(channel, 0);
  }
}

static void setWheels(int left, int right) {
  driveWheelRaw(LEFT_IN_A,  LEFT_IN_B,  LEFT_CH,  left);
  driveWheelRaw(RIGHT_IN_A, RIGHT_IN_B, RIGHT_CH, right);
}

static void stopMotors() { setWheels(0, 0); }

/* =============================================================================
 *  SENSOR READER — digital
 * ========================================================================== */

static int g_level[SENSOR_COUNT];   /* raw HIGH/LOW as read from the pin */

static void sensorsBegin() {
  for (int i = 0; i < SENSOR_COUNT; i++) pinMode(SENSOR_PINS[i], INPUT);
}

static void readSensors() {
  for (int i = 0; i < SENSOR_COUNT; i++) g_level[i] = digitalRead(SENSOR_PINS[i]);
}

/* Interpret a level as "over the line", using the polarity from pins.h.
 * Test 2 is what confirms that polarity is right. */
static bool onLine(int i) { return g_level[i] == LINE_ACTIVE_LEVEL; }

/* =============================================================================
 *  TEST STATE
 * ========================================================================== */

enum Test {
  TEST_NONE,
  TEST_1_SENSOR_RESPONSE,
  TEST_2_SENSOR_POLARITY,
  TEST_4_MOTOR_ID,
  TEST_5_DIRECTION,
  TEST_6_LOAD_VOLTAGE,
  TEST_8_START_THRESHOLD,
  TEST_9_TRIM,
  TEST_10_SPEED
};

static Test g_test = TEST_NONE;
static unsigned long g_testStartMs = 0;
static unsigned long g_lastPrintMs = 0;

/* Test 8 state */
static bool g_steppingLeft = true;
static int  g_stepDuty = 0;

constexpr unsigned long TRIM_RUN_MS  = 4000;
constexpr unsigned long SPEED_RUN_MS = 2000;

/* Duty for tests that just need the wheels turning. Set at the rated ceiling,
 * so it is guaranteed to move any working motor while staying in spec. */
static int surveyDuty() { return safeMaxDuty(); }

/* =============================================================================
 *  HELPERS
 * ========================================================================== */

/* Prints both the interpreted pattern and the raw levels. The raw column
 * matters: if the pattern looks inverted, the raw levels tell you whether the
 * sensor is actually changing at all, or whether only the interpretation is
 * wrong. */
static void printPattern() {
  Serial.print('[');
  for (int i = 0; i < SENSOR_COUNT; i++) Serial.print(onLine(i) ? '#' : '.');
  Serial.print(F("]   raw "));
  for (int i = 0; i < SENSOR_COUNT; i++) Serial.print(g_level[i] ? '1' : '0');
}

static bool throttle(unsigned long intervalMs) {
  if (millis() - g_lastPrintMs < intervalMs) return false;
  g_lastPrintMs = millis();
  return true;
}

static void endTest(const char *note) {
  stopMotors();
  g_test = TEST_NONE;
  Serial.println();
  Serial.println(note);
  Serial.println(F("--- test ended. press 'h' for the menu ---"));
  Serial.println();
}

/* =============================================================================
 *  MENU
 * ========================================================================== */

static void printMenu() {
  Serial.println();
  Serial.println(F("============================================================"));
  Serial.println(F("  CALIBRATION TOOL — run the tests IN ORDER"));
  Serial.println(F("============================================================"));
  Serial.println(F("  1  sensor response      which channel is physically left"));
  Serial.println(F("  2  sensor polarity      which level means on-the-line"));
  Serial.println(F("  3  battery, no load     multimeter only (prints steps)"));
  Serial.println(F("  4  motor identification which channel drives which wheel"));
  Serial.println(F("  5  motor direction      forward or backward"));
  Serial.println(F("  6  battery under load   multimeter, motors running"));
  Serial.println(F("  7  bridge drop          multimeter (prints steps)"));
  Serial.println(F("  8  start threshold      step duty one count at a time"));
  Serial.println(F("  9  straight-line trim   drive and measure sideways drift"));
  Serial.println(F("  0  chassis speed        distance in a timed run"));
  Serial.println();
  Serial.println(F("  h  this menu            SPACE or x  STOP immediately"));
  Serial.println(F("============================================================"));
  Serial.printf ("  safety ceiling: duty %d  (~%.2f V at the motor)\n",
                 safeMaxDuty(), MOTOR_RATED_VOLTS);
  Serial.printf ("  line-active level: %s\n", LINE_ACTIVE_LEVEL == LOW ? "LOW" : "HIGH");
  Serial.println();
}

/* =============================================================================
 *  TEST 1 — SENSOR RESPONSE
 * -----------------------------------------------------------------------------
 *  MEASURES : which channels are alive, and which physical end is index 0
 *  FEEDS    : SENSOR_PINS ordering in pins.h
 *  REQUIRES : nothing
 *  SAFETY   : motors never run
 *
 *  PROCEDURE
 *    1. press '1'. the pattern and raw levels print continuously
 *    2. wave a hand under each sensor in turn, left to right
 *    3. confirm ALL FIVE respond
 *    4. hold the line under the array's PHYSICAL LEFT end only
 *
 *  RECORD   pattern with line at physical left:  [ _ _ _ _ _ ]
 *
 *  INTERPRET
 *    leftmost char changes   -> index 0 is physically left, pins.h is correct
 *    rightmost char changes  -> the array is mounted reversed; reverse the
 *                               SENSOR_PINS list in pins.h
 *
 *  SANITY   all five must respond, and the responding position must move
 *           smoothly across as you sweep. If a channel never changes, that is
 *           a wiring fault, not a sensitivity problem — check continuity
 *           before touching the pot.
 *
 *           If the pattern looks inverted (all '#' in mid-air), do not worry
 *           yet. Test 2 handles polarity.
 * ========================================================================== */
static void runTest1() {
  if (!throttle(200)) return;
  printPattern();
  Serial.println();
}

/* =============================================================================
 *  TEST 2 — SENSOR POLARITY AND POT ADJUSTMENT
 * -----------------------------------------------------------------------------
 *  MEASURES : which logic level the module outputs when over the line, and
 *             whether the pot is set so every channel switches reliably
 *  FEEDS    : LINE_ACTIVE_LEVEL in pins.h
 *  REQUIRES : test 1
 *  SAFETY   : motors never run
 *
 *  PROCEDURE
 *    1. press '2'
 *    2. hold the whole array over PLAIN WHITE at the real ride height.
 *       note the raw digits
 *    3. hold it over the BLACK TAPE at the same height. note them again
 *
 *  RECORD   raw over white: _ _ _ _ _
 *           raw over black: _ _ _ _ _
 *
 *  INTERPRET
 *    black reads 0  ->  LINE_ACTIVE_LEVEL = LOW   (the usual case)
 *    black reads 1  ->  LINE_ACTIVE_LEVEL = HIGH
 *
 *    Once set correctly, the pattern shows [#####] over tape and [.....] over
 *    white. Verify that before moving on.
 *
 *  ADJUSTING THE POT
 *    All five digits must FLIP between the two surfaces. If a channel reads
 *    the same on both, it is not switching, and that is what the pot is for:
 *
 *      never switches at all   -> too insensitive, turn the pot one way
 *      always reads as on-line -> too sensitive, turn it the other
 *
 *    Turn in small increments, re-checking both surfaces each time. Aim for
 *    the middle of the range over which all five behave, not the edge — a
 *    setting that only just works will stop working as the battery sags or
 *    the surface changes.
 *
 *    NOTE: most modules have ONE pot for all five channels, so you are
 *    choosing a single compromise. If one channel refuses to agree with the
 *    other four at any setting, suspect its ride height or its wiring rather
 *    than the pot.
 *
 *  WHY THERE IS NO SOFTWARE THRESHOLD
 *    A comparator module has already made the black-or-white decision in
 *    hardware. That is why this is quick to set up, but it also means the
 *    reading carries no information about HOW FAR off-centre the line is —
 *    only which channels are over it. Position resolution is therefore fixed
 *    by sensor spacing and cannot be improved in software.
 * ========================================================================== */
static void runTest2() {
  if (!throttle(300)) return;
  printPattern();
  Serial.print(F("    (over white expect ....., over tape expect #####)"));
  Serial.println();
}

/* =============================================================================
 *  TEST 3 — BATTERY, NO LOAD   (multimeter only)
 * -----------------------------------------------------------------------------
 *  MEASURES : pack voltage with nothing drawing current
 *  FEEDS    : PACK_VOLTS_ESTIMATE at the top of this file
 *  REQUIRES : nothing
 *
 *  PROCEDURE
 *    1. motors stopped, robot powered
 *    2. multimeter across the L298N supply input terminals
 *    3. record
 *
 *  RECORD   V_pack_noload = ______ V
 *
 *  SANITY   4 lithium cells in series: 12.0 V empty to 16.8 V full. Under
 *           about 3.2 V per cell, charge before continuing — a sagging pack
 *           makes every later measurement wrong in ways that look like
 *           control problems.
 *
 *  NOTE     this is the NO-LOAD figure and will read higher than the voltage
 *           available while driving. Test 6 measures that.
 * ========================================================================== */
static void printTest3Steps() {
  Serial.println();
  Serial.println(F("TEST 3 — BATTERY, NO LOAD  (multimeter, no motors)"));
  Serial.println(F("  1. motors stopped, robot powered"));
  Serial.println(F("  2. multimeter across the L298N supply input terminals"));
  Serial.println(F("  3. record V_pack_noload = ______ V"));
  Serial.println();
  Serial.println(F("  sanity: 4 cells in series -> 12.0 to 16.8 V."));
  Serial.println(F("  under ~3.2 V per cell, charge before continuing."));
  Serial.println(F("  put this into PACK_VOLTS_ESTIMATE and reflash."));
  Serial.println();
}

/* =============================================================================
 *  TEST 4 — MOTOR IDENTIFICATION
 * -----------------------------------------------------------------------------
 *  MEASURES : which L298 channel drives which physical wheel
 *  FEEDS    : the LEFT_* / RIGHT_* assignments in pins.h
 *  REQUIRES : test 3
 *  SAFETY   : *** WHEELS OFF THE GROUND ***
 *
 *  PROCEDURE
 *    1. robot on a box, both wheels hanging free
 *    2. press '4'
 *    3. the channel named LEFT runs alone 1.5 s — WATCH WHICH WHEEL TURNS
 *    4. pause, then the channel named RIGHT runs alone 1.5 s — watch again
 *
 *  RECORD   channel named LEFT  turned the ______ wheel
 *           channel named RIGHT turned the ______ wheel
 *
 *  INTERPRET
 *    matches  -> pins.h is correct
 *    swapped  -> swap the LEFT_* and RIGHT_* blocks in pins.h
 *
 *  WHY IT MATTERS
 *    On a previous robot the code called one channel "left" while it drove the
 *    right wheel. Every steering correction went to the wrong wheel, so the
 *    control loop DIVERGED from the line instead of settling onto it. That
 *    presented as "runs off the track and never recovers" and survived many
 *    rounds of tuning, because tuning cannot fix a sign error.
 *
 *  SANITY   exactly one wheel per phase. Both moving means the enable pins
 *           are wired together. Neither moving means the safety ceiling is
 *           below this motor's start threshold — run test 8 and come back.
 * ========================================================================== */
static void runTest4() {
  const unsigned long t = millis() - g_testStartMs;
  const int d = surveyDuty();

  if (t < 1500) {
    setWheels(d, 0);
    if (throttle(400)) Serial.printf("  channel named LEFT  at duty %d — which wheel?\n", d);
  } else if (t < 2500) {
    stopMotors();
    if (throttle(400)) Serial.println(F("  pause"));
  } else if (t < 4000) {
    setWheels(0, d);
    if (throttle(400)) Serial.printf("  channel named RIGHT at duty %d — which wheel?\n", d);
  } else {
    endTest("record: LEFT channel -> ____ wheel,  RIGHT channel -> ____ wheel");
  }
}

/* =============================================================================
 *  TEST 5 — MOTOR DIRECTION
 * -----------------------------------------------------------------------------
 *  MEASURES : whether positive duty drives each wheel FORWARD
 *  FEEDS    : LEFT_INVERT and RIGHT_INVERT in config.h
 *  REQUIRES : test 4
 *  SAFETY   : *** WHEELS OFF THE GROUND ***
 *
 *  PROCEDURE
 *    1. wheels still hanging free
 *    2. press '5'. both run at positive duty for 3 s
 *    3. watch the TOP of each wheel — moving away from you is forward
 *
 *  RECORD   left wheel  ran  forward / backward
 *           right wheel ran  forward / backward
 *
 *  INTERPRET
 *    both forward  -> LEFT_INVERT = false, RIGHT_INVERT = false
 *    both backward -> both true
 *    one backward  -> that one true, the other false
 *
 *    Set a FLAG rather than swapping wires. A flag is reversible, visible in
 *    source, and cannot be forgotten. Swapped wires leave the code and the
 *    hardware disagreeing for whoever reads it next.
 *
 *  SANITY   this test applies NO invert flags — it drives the pins exactly as
 *           wired. That is deliberate: it is what DETERMINES the flags, so it
 *           cannot use them.
 * ========================================================================== */
static void runTest5() {
  const unsigned long t = millis() - g_testStartMs;
  const int d = surveyDuty();

  if (t < 3000) {
    setWheels(d, d);
    if (throttle(500)) Serial.printf("  both wheels, positive duty %d — forward or backward?\n", d);
  } else {
    endTest("record: left ____ , right ____  (forward / backward)");
  }
}

/* =============================================================================
 *  TEST 6 — BATTERY UNDER LOAD
 * -----------------------------------------------------------------------------
 *  MEASURES : pack voltage while the motors actually draw current
 *  FEEDS    : V_BATT_NOMINAL in config.h
 *  REQUIRES : test 4
 *  SAFETY   : *** WHEELS OFF THE GROUND ***
 *
 *  PROCEDURE
 *    1. multimeter across the L298N SUPPLY INPUT terminals
 *    2. press '6'. both motors run 6 s
 *    3. read the meter WHILE RUNNING, not before or after
 *
 *  RECORD   V_pack_loaded = ______ V
 *
 *  WHY UNDER LOAD
 *    Terminal voltage sags when current flows, because of the pack's internal
 *    resistance. The firmware computes duty from this number, so using the
 *    no-load figure makes every commanded speed come out lower than intended.
 *
 *    The reverse error is worse. On a previous robot this was left at a stale
 *    nearly-flat 12.50 V after the pack was recharged. Every speed then came
 *    out about 39% hotter than configured, and lowering the cruise setting did
 *    not help, because the error was multiplicative. It looked like a tuning
 *    problem for several rounds.
 *
 *  SANITY   expect a few tenths below the no-load reading. More than about
 *           1 V of sag suggests a tired pack, thin wiring or a bad joint.
 * ========================================================================== */
static void runTest6() {
  const unsigned long t = millis() - g_testStartMs;
  const int d = surveyDuty();

  if (t < 6000) {
    setWheels(d, d);
    if (throttle(1000))
      Serial.printf("  running at duty %d — read the meter NOW  (%lu s left)\n",
                    d, (6000 - t) / 1000);
  } else {
    endTest("record: V_pack_loaded = ______ V   -> V_BATT_NOMINAL");
  }
}

/* =============================================================================
 *  TEST 7 — BRIDGE DROP   (multimeter only)
 * -----------------------------------------------------------------------------
 *  MEASURES : voltage lost inside the L298 H-bridge
 *  FEEDS    : V_DROP_L298 in config.h
 *  REQUIRES : test 6
 *
 *  PROCEDURE
 *    1. press '6' to get the motors running
 *    2. measure across the L298N SUPPLY INPUT terminals   -> V_supply
 *    3. measure across one motor's OUTPUT terminals       -> V_motor
 *       both during the SAME run, at the same duty
 *
 *  COMPUTE  V_DROP_L298 = V_supply - V_motor
 *
 *  WHY IT IS SO LARGE
 *    The L298 is an old Darlington bridge, not a MOSFET one. Each Darlington
 *    pair drops roughly 0.7-1.5 V and the current passes through two of them,
 *    one sourcing and one sinking. Its datasheet quotes about 1.8 V total at
 *    1 A. This is why the motor never sees full pack voltage.
 *
 *  SANITY   expect roughly 1.0 to 2.5 V. Much more suggests high current or a
 *           failing bridge; much less suggests the two readings were not taken
 *           during the same run.
 *
 *  IMPORTANT
 *    An error here propagates into EVERY voltage the firmware derives. On a
 *    previous robot an assumed 1.05 V measured 1.50 V, shifting every computed
 *    threshold. Measure it; do not inherit it.
 * ========================================================================== */
static void printTest7Steps() {
  Serial.println();
  Serial.println(F("TEST 7 — BRIDGE DROP  (multimeter, during a test-6 run)"));
  Serial.println(F("  1. press '6' to start the motors"));
  Serial.println(F("  2. measure L298N SUPPLY INPUT terminals  -> V_supply"));
  Serial.println(F("  3. measure one MOTOR OUTPUT pair         -> V_motor"));
  Serial.println(F("     both during the SAME run, same duty"));
  Serial.println();
  Serial.println(F("  V_DROP_L298 = V_supply - V_motor"));
  Serial.println(F("  sanity: expect roughly 1.0 to 2.5 V."));
  Serial.println(F("  an error here shifts EVERY derived voltage."));
  Serial.println();
}

/* =============================================================================
 *  TEST 8 — START THRESHOLD   (manual step)
 * -----------------------------------------------------------------------------
 *  MEASURES : the lowest duty at which each wheel actually begins to turn
 *  FEEDS    : V_START in config.h
 *  REQUIRES : tests 6 and 7
 *  SAFETY   : *** WHEELS OFF THE GROUND ***
 *
 *  PROCEDURE
 *    1. press '8'. duty starts at 0, on the LEFT wheel
 *    2. '.' adds 10   (coarse, to approach the threshold quickly)
 *    3. '+' adds 1    (fine)
 *    4. '-' subtracts 1,  ',' subtracts 10
 *    5. find the EXACT boundary: step down one, confirm it stops; step up
 *       one, confirm it starts. that count is the answer
 *    6. 'r' switches to the RIGHT wheel, repeat
 *    7. 'x' when finished
 *
 *  RECORD   duty_left = ______      duty_right = ______
 *
 *  COMPUTE  V_avail = V_BATT_NOMINAL - V_DROP_L298         (tests 6 and 7)
 *           V_START = max(duty_left, duty_right) * V_avail / 255
 *
 *           Use the LARGER duty — the WEAKER motor. The floor must clear the
 *           worse of the two, or that wheel stalls while the other turns, and
 *           the robot curves for reasons no steering tuning will explain.
 *
 *  ALSO     trim ratio = min(duty_left, duty_right) / max(...)
 *           Useful in its own right, and it does NOT depend on the voltage
 *           estimates at all, because V_avail cancels.
 *
 *  SANITY   expect 40-75% of the motor's rated voltage. Outside that, re-check
 *           tests 6 and 7 before believing it.
 *
 *  WHY MANUAL STEPPING RATHER THAN AN AUTOMATIC RAMP
 *    A ramp forces you to react at the right instant, making your reaction
 *    time part of the measurement. Stepping by hand lets you sit at the
 *    boundary and cross it repeatedly until certain. The number is the point,
 *    not the speed of getting it.
 *
 *  WHAT THIS DOES NOT MEASURE
 *    This is BREAKAWAY — the voltage to overcome static friction from a dead
 *    stop. It is NOT running speed. On a previous robot the two wheels'
 *    breakaway duties differed by 12% and yet the robot tracked perfectly
 *    straight once moving, because breakaway is stiction while running speed
 *    is back-EMF and load. Test 9 measures the running behaviour separately.
 *    Do not assume one predicts the other.
 * ========================================================================== */
static void printStepState() {
  Serial.printf("  %-5s wheel   duty %3d   (~%.2f V, provisional)\n",
                g_steppingLeft ? "LEFT" : "RIGHT",
                g_stepDuty, estimatedVoltsFor(g_stepDuty));
}

static void applyStepDuty() {
  g_stepDuty = constrain(g_stepDuty, 0, safeMaxDuty());
  if (g_steppingLeft) setWheels(g_stepDuty, 0);
  else                setWheels(0, g_stepDuty);
  printStepState();
}

static void runTest8() {
  /* Entirely event-driven: all the work is in the key handler. */
}

/* =============================================================================
 *  TEST 9 — STRAIGHT-LINE TRIM
 * -----------------------------------------------------------------------------
 *  MEASURES : sideways drift when both wheels get exactly equal duty
 *  FEEDS    : whether trim compensation is needed at all
 *  REQUIRES : tests 5 and 8
 *  SAFETY   : needs ~2 m of clear floor. ON THE GROUND.
 *
 *  PROCEDURE
 *    1. mark the starting position of ONE wheel's contact point
 *    2. lay a straight reference along the intended path (string, tile edge)
 *    3. press '9'. both wheels run at equal duty 4 s, then stop
 *    4. measure FORWARD distance travelled          -> d
 *    5. measure SIDEWAYS offset from the reference  -> y
 *
 *  RECORD   d = ______ mm    y = ______ mm    drifted to the ____ side
 *
 *  COMPUTE  R = (d^2 + y^2) / (2y)        radius actually followed
 *           k = (R - W/2) / (R + W/2)     slower wheel / faster wheel
 *           where W is the wheelbase, wheel centre to wheel centre
 *
 *  INTERPRET
 *    y within a few mm per metre  -> no trim needed, ignore k
 *    consistent repeatable curve  -> real running mismatch; k is the
 *                                    correction factor for the faster wheel
 *
 *  SANITY   run it three times. One run picks up floor slope, surface texture
 *           and starting alignment. If the drift direction changes between
 *           runs it is noise, not trim.
 *
 *  NOTE     this is a DIFFERENT quantity from the test 8 trim ratio. That
 *           compares breakaway at standstill; this compares speed while
 *           running. They can disagree, and when they do, this one governs
 *           tracking.
 * ========================================================================== */
static void runTest9() {
  const unsigned long t = millis() - g_testStartMs;
  const int d = surveyDuty();

  if (t < TRIM_RUN_MS) {
    setWheels(d, d);
    if (throttle(1000)) Serial.printf("  running straight at duty %d\n", d);
  } else {
    endTest("record: forward d = ____ mm,  sideways y = ____ mm,  side ____");
  }
}

/* =============================================================================
 *  TEST 10 — CHASSIS SPEED
 * -----------------------------------------------------------------------------
 *  MEASURES : how fast the robot actually travels at a given duty
 *  FEEDS    : ROBOT_SPEED_MMPS in config.h, which sets corner advance timing
 *  REQUIRES : test 8
 *  SAFETY   : needs ~2 m of clear floor. ON THE GROUND.
 *
 *  PROCEDURE
 *    1. mark the floor at one wheel's contact point
 *    2. press '0'. drives straight exactly 2 s, then STOPS
 *    3. WAIT for a complete stop before marking
 *    4. mark the same wheel's new position
 *    5. measure between the marks
 *
 *  RECORD   run 1 = ____ mm    run 2 = ____ mm    run 3 = ____ mm
 *
 *  COMPUTE  ROBOT_SPEED_MMPS = average distance / 2
 *
 *  SANITY — DO NOT SKIP
 *    Check against what the motor can physically do:
 *
 *        v_max = (pi * wheel_diameter * rated_RPM) / 60
 *
 *    Your result must be WELL BELOW that, since the test runs far below rated
 *    voltage. At or above the ceiling means the MEASUREMENT is wrong, not the
 *    motor.
 *
 *    This check caught a real bug. A 1500 mm reading implied 750 mm/s, above
 *    what the motor could do at full rated voltage while the code commanded
 *    barely above the start threshold. The speed test had failed to actually
 *    stop the robot, so it drove on into normal operation and the extra
 *    distance went uncounted — a real measurement of the wrong event. Hence
 *    step 3.
 *
 *  NOTE     speed depends on the duty used. Change the cruise setting later
 *           and this measurement is invalid; repeat it.
 * ========================================================================== */
static void runTest10() {
  const unsigned long t = millis() - g_testStartMs;
  const int d = surveyDuty();

  if (t < SPEED_RUN_MS) {
    setWheels(d, d);
    if (throttle(500)) Serial.printf("  driving at duty %d\n", d);
  } else {
    endTest("STOPPED. measure between the marks, then divide by 2.");
  }
}

/* =============================================================================
 *  KEY HANDLING
 * ========================================================================== */

static void startTest(Test t, const char *banner) {
  stopMotors();
  g_test = t;
  g_testStartMs = millis();
  g_lastPrintMs = 0;
  Serial.println();
  Serial.println(banner);
}

static void handleKey(char c) {
  /* Emergency stop, checked first so it works in every mode. */
  if (c == 'x' || c == 'X' || c == ' ') {
    endTest("STOPPED by user.");
    return;
  }

  /* Test 8 claims most keys while active. */
  if (g_test == TEST_8_START_THRESHOLD) {
    switch (c) {
      case '+': case '=': g_stepDuty += 1;  applyStepDuty(); return;
      case '-': case '_': g_stepDuty -= 1;  applyStepDuty(); return;
      case '.': case '>': g_stepDuty += 10; applyStepDuty(); return;
      case ',': case '<': g_stepDuty -= 10; applyStepDuty(); return;
      case 'l': case 'L': g_steppingLeft = true;  g_stepDuty = 0; applyStepDuty(); return;
      case 'r': case 'R': g_steppingLeft = false; g_stepDuty = 0; applyStepDuty(); return;
      case '0':           g_stepDuty = 0;   applyStepDuty(); return;
      default: break;
    }
  }

  switch (c) {
    case 'h': case 'H': printMenu(); break;

    case '1': startTest(TEST_1_SENSOR_RESPONSE,
                        "TEST 1 — SENSOR RESPONSE. wave a hand under each sensor.");
              break;

    case '2': startTest(TEST_2_SENSOR_POLARITY,
                        "TEST 2 — POLARITY. hold over white, then over tape.");
              break;

    case '3': printTest3Steps(); break;

    case '4': startTest(TEST_4_MOTOR_ID,
                        "TEST 4 — MOTOR ID.  *** WHEELS OFF THE GROUND ***");
              break;

    case '5': startTest(TEST_5_DIRECTION,
                        "TEST 5 — DIRECTION.  *** WHEELS OFF THE GROUND ***");
              break;

    case '6': startTest(TEST_6_LOAD_VOLTAGE,
                        "TEST 6 — BATTERY UNDER LOAD. read the meter while running.");
              break;

    case '7': printTest7Steps(); break;

    case '8': startTest(TEST_8_START_THRESHOLD,
                        "TEST 8 — START THRESHOLD.  *** WHEELS OFF THE GROUND ***");
              Serial.println(F("  + / -  step by 1     . / ,  step by 10"));
              Serial.println(F("  l / r  choose wheel  0  zero    x  finish"));
              g_steppingLeft = true;
              g_stepDuty = 0;
              applyStepDuty();
              break;

    case '9': startTest(TEST_9_TRIM,
                        "TEST 9 — STRAIGHT-LINE TRIM. needs ~2 m of clear floor.");
              break;

    case '0': startTest(TEST_10_SPEED,
                        "TEST 10 — CHASSIS SPEED. mark the floor first.");
              break;

    default: break;
  }
}

static void pollConsole() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c >= ' ') handleKey(c);      /* ignore CR and LF */
  }
}

/* =============================================================================
 *  ENTRY POINTS
 * ========================================================================== */

void setup() {
  Serial.begin(115200);
  delay(400);

  sensorsBegin();
  motorsBegin();
  stopMotors();

  Serial.println();
  Serial.println(F("=== CALIBRATION TOOL ==="));
  Serial.println(F("this is NOT the line follower. it measures the hardware."));
  printMenu();
}

void loop() {
  pollConsole();
  readSensors();

  switch (g_test) {
    case TEST_1_SENSOR_RESPONSE: runTest1();  break;
    case TEST_2_SENSOR_POLARITY: runTest2();  break;
    case TEST_4_MOTOR_ID:        runTest4();  break;
    case TEST_5_DIRECTION:       runTest5();  break;
    case TEST_6_LOAD_VOLTAGE:    runTest6();  break;
    case TEST_8_START_THRESHOLD: runTest8();  break;
    case TEST_9_TRIM:            runTest9();  break;
    case TEST_10_SPEED:          runTest10(); break;
    case TEST_NONE:              stopMotors(); break;
  }

  delay(2);
}

/* =============================================================================
 *  GEOMETRY — RULER ONLY, NO CODE
 * -----------------------------------------------------------------------------
 *  SENSOR_AHEAD_MM
 *    Horizontal distance from the WHEEL AXLE CENTRELINE forward to the LINE OF
 *    SENSOR CENTRES. Sets how far the robot must roll after losing the line
 *    before the axle reaches a corner:
 *        advance distance = SENSOR_AHEAD_MM - LINE_WIDTH_MM / 2
 *    Pivoting before the axle arrives means pivoting about the wrong point.
 *
 *  LINE_WIDTH_MM
 *    Width of the tape. Feeds the same formula.
 *
 *  RIDE_HEIGHT_MM
 *    Gap from the UNDERSIDE of the sensor board down to the floor. Check
 *    against the sensor datasheet — TCRT5000-class parts want about 3 mm and
 *    stop working beyond about 12 mm.
 *
 *    This matters more than it looks. Reflected signal falls off roughly as
 *    1/distance^2, and the emitter's beam spreads in a cone, so the patch of
 *    floor each sensor averages GROWS with height. At 25 mm a sensor reads an
 *    ~18 mm blur instead of an ~2 mm point: the line appears wider than it is,
 *    position resolution collapses, and all five channels can read black at
 *    once while merely parked on the tape. No software recovers that. If the
 *    ride height is out of spec, fix it with standoffs before tuning anything.
 * ========================================================================== */