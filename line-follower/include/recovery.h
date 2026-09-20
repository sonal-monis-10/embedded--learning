/* =============================================================================
 *  recovery.h — what to do when the line disappears
 * =============================================================================
 *  A five-phase state machine. Normal following is one of the phases, so this
 *  module owns the whole driving cycle rather than sitting alongside it.
 *
 *      TRACK     following the line normally
 *      ADVANCE   rolling forward so the AXLE reaches a corner
 *      PIVOT_A   sweeping toward the side the line was last seen
 *      PIVOT_B   sweeping the other way, given twice as long
 *      HALTED    gave up, brakes held
 *
 *  THE GEOMETRY THAT DRIVES ALL OF THIS
 *  ------------------------------------
 *  The sensor array sits 90 mm ahead of the wheel axle. So at the instant the
 *  line vanishes at a corner, the array has passed the junction but the AXLE
 *  has not — it is still 55 mm short, once half a tape width is accounted for.
 *
 *  Pivoting at that moment rotates the robot about a point behind the corner,
 *  and the array sweeps an arc that misses the outgoing leg entirely. Rolling
 *  forward first puts the axle on the junction, so the pivot rotates about the
 *  corner itself.
 *
 *  WHY THE ADVANCE IS GATED
 *  ------------------------
 *  That reasoning only holds if the line was lost from a roughly centred,
 *  straight-ahead state. If the robot was already well off the line when it
 *  lost it, driving forward carries it FURTHER away and the subsequent pivot
 *  cannot reach back.
 *
 *  On a previous build this gate was missing. A trace showed the robot losing
 *  the line at maximum error while spinning, then obediently driving forward
 *  for 300 ms — straight away from the line it was trying to find — before
 *  starting a pivot that had no chance of succeeding. ADVANCE_MAX_ERR is the
 *  fix: above that error at the moment of loss, skip the advance and pivot
 *  immediately.
 *
 *  WHY PIVOTS EXIT ON THE CENTRE SENSOR ONLY
 *  -----------------------------------------
 *  An outer channel catching the line's edge partway through a sweep means the
 *  line is passing by, not that the robot is centred on it. Handing control
 *  back at that moment leaves the robot off-centre and it loses the line again
 *  within a few frames. Only the centre channel confirms a completed pivot.
 * ========================================================================== */

#pragma once

enum Phase {
  PHASE_TRACK,
  PHASE_ADVANCE,
  PHASE_PIVOT_A,
  PHASE_PIVOT_B,
  PHASE_HALTED
};

extern Phase g_phase;

/* Reset to TRACK. Call when arming the robot, so a previous run's HALTED state
 * does not persist into the next one. */
void recoveryReset();

/* Run one frame of the machine. Dispatches to the current phase, which either
 * drives, transitions, or both.
 *
 * EVERY path issues a motor command. A phase that returned without touching
 * the motors would leave them at whatever the previous frame set — which on a
 * previous build meant a robot frozen mid-command with no error and no motion. */
void updateRecovery();