/* =============================================================================
 *  conversion.h — volts to PWM duty
 * =============================================================================
 *  The single source of truth for speed in this firmware. Every other module
 *  asks for a speed in VOLTS and gets back a duty value; no other file
 *  performs this arithmetic.
 *
 *  WHY VOLTS AND NOT DUTY
 *  ----------------------
 *  A DC motor responds to the voltage across its terminals. PWM duty only maps
 *  to voltage if you know the supply, and a battery's supply falls as it
 *  discharges. Hardcoding duty therefore means the robot behaves differently
 *  depending on how full the pack is — the same number that crawls on a flat
 *  battery sprints on a fresh one.
 *
 *  Routing everything through here means one constant, V_BATT_NOMINAL, fixes
 *  every speed in the firmware at once.
 *
 *  THE CHAIN
 *  ---------
 *      V_avail = V_BATT_NOMINAL - V_DROP_L298      what reaches the motor
 *      duty    = 255 * V_target / V_avail          what to command
 *
 *  On this robot: 13.10 - 1.50 = 11.60 V available, so each duty count is
 *  worth 11.60 / 255 = 0.0455 V.
 *
 *  THE THREE SPEEDS
 *  ----------------
 *      floorDuty()    lowest duty at which a wheel reliably turns
 *      cruiseDuty()   normal forward speed
 *      ceilingDuty()  highest duty the motor is rated for
 *
 *  Expected values here: floor 88, cruise 99, ceiling 132. Note that cruise
 *  sits only 11 counts above the floor — that narrow band is what the steering
 *  ladder must work within, and it is a direct consequence of a 6 V motor
 *  whose breakaway threshold is 64% of its rating.
 *
 *  All functions are pure: same inputs, same outputs, no hardware access and
 *  no state. That makes them checkable with a calculator before the code ever
 *  runs on the robot.
 * ========================================================================== */

#pragma once

/* Voltage actually reachable at the motor terminals, after bridge losses. */
float availableVolts();

/* Duty (0..255) that delivers the requested voltage.
 * Clamps the request to V_MOTOR_MAX first, so no caller can command a duty
 * that over-drives the motor, however the number was arrived at. */
int dutyFor(float volts);

/* Inverse of dutyFor(), for reporting and diagnostics. */
float voltsFor(int duty);

/* Highest duty the motor is rated for. Every wheel command is clamped here. */
int ceilingDuty();

/* Lowest duty at which a wheel reliably turns: the measured breakaway
 * threshold plus a safety margin.
 *
 * A duty below this is not a slow wheel — it is a STALLED wheel that looks
 * like a valid command. The steering code must never leave a wheel between 1
 * and this value; it either drives above the floor or brakes deliberately. */
int floorDuty();

/* Normal forward speed. */
int cruiseDuty();

/* In-place rotation speed. Higher than cruise because a pivot must overcome
 * both tyres scrubbing sideways against the floor. */
int spinDuty();

/* True when the pack has sagged far enough that cruise has fallen to or below
 * the stall floor. At that point the robot cannot drive and steer at the same
 * time, so it should refuse to start rather than behave unpredictably. */
bool supplyTooLow();

/* Distance the chassis must roll forward after losing the line so that the
 * WHEEL AXLE — not the sensor array — arrives at the corner.
 *
 *     SENSOR_AHEAD_MM - LINE_WIDTH_MM / 2
 *
 * The array sits ahead of the axle, so at the moment the line disappears the
 * axle is still short of the junction. Pivoting immediately would rotate about
 * the wrong point. */
float advanceDistanceMm();

/* That distance expressed as a duration at cruise speed.
 *
 * WARNING: depends on ROBOT_SPEED_MMPS, which is currently measured at a
 * different duty than the firmware cruises at. See the note in config.h. */
unsigned long advanceDurationMs();