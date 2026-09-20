/* =============================================================================
 *  pins.h — physical wiring
 * =============================================================================
 *  Shared by src/main.cpp (line follower) and src/calibrate.cpp (measurement
 *  tool). Change this file only when you rewire the robot.
 *
 *  Layout: sensors on the 3.3 V side, motors on the VIN side, so each device
 *  sits next to the power pins it uses.
 *
 *  ---------------------------------------------------------------------------
 *  SENSORS — 3.3 V side, digital outputs
 *  ---------------------------------------------------------------------------
 *      3.3 V    ->  VCC
 *      GND      ->  GND
 *      GPIO D18  ->  S1
 *      GPIO D19  ->  S2
 *      GPIO D21  ->  S3   (centre)
 *      GPIO D22  ->  S4
 *      GPIO D23  ->  S5
 *
 *  Read with digitalRead()
 *
 *  RX0/TX0 (GPIO 3/1) are avoided — they are the USB serial link.
 *  GPIO 5, 2 and 15 are avoided as strapping pins.
 *
 *  ---------------------------------------------------------------------------
 *  MOTORS — VIN side
 *  ---------------------------------------------------------------------------
 *      GPIO D13  ->  ENA     right speed (PWM)
 *      GPIO D27  ->  IN2     right direction
 *      GPIO D26  ->  IN1     right direction
 *      GPIO D14  ->  ENB     left speed (PWM)
 *      GPIO D32  ->  IN4     left direction
 *      GPIO D33  ->  IN3     left direction
 *      GND       ->  GND     required
 *
 *  Which L298 channel drives which wheel is NOT yet confirmed. Calibration
 *  tests 4 and 5 determine the mapping and the direction.
 *
 *  GPIO 12 is skipped deliberately — it is a strapping pin that must be LOW
 *  at boot. Held high by a driver input, the board selects the wrong flash
 *  voltage and fails to start.
 *
 *  GPIO 34, 35, 36 and 39 can never be used here: they are INPUT-ONLY and
 *  have no output driver inside the chip. pinMode(OUTPUT) on them silently
 *  does nothing and the pin stays floating, so a motor wired to one simply
 *  never turns — with no error anywhere.
 *
 *  ---------------------------------------------------------------------------
 *  THREE THINGS THAT CAUSE HARDWARE FAILURES
 *  ---------------------------------------------------------------------------
 *  1. REMOVE THE ENA AND ENB JUMPERS on the L298N board. They ship fitted,
 *     tying the enable pins permanently HIGH. Left on, PWM has no effect and
 *     the motors run flat out or not at all.
 *
 *  2. CONNECT ESP32 GND TO L298N GND. Without a shared reference the driver
 *     cannot interpret 3.3 V logic levels and behaves erratically.
 *
 *  3. POWER THE SENSOR ARRAY FROM 3.3 V, NOT 5 V. A 5 V-powered module puts
 *     5 V on GPIO pins rated for 3.3 V.
 * ========================================================================== */

#pragma once

/* ---- motors, by physical side ---- */
constexpr int RIGHT_EN   = 13;   /* -> ENA */
constexpr int RIGHT_IN_A = 27;   /* -> IN2 */
constexpr int RIGHT_IN_B = 26;   /* -> IN1 */
constexpr int RIGHT_CH   = 0;

constexpr int LEFT_EN    = 14;   /* -> ENB */
constexpr int LEFT_IN_A  = 33;   /* -> IN3 */
constexpr int LEFT_IN_B  = 32;   /* -> IN4 */
constexpr int LEFT_CH    = 1;

/* ---- PWM ---- */
constexpr int PWM_FREQ_HZ = 1000;
constexpr int PWM_BITS    = 8;
constexpr int PWM_MAX     = 255;

/* ---- sensors, digital ---- */
constexpr int SENSOR_COUNT = 5;
constexpr int SENSOR_PINS[SENSOR_COUNT] = { 18, 19, 21, 22, 23 };  /* S1..S5 */
constexpr int SENSOR_CENTRE_INDEX = SENSOR_COUNT / 2;

/* Logic level a sensor reads when it IS over the line.
 * Comparator modules differ in polarity — calibration test 2 confirms this. */
constexpr int LINE_ACTIVE_LEVEL = LOW;