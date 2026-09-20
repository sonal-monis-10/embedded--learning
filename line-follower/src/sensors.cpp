/* =============================================================================
 *  sensors.cpp — line detection
 * =============================================================================
 *  See sensors.h for the interface and the position scale.
 * ========================================================================== */

#include <Arduino.h>
#include <math.h>
#include "config.h"
#include "pins.h"
#include "sensors.h"

LineReading g_line;
unsigned long g_gapFrames = 0;

/* Centre of the position scale: 2000 on a five-sensor array. */
static const int POSITION_CENTRE = (SENSOR_COUNT - 1) * 1000 / 2;

/* -----------------------------------------------------------------------------
 *  Setup
 *
 *  Plain INPUT, no pull resistor. The comparator on the sensor module drives
 *  the line actively in both directions, so a pull would only fight it.
 *
 *  Consequence worth knowing: if a wire comes loose the pin floats rather than
 *  settling at a known level. A channel whose reading never changes no matter
 *  what you wave under the array is almost always a wiring fault, not a
 *  sensitivity problem — check continuity before touching the pot.
 * -------------------------------------------------------------------------- */
void sensorsBegin() {
  for (int i = 0; i < SENSOR_COUNT; i++) pinMode(SENSOR_PINS[i], INPUT);
}

/* -----------------------------------------------------------------------------
 *  Find the longest unbroken run of black channels.
 *
 *  A real line sits under a contiguous group of sensors. It cannot produce a
 *  gap. So a pattern like [#.###] contains at least one channel that is wrong,
 *  and the question is what to do about it.
 *
 *  Three approaches, two of which fail:
 *
 *  AVERAGE EVERYTHING — take the mean index of all black channels. Simple, but
 *  one spurious channel at the far end drags the mean badly: [#...#] averages
 *  to dead centre, which is exactly where the line is NOT. It also reads
 *  [#.###] as a junction rather than as a fault.
 *
 *  REJECT GAPPED FRAMES — discard any frame that is not contiguous and reuse
 *  the previous one. Sounds safe, and is a trap. If one channel is
 *  SYSTEMATICALLY weak rather than occasionally noisy, every frame is gapped,
 *  every frame is rejected, and the robot never updates at all. On a previous
 *  build this froze the robot completely, with no error and no motion.
 *
 *  LONGEST RUN — what this does. Tolerates an outlier in either direction and
 *  always yields a usable position. One bad channel costs a little resolution
 *  instead of costing control.
 *
 *  Ties break toward the array centre, since a run straddling the middle is
 *  the more likely candidate for the real line.
 * -------------------------------------------------------------------------- */
static void findLongestRun(LineReading &r) {
  r.runStart  = -1;
  r.runLength = 0;

  const float arrayCentre = (SENSOR_COUNT - 1) / 2.0f;

  int i = 0;
  while (i < SENSOR_COUNT) {
    if (!r.onLine[i]) { i++; continue; }

    int j = i;
    while (j < SENSOR_COUNT && r.onLine[j]) j++;
    const int length = j - i;

    if (length > r.runLength) {
      r.runLength = length;
      r.runStart  = i;
    } else if (length == r.runLength && r.runStart >= 0) {
      const float midNew = i + (length - 1) / 2.0f;
      const float midOld = r.runStart + (r.runLength - 1) / 2.0f;
      if (fabsf(midNew - arrayCentre) < fabsf(midOld - arrayCentre)) r.runStart = i;
    }

    i = j;
  }
}

/* -----------------------------------------------------------------------------
 *  Read every channel and compute the position.
 *
 *  LINE_ACTIVE_LEVEL converts the raw logic level into meaning. Comparator
 *  modules differ in polarity and some have an inverting jumper, so the
 *  interpretation is a constant rather than an assumption baked into the code.
 *
 *  Position is the mean index of the chosen run, scaled by 1000. With binary
 *  sensors that mean is always a whole or half number, which is why position
 *  lands only on multiples of 500.
 * -------------------------------------------------------------------------- */
void sampleSensors() {
  LineReading &r = g_line;

  r.blackCount = 0;
  for (int i = 0; i < SENSOR_COUNT; i++) {
    r.onLine[i] = (digitalRead(SENSOR_PINS[i]) == LINE_ACTIVE_LEVEL);
    if (r.onLine[i]) r.blackCount++;
  }

  findLongestRun(r);

  r.hadGap = (r.runLength > 0) && (r.blackCount != r.runLength);
  if (r.hadGap) g_gapFrames++;

  if (r.runLength == 0) {
    r.found = false;
    r.position = 0;
    return;
  }

  long weighted = 0;
  for (int k = r.runStart; k < r.runStart + r.runLength; k++) {
    weighted += (long)k * 1000;
  }

  r.position = (int)(weighted / r.runLength);
  r.found = true;
}

/* -----------------------------------------------------------------------------
 *  Interpretation helpers.
 *
 *  These exist so the control and recovery layers never index into onLine[]
 *  directly. That keeps the meaning of a pattern in one place: if the array
 *  ever changes size, or the centre index moves, only this file needs editing.
 * -------------------------------------------------------------------------- */

bool allChannelsBlack() {
  return g_line.blackCount == SENSOR_COUNT;
}

bool nothingDetected() {
  return g_line.blackCount == 0;
}

bool centreOnLine() {
  return g_line.onLine[SENSOR_CENTRE_INDEX];
}