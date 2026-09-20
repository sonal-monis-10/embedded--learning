/* =============================================================================
 *  control.h — steering
 * =============================================================================
 *  Turns a line position into two wheel speeds.
 *
 *  THIS IS NOT A PID CONTROLLER
 *  ----------------------------
 *  No integral term, no derivative term, no continuous gain. It is a five-step
 *  ladder: each of the five possible error magnitudes maps to one fixed
 *  response.
 *
 *  That is not a simplification for its own sake. With binary sensors the
 *  position lands only on multiples of 500, so error takes exactly five
 *  values. A continuous Kp * error would compute a smooth curve through five
 *  discrete points and gain nothing — there is no intermediate error for it to
 *  respond to.
 *
 *  What the ladder buys instead is a guarantee. Each level can be checked by
 *  hand to ensure both wheels end up either above the stall floor or
 *  deliberately braked — never in the dead band between 1 and the floor, where
 *  a motor draws current and produces no rotation while looking like a valid
 *  command. A multiply-and-clamp cannot make that promise.
 *
 *  THE THREE PRINCIPLES
 *  --------------------
 *  1. SIGN. Positive error means the line lies toward the higher sensor
 *     indices — to the robot's RIGHT — so the robot must turn right, which
 *     makes the LEFT wheel the outer, faster one. Getting this backwards does
 *     not produce wobble; it produces divergence, because every correction
 *     enlarges the error it was meant to reduce.
 *
 *  2. DIFFERENCE, NOT OFFSET. Turn rate is set by the gap between the two
 *     wheel speeds, not by their absolute values. So the ladder fixes the
 *     difference and slides the PAIR upward when the inner wheel would fall
 *     through the floor. Turn authority therefore does not depend on how low
 *     cruise is set — which is what makes it safe to run this robot slowly.
 *
 *  3. FLOOR OR BRAKE, NEVER BETWEEN. See above.
 *
 *  THE BAND THIS ROBOT HAS TO WORK IN
 *  ----------------------------------
 *      floor  88      cruise  99      ceiling  132
 *
 *  Eleven counts between floor and cruise. There is no room to slow the inner
 *  wheel; the only way to turn is to speed the outer one up and let the pair
 *  slide. That is a direct consequence of a 6 V motor whose breakaway
 *  threshold is 64% of its rating.
 * ========================================================================== */

#pragma once

/* Signed lateral error, in position units. Zero is centred, positive means the
 * line lies to the robot's right. Updated by followLine(). */
extern int g_error;

/* Which side the line was last seen on: -1 left, +1 right.
 *
 * Seeds the direction of a recovery sweep, so it must never be allowed to go
 * stale. On a previous build it was only updated during proportional steering,
 * which meant that by the time a corner arrived it still held whatever the
 * last small drift had set — and every recovery swept the same way regardless
 * of which way the corner actually went. */
extern int g_lastSeenSide;

/* Name of the steering decision just taken, for telemetry. Points at a string
 * literal, so comparing pointers is a valid way to detect a state change. */
extern const char *g_state;

/* One frame of line following. Assumes the line is visible — the caller checks
 * that first, because a lost line is the recovery layer's problem, not
 * steering's. */
void followLine();