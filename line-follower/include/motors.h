/* =============================================================================
 *  motors.h — wheel control
 * =============================================================================
 *  The only module that touches the motor pins. Everything above it thinks in
 *  terms of "physical left wheel" and "physical right wheel"; this layer turns
 *  that into GPIO states and PWM duty.
 *
 *  THREE RESPONSIBILITIES, AND NOTHING ELSE
 *  ----------------------------------------
 *  1. Direction. The invert flags from config.h are applied here and nowhere
 *     else, so there is exactly one place in the codebase where a sign can be
 *     wrong. On a previous robot a sign error like this survived many rounds
 *     of tuning, because a control loop wired backwards does not oscillate
 *     around the line — it diverges from it, and no gain adjustment fixes that.
 *
 *  2. Trim. The measured left/right speed mismatch is corrected here, so the
 *     control layer above can command "both wheels at cruise" and get a robot
 *     that actually goes straight.
 *
 *  3. Brake versus coast. Setting a wheel to zero duty does NOT hold it still.
 *     See the note on WHEEL_BRAKE below — this distinction changes how a turn
 *     behaves and is easy to get wrong silently.
 *
 *  WHAT THIS MODULE DOES NOT DO
 *  ----------------------------
 *  It has no idea what a line is, what an error is, or why it is being asked
 *  to turn. It takes two numbers and drives two motors. That separation is
 *  what lets the calibration tool use its own copy of this logic without
 *  depending on any of the control code.
 * ========================================================================== */

#pragma once

/* Sentinel duty meaning "hold this wheel against rotation".
 *
 * L298 datasheet, Table 5:
 *     both inputs LOW   -> free-running stop. The wheel COASTS, and the
 *                          chassis drags it along.
 *     both inputs HIGH  -> fast motor stop. The wheel is actively HELD.
 *
 * This matters for turning. Commanding an inner wheel to zero duty leaves it
 * free-wheeling, so it still rolls forward under the chassis's momentum and
 * the turn comes out wider and less repeatable than intended. Passing
 * WHEEL_BRAKE instead pins it, giving a tighter turn about a predictable
 * point.
 *
 * The value is far outside the valid -255..255 range so it can never collide
 * with a legitimate duty. */
constexpr int WHEEL_BRAKE = -30000;

/* Configure pins and attach the PWM peripheral. Call once from setup(). */
void motorsBegin();

/* Command both wheels.
 *
 * Arguments are PHYSICAL left and right, always — never L298 channel A and B.
 * Positive is forward, negative is reverse, WHEEL_BRAKE holds.
 *
 * Applies, in order: trim correction, invert flags, clamp to the motor's
 * rated ceiling. A caller cannot over-drive a motor through this function
 * regardless of what it passes in. */
void setWheels(int left, int right);

/* Both wheels free-running. Use when parked and not expecting to hold
 * position — on a slope the robot will roll. */
void coastWheels();

/* Both wheels actively held. Use for a deliberate stop. */
void brakeWheels();

/* Rotate about the chassis centre: one wheel forward, one back.
 * direction > 0 turns right (clockwise viewed from above). */
void spinInPlace(int direction);

/* Last commanded duties, for telemetry. These are the values as passed to
 * setWheels(), before trim and inversion — what the control layer asked for,
 * not what the pins ended up doing. */
extern int  g_dutyLeft;
extern int  g_dutyRight;
extern bool g_brakeLeft;
extern bool g_brakeRight;