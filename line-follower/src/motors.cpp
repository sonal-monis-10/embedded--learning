/* =============================================================================
 *  motors.cpp — wheel control
 * =============================================================================
 *  See motors.h for the interface and the reasoning behind it.
 * ========================================================================== */

#include <Arduino.h>
#include "config.h"
#include "pins.h"
#include "conversion.h"
#include "motors.h"

/* Last commanded duties, exposed for telemetry. Defined here, declared extern
 * in the header — exactly one allocation, visible everywhere. */
int  g_dutyLeft  = 0;
int  g_dutyRight = 0;
bool g_brakeLeft  = false;
bool g_brakeRight = false;

/* -----------------------------------------------------------------------------
 *  Setup
 * -----------------------------------------------------------------------------
 *  The direction pins are plain outputs. The enable pins carry PWM, which on
 *  the ESP32 comes from the LEDC peripheral rather than analogWrite().
 *
 *  The two API branches are a version difference, not a hardware one:
 *  core 2.x addresses LEDC by CHANNEL index, core 3.x by PIN. This project
 *  builds on core 2.0.17, so the #else branch is the live one; the 3.x branch
 *  is there so the file survives a toolchain upgrade.
 * -------------------------------------------------------------------------- */
void motorsBegin() {
  pinMode(LEFT_IN_A,  OUTPUT);
  pinMode(LEFT_IN_B,  OUTPUT);
  pinMode(RIGHT_IN_A, OUTPUT);
  pinMode(RIGHT_IN_B, OUTPUT);

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(LEFT_EN,  PWM_FREQ_HZ, PWM_BITS);
  ledcAttach(RIGHT_EN, PWM_FREQ_HZ, PWM_BITS);
#else
  ledcSetup(LEFT_CH,  PWM_FREQ_HZ, PWM_BITS);
  ledcAttachPin(LEFT_EN, LEFT_CH);
  ledcSetup(RIGHT_CH, PWM_FREQ_HZ, PWM_BITS);
  ledcAttachPin(RIGHT_EN, RIGHT_CH);
#endif
}

static inline void writePwm(int channel, int duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite((channel == LEFT_CH) ? LEFT_EN : RIGHT_EN, duty);
#else
  ledcWrite(channel, duty);
#endif
}

/* -----------------------------------------------------------------------------
 *  Drive one bridge.
 *
 *  Order of operations matters here:
 *
 *  1. Brake check FIRST, before anything else touches the value. WHEEL_BRAKE
 *     is a sentinel, not a speed — negating or clamping it would turn it into
 *     a real duty and silently drive the wheel instead of holding it.
 *
 *  2. Invert. Applied here rather than at the caller so that "positive means
 *     forward" is guaranteed for every caller, including future ones.
 *
 *  3. Clamp to the motor's rated ceiling, LAST. Nothing downstream of this can
 *     produce an out-of-range duty, whatever arithmetic happened upstream.
 * -------------------------------------------------------------------------- */
static void driveWheel(int inA, int inB, int channel, int duty, bool invert) {
  if (duty == WHEEL_BRAKE) {
    digitalWrite(inA, HIGH);
    digitalWrite(inB, HIGH);
    writePwm(channel, PWM_MAX);
    return;
  }

  if (invert) duty = -duty;

  const int cap = ceilingDuty();
  duty = constrain(duty, -cap, cap);

  if (duty > 0) {
    digitalWrite(inA, HIGH);
    digitalWrite(inB, LOW);
    writePwm(channel, duty);
  } else if (duty < 0) {
    digitalWrite(inA, LOW);
    digitalWrite(inB, HIGH);
    writePwm(channel, -duty);
  } else {
    digitalWrite(inA, LOW);
    digitalWrite(inB, LOW);
    writePwm(channel, 0);
  }
}

/* -----------------------------------------------------------------------------
 *  Apply the measured left/right speed mismatch.
 *
 *  Calibration test 9 found the left wheel runs about 3.7% slower at equal
 *  duty, so MOTOR_TRIM_LEFT scales it UP by 1/0.963.
 *
 *  Scaling the slower wheel up rather than the faster one down is deliberate:
 *  scaling down would push the inner wheel closer to the stall floor during
 *  turns, and this robot only has 11 duty counts of margin between cruise and
 *  floor. Spending that margin on trim would leave nothing for steering.
 *
 *  Brake is passed through untouched — trimming a sentinel is meaningless.
 *  Zero is passed through as well, so "stop" stays exactly stop rather than
 *  becoming a small nonzero duty that sits below the stall floor and does
 *  nothing but draw current.
 * -------------------------------------------------------------------------- */
static int applyTrim(int duty, float trim) {
  if (duty == WHEEL_BRAKE || duty == 0) return duty;
  return (int)(duty * trim + (duty > 0 ? 0.5f : -0.5f));
}

/* -----------------------------------------------------------------------------
 *  The single entry point for movement.
 *
 *  Records what was ASKED for (before trim and inversion) for telemetry, then
 *  applies the corrections. A trace therefore shows the control layer's
 *  intent, which is what you want when diagnosing a steering decision — the
 *  post-trim numbers would just add noise.
 * -------------------------------------------------------------------------- */
void setWheels(int left, int right) {
  g_brakeLeft  = (left  == WHEEL_BRAKE);
  g_brakeRight = (right == WHEEL_BRAKE);
  g_dutyLeft   = g_brakeLeft  ? 0 : left;
  g_dutyRight  = g_brakeRight ? 0 : right;

  driveWheel(LEFT_IN_A,  LEFT_IN_B,  LEFT_CH,
             applyTrim(left,  MOTOR_TRIM_LEFT),  LEFT_INVERT);
  driveWheel(RIGHT_IN_A, RIGHT_IN_B, RIGHT_CH,
             applyTrim(right, MOTOR_TRIM_RIGHT), RIGHT_INVERT);
}

void coastWheels() {
  setWheels(0, 0);
}

void brakeWheels() {
  setWheels(WHEEL_BRAKE, WHEEL_BRAKE);
}

/* -----------------------------------------------------------------------------
 *  Rotate about the chassis centre.
 *
 *  Equal and opposite duties, so the wheels counter-rotate and the robot turns
 *  without translating. spinDuty() is floored as well as capped — a pivot
 *  below the stall threshold does not rotate slowly, it does not rotate at
 *  all, and the recovery state machine would then wait forever for a sensor
 *  reading that never arrives.
 * -------------------------------------------------------------------------- */
void spinInPlace(int direction) {
  const int s = spinDuty();
  if (direction > 0) setWheels(s, -s);
  else               setWheels(-s, s);
}