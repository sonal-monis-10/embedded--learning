/* =============================================================================
 *  sensors.h — line detection
 * =============================================================================
 *  Turns five digital channels into one number: where the line is.
 *
 *  WHY DIGITAL, AND WHAT IT COSTS
 *  ------------------------------
 *  This sensor module carries a comparator and a trimpot, so it decides
 *  black-or-white in hardware and presents a clean logic level. There is no
 *  software threshold to set — the pot IS the threshold, and if a channel
 *  misreads, the fix is turning the pot, not editing a constant.
 *
 *  The cost is that a reading carries no information about HOW STRONGLY a
 *  sensor sees the line, only whether it does. Position resolution is
 *  therefore fixed by sensor spacing and cannot be improved in software.
 *
 *  THE POSITION SCALE
 *  ------------------
 *  Position runs 0..4000 across a five-sensor array, 1000 per sensor, with
 *  2000 meaning centred. It is the mean index of the sensors that see the
 *  line, scaled by 1000.
 *
 *  Because the sensors are binary, this lands ONLY on multiples of 500 —
 *  the average of a set of integers is either a whole number or a half. So
 *  error takes exactly five magnitudes: 0, 500, 1000, 1500, 2000.
 *
 *  That quantisation drives two decisions elsewhere:
 *    - ERROR_DEADBAND must stay below 500, or the entire first correction
 *      step is swallowed and a real offset reads as "straight ahead".
 *    - The steering ladder has five levels rather than a continuous gain,
 *      because a smooth curve buys nothing at this resolution.
 * ========================================================================== */

#pragma once

#include "pins.h"

/* One frame of sensor data. Filled by sampleSensors(), read by everything
 * else. Every consumer in a given loop iteration sees the same frame, so no
 * two decisions can disagree about what was observed. */
struct LineReading {
  bool onLine[SENSOR_COUNT];  /* per channel, already polarity-corrected     */
  bool found;                 /* at least one channel sees the line          */
  int  position;              /* 0..4000, valid only when found              */
  int  blackCount;            /* channels reading black, including outliers  */
  int  runStart;              /* first index of the run used for position    */
  int  runLength;             /* length of that run                          */
  bool hadGap;                /* black channels existed outside that run     */
};

extern LineReading g_line;

/* Count of frames where a black channel sat outside the chosen run. A high
 * count over a run means a channel is misbehaving — worth watching, but not
 * worth stopping for. */
extern unsigned long g_gapFrames;

/* Configure the sensor pins as inputs. Call once from setup(). */
void sensorsBegin();

/* Read all channels and compute the line position into g_line. */
void sampleSensors();

/* Every channel reads black.
 *
 * AMBIGUOUS IN A SINGLE FRAME. It can mean a stop bar, a corner blob wider
 * than the array, the array parked square on the tape, or the sensors lifted
 * out of sensing range. Callers must distinguish by DURATION, never by one
 * frame. */
bool allChannelsBlack();

/* No channel sees anything — off the track, or in the air. */
bool nothingDetected();

/* The centre channel has the line.
 *
 * This is the ONLY acceptable confirmation that a recovery pivot has finished.
 * An outer channel catching the line's edge partway through a sweep means the
 * line is passing by, not that the robot is centred on it — acting on that
 * hands control back while still off-centre, and the robot immediately loses
 * the line again. */
bool centreOnLine();