/* =============================================================================
 *  config.h — measured and chosen constants
 * =============================================================================
 *  Every value here is one of three things, and each is tagged:
 *
 *      MEASURED  a physical test was run on THIS robot and this is the result
 *      DATASHEET taken from a component's specification
 *      CHOSEN    a design decision, not a fact about the hardware
 *
 *  The distinction matters. In source code a measured value and an assumed one
 *  look identical — same type, same units, same place in a formula. Nothing
 *  tells them apart until the robot misbehaves, and then an assumed constant
 *  looks exactly like a logic bug.
 *
 *  Pin numbers are NOT here. They live in pins.h, because they change when you
 *  rewire (rare, physical) rather than when you re-measure or re-tune
 *  (frequent). Constants that change together belong together.
 * ========================================================================== */

#pragma once

/* =============================================================================
 *  ELECTRICAL
 * ========================================================================== */

/* MEASURED, calibration test 6 — multimeter across the L298N supply input
 * terminals WHILE THE MOTORS WERE RUNNING.
 *
 * This must be the LOADED figure, not the resting one. The no-load reading on
 * this pack was 14.80 V, so 1.70 V is lost to internal resistance and wiring
 * under load. That is a large sag (11.5% of pack voltage) and worth
 * investigating — likely candidates are thin supply wiring, 18650 holder
 * contact resistance, aged cells, or one weak cell in the series string.
 *
 * RE-MEASURE THIS AFTER EVERY CHARGE. Every speed in the firmware derives
 * from it, so the error is multiplicative:
 *     set too HIGH -> robot runs slower than configured   (tolerable)
 *     set too LOW  -> robot runs faster than configured   (overshoots corners)
 * On a previous robot this was left stale at a nearly-flat value after a
 * recharge. Every speed then came out ~39% hot, and turning the cruise setting
 * down did not help because the error scaled everything together. It read as a
 * tuning problem for several rounds before anyone re-measured the battery. */
constexpr float V_BATT_NOMINAL = 13.10f;

/* MEASURED, calibration test 7 — supply terminals minus motor terminals,
 * both read during the same run at the same duty.
 *
 * The L298 is an old Darlington bridge, not a MOSFET one. Current passes
 * through two Darlington pairs (one sourcing, one sinking), each dropping
 * roughly 0.7-1.5 V. This is why the motor never sees full pack voltage. */
constexpr float V_DROP_L298 = 1.50f;

/* DATASHEET — the motor's rated maximum. Exceeding it shortens motor life, so
 * every computed duty is clamped to whatever delivers this voltage. */
constexpr float V_MOTOR_MAX = 6.00f;

/* =============================================================================
 *  SPEEDS — specified in VOLTS, never in duty
 * -----------------------------------------------------------------------------
 *  A DC motor responds to voltage. Duty only maps to voltage given a known
 *  supply, and this pack swings as it discharges. Specifying volts and
 *  converting at runtime means one battery constant fixes every speed at once.
 * ========================================================================== */

/* MEASURED, calibration test 8 — manual duty stepping, wheels off the ground.
 *
 *     left  wheel first turned at duty 80  ->  3.64 V
 *     right wheel first turned at duty 84  ->  3.82 V
 *
 * The RIGHT motor is the weaker of the two, so it sets the floor. Using the
 * left motor's lower figure would leave the right wheel stalled while the left
 * kept turning, and the robot would curve for reasons no steering tuning could
 * explain.
 *
 * This is the BREAKAWAY threshold — the voltage needed to overcome static
 * friction from a dead stop. It is NOT the same thing as running speed, and on
 * this robot the two disagree in direction: the left motor is easier to START
 * (80 vs 84) but SLOWER once running (see MOTOR_TRIM_LEFT below). Breakaway is
 * stiction; running speed is back-EMF and load. Do not use one to predict the
 * other. */
constexpr float V_START = 3.82f;

/* CHOSEN — safety multiplier over the measured breakaway threshold.
 *     floor = V_START * START_MARGIN = 3.82 * 1.05 = 4.01 V
 *
 * The margin absorbs a rubbing wheel, dust on the floor, a slight incline, or
 * a partly discharged pack. Cut it too fine and a wheel stalls mid-turn, which
 * presents as a steering fault rather than a power one. */
constexpr float START_MARGIN = 1.05f;

/* CHOSEN — the primary tuning knob. Raise for speed, lower for stability.
 *
 * Margin above the stall floor:  4.50 - 4.01 = 0.49 V
 *
 * That headroom is what lets the steering slow the inner wheel during a turn
 * without dropping it through the floor. An earlier candidate of 4.20 V left
 * only 0.19 V, which is the condition that made turns unpredictable on a
 * previous robot — "slow the inner wheel" silently meant "stall the inner
 * wheel".
 *
 * Usable band on this robot: 4.01 V (floor) to 6.00 V (motor rating). */
constexpr float V_CRUISE = 4.50f;

/* CHOSEN — in-place rotation speed, used when the line is under an outer
 * sensor only, and during corner recovery pivots.
 *
 * Kept above cruise because a pivot must overcome the scrubbing friction of
 * both tyres turning against the floor, which is higher than rolling friction.
 * Well under the 6.00 V ceiling. */
constexpr float V_SPIN = 5.20f;

/* =============================================================================
 *  STEERING DIFFERENTIALS — also in volts
 * -----------------------------------------------------------------------------
 *  These are the DIFFERENCE between outer and inner wheel speed at each error
 *  level. Turn rate is set by that difference, not by the absolute speeds, so
 *  the steering code holds the difference fixed and slides the pair upward if
 *  the inner wheel would fall below the floor. Turn authority is therefore
 *  independent of how low V_CRUISE is set.
 *
 *  Specified in volts so cornering does not fade as the pack drains. A fixed
 *  duty offset would mean progressively weaker turns at lower battery voltage.
 *
 *  CHOSEN — starting points, to be tuned against real tracking behaviour:
 *      robot drifts before correcting  -> raise
 *      robot weaves side to side       -> lower
 * ========================================================================== */
constexpr float DIFF_NEAR_V = 0.90f;   /* |error| == 500                      */
constexpr float DIFF_FAR_V  = 1.60f;   /* |error| == 1000                     */
                                       /* 1500 -> brake the inner wheel       */
                                       /* 2000 -> counter-rotate              */

/* =============================================================================
 *  MOTOR DIRECTION
 * ========================================================================== */

/* MEASURED, calibration test 5 — both wheels driven at positive duty, wheels
 * off the ground, and both observed running forward.
 *
 * Note how this was achieved: the left motor initially ran backwards, and that
 * was corrected by swapping LEFT_IN_A and LEFT_IN_B in pins.h rather than by
 * setting a flag here. Both are valid fixes — one corrects the wiring
 * description, the other the interpretation. Do not "fix" it again with a flag
 * or you will double-invert it. */
constexpr bool LEFT_INVERT  = false;
constexpr bool RIGHT_INVERT = false;

/* =============================================================================
 *  MOTOR TRIM
 * -----------------------------------------------------------------------------
 *  MEASURED, calibration test 9 — both wheels at equal duty on the floor:
 *
 *      forward distance d = 2400 mm
 *      lateral drift    y = 1100 mm, to the LEFT
 *      repeated twice, identical both times
 *      drifted left in BOTH orientations, so it is the robot, not floor slope
 *
 *      R = (d^2 + y^2) / 2y = (2400^2 + 1100^2) / 2200 = 3168 mm
 *      k = (R - W/2) / (R + W/2) = (3168 - 60) / (3168 + 60) = 0.963
 *
 *  with track width W = 120 mm. The left wheel runs about 3.7% slower.
 *
 *  APPLICATION: multiply the LEFT wheel's duty by (1 / 0.963) to speed it up,
 *  or equivalently scale the RIGHT wheel down. Scaling the slower wheel UP is
 *  preferred, because scaling down would eat into the stall-floor margin.
 *
 *  TWO CAVEATS worth keeping in mind:
 *
 *  1. This was measured at duty 132, the full 6.00 V — not at the 4.50 V
 *     cruise this firmware actually uses. Trim can vary with speed. Re-run
 *     test 9 at cruise duty and update this if tracking is off.
 *
 *  2. A 3.7% electrical mismatch is small, yet it produced 1.1 m of drift over
 *     2.4 m, because a constant bias integrates into a curve. That magnitude
 *     is also consistent with a MECHANICAL cause — a dragging caster, a wheel
 *     lightly rubbing the chassis, or a wheel diameter difference. A software
 *     trim compensating a mechanical fault works until the load or battery
 *     state shifts, then it is wrong in a new way. Worth spinning the caster
 *     by hand before accepting this as permanent.
 * ========================================================================== */
constexpr float MOTOR_TRIM_LEFT  = 1.0f / 0.963f;   /* ~1.038, speed it up    */
constexpr float MOTOR_TRIM_RIGHT = 1.0f;            /* reference wheel        */

/* =============================================================================
 *  GEOMETRY
 * ========================================================================== */

/* MEASURED with a ruler — wheel axle centreline forward to the line of sensor
 * centres, along the robot's centreline.
 *
 * Sets how far the robot must roll after losing the line before the AXLE
 * reaches a corner:
 *     advance distance = SENSOR_AHEAD_MM - LINE_WIDTH_MM / 2 = 90 - 35 = 55 mm
 * Pivoting before the axle arrives means rotating about the wrong point. */
constexpr float SENSOR_AHEAD_MM = 90.0f;

/* MEASURED — the tape width. */
constexpr float LINE_WIDTH_MM = 70.0f;

/* MEASURED — underside of the sensor board down to the floor.
 *
 * OUT OF SPEC. TCRT5000-class sensors are rated roughly 2-12 mm, optimal ~3.
 * At 15 mm two things degrade:
 *
 *   Reflected signal falls off as roughly 1/d^2 — about 25x weaker than at
 *   3 mm. Calibration test 2 still showed clean switching, so there is enough
 *   signal, but less margin than it appears.
 *
 *   The emitter beam spreads in a cone, so each sensor averages a wider patch
 *   of floor as height increases: roughly 2 mm at 3 mm height, roughly 10-11
 *   mm at 15 mm. The line reads WIDER than it is and position resolution
 *   degrades. No software can recover that information.
 *
 * If tracking turns out mushy or corners are unreliable, LOWER THE BOARD
 * FIRST. It is a bracket or a couple of standoffs, not a constant. */
constexpr float RIDE_HEIGHT_MM = 15.0f;

/* MEASURED — track width, wheel contact centre to wheel contact centre.
 * Taken as outer-to-outer (150 mm) minus one tyre width (30 mm).
 * Used in the trim calculation above. */
constexpr float TRACK_WIDTH_MM = 120.0f;

/* =============================================================================
 *  CHASSIS SPEED
 * -----------------------------------------------------------------------------
 *  MEASURED, calibration test 10 — 1100 mm covered in a 2 s run, so 550 mm/s.
 *
 *  *** THIS VALUE IS FOR DUTY 132 (6.00 V), NOT FOR THE 4.50 V CRUISE ***
 *
 *  Speed does not scale linearly with voltage near the start threshold, so the
 *  cruise speed cannot be computed from this — it has to be measured at the
 *  cruise duty. Until that is done, the corner advance timing derived from it
 *  is a guess.
 *
 *  TO FIX: flash the firmware, note the cruise duty it reports, re-run
 *  calibration test 10 at that duty, and replace the number below.
 *
 *  Sanity check for whatever you measure: test 9 independently covered 2400 mm
 *  in 4 s at the same duty, which predicts 1200 mm in 2 s. The 1100 mm result
 *  agrees within 8%, the gap explained by acceleration from standstill.
 * ========================================================================== */
constexpr float ROBOT_SPEED_MMPS = 550.0f;   /* AT DUTY 132 — re-measure      */

/* =============================================================================
 *  CONTROL TUNING
 * ========================================================================== */

/* CHOSEN — error magnitude below which the robot is considered centred.
 *
 * With digital sensors the weighted position lands only on multiples of 500,
 * so error takes exactly five magnitudes: 0, 500, 1000, 1500, 2000. This must
 * stay BELOW 500 or the entire first correction step is swallowed and the
 * robot ignores a real offset. On a previous robot a deadband of 600 meant a
 * 13 mm lateral error was reported as "straight ahead". */
constexpr int ERROR_DEADBAND = 250;

/* CHOSEN — above this error at the moment the line is lost, skip the forward
 * advance and pivot immediately.
 *
 * The advance only makes sense if the line was lost from a roughly centred,
 * straight-ahead state — the array running off the end of the tape at a
 * corner, with the axle still behind the junction. If the robot was already
 * far off the line, rolling forward carries it FURTHER away and the pivot
 * cannot reach back. */
constexpr int ADVANCE_MAX_ERR = 1000;

/* CHOSEN — how long to sweep before giving up on finding the line. Generous,
 * because reacquiring ends the pivot immediately; an over-long timeout costs
 * nothing, while too short a one abandons a corner mid-turn. */
constexpr unsigned long PIVOT_TIMEOUT_MS = 1500;

/* =============================================================================
 *  AUTOSTART AND STOP
 * ========================================================================== */

/* CHOSEN — how long a line must be seen before following begins. Zero means
 * the first frame that detects anything starts the robot. Raise to 100-200 ms
 * if it triggers on a hand while you carry it to the track. */
constexpr unsigned long LINE_HOLD_MS = 0;

/* CHOSEN — how long all five channels must read black before stopping.
 *
 * All-five-black is ambiguous: a stop bar, a wide corner blob, the array
 * parked square on the tape, or the sensors lifted out of range. Duration is
 * what separates them — a real stop bar gives several hundred milliseconds at
 * cruise, a corner transient gives tens.
 *
 * SCALES WITH SPEED. This corresponds to a fixed DISTANCE travelled, so if you
 * change V_CRUISE this value must change inversely: slower robot means the
 * same distance takes LONGER, so the timeout goes UP, not down. Getting that
 * backwards makes the robot halt at corners instead of turning them. */
constexpr unsigned long ALL_BLACK_STOP_MS = 150;

/* CHOSEN — how long the array must see nothing at all (robot lifted clear)
 * before it re-arms after stopping. */
constexpr unsigned long RE_ARM_CLEAR_MS = 500;

/* =============================================================================
 *  LOOP PACING
 * -----------------------------------------------------------------------------
 *  CHOSEN. The sampling limit is
 *      omega_max = sensor_spot / (samples_needed * loop_period * radius)
 *  With a ~5 mm optical spot, 3 samples and a 90 mm sensor radius:
 *      4 ms loop -> 4.6 rad/s   (an in-place spin can exceed this)
 *      2 ms loop -> 9.3 rad/s   (clears every usable speed)
 *  When rotation outruns the sensors, sample faster rather than turning
 *  slower — an earlier firmware made the opposite choice and slowed the turn,
 *  which did not fix the real problem.
 * ========================================================================== */
constexpr int LOOP_PERIOD_MS = 1;