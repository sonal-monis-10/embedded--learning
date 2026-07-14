#include <Arduino.h>

/*
 * LINE FOLLOWER v4 — inner-wheel-off pivot steering, very slow
 * ------------------------------------------------------------
 * Steering model (as requested):
 *   - Line centered      -> both wheels forward at SLOW (creep straight)
 *   - Line off to a side -> INNER wheel = 0, OUTER wheel drives -> pivot toward line
 *   - Line lost          -> grace period, then recovery pivot
 *
 * Pivot direction: to reach a line on the LEFT you stop the LEFT (inner) wheel
 * and drive the RIGHT one (the stopped wheel is the pivot point, so the nose
 * swings toward it). Cutting the OUTER wheel instead would steer AWAY from the
 * line. If your bench test pivots the wrong way, swap the two marked lines.
 *
 * Sensors: binary, ~540 on line / 4095 off. Threshold at 2000. S1..S5 = left..right.
 */

// ================= PIN MAP =================
const int IR_COUNT = 5;
const int LINE_PINS[IR_COUNT] = { 36, 39, 34, 35, 32 };   // S1..S5 (left..right)

const int IN1 = 25, IN2 = 26, IN3 = 27, IN4 = 14;
const int ENA = 13, ENB = 33;
const int CH_A = 0, CH_B = 1;

// ================= PWM =================
const int PWM_FREQ = 1000, PWM_RES = 8;

// ================= SENSOR THRESHOLD =================
const int  LINE_THRESHOLD = 2000;
const bool LINE_IS_LOW    = true;   // on the line, raw value is BELOW threshold

// ================= SPEEDS (duty 0..255) =================
// VERY SLOW. If the bot stalls / won't start from rest, the motors are below
// their stall torque -> raise SLOW and MIN_PWM together until it moves reliably.
const int SLOW        = 40;    // straight-line creep speed
const int MAX_SPEED   = 90;    // cap on the driving (outer) wheel during a pivot
const int MIN_PWM     = 38;    // stiction floor: a moving wheel never commands below this
const int PIVOT_SPEED = 60;    // wheel speed during line-loss recovery

// How hard the outer wheel drives during a turn, scaled by how far off the line
// is. Higher = sharper pivots on tight offsets. 0 = same speed for every turn.
const float TURN_GAIN = 0.05f;

// ================= STEERING =================
const int CENTER_POS = (IR_COUNT - 1) * 1000 / 2;   // = 2000
const int DEADBAND   = 700;    // |error| within this = treat as centered (creep straight)

// ================= TIMING =================
const int LOOP_DELAY_MS = 4;
const int LOST_GRACE_MS = 40;  // keep last command this long before recovery pivot

// ================= STATE =================
int  rawValues[IR_COUNT];
bool onLine[IR_COUNT];
int  lastLineSign = 0;         // -1 line last seen left, +1 right
int  lastLeft = 0, lastRight = 0;
unsigned long lastSeenMs = 0;

// ================= SENSORS =================
void setupSensors() {
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
}

bool readPosition(int &position) {
  long weighted = 0;
  int  count = 0;
  for (int s = 0; s < IR_COUNT; s += 1) {
    rawValues[s] = analogRead(LINE_PINS[s]);
    bool on = LINE_IS_LOW ? (rawValues[s] < LINE_THRESHOLD)
                          : (rawValues[s] > LINE_THRESHOLD);
    onLine[s] = on;
    if (on) { weighted += (long)s * 1000; count += 1; }
  }
  if (count == 0) return false;
  position = (int)(weighted / count);
  return true;
}

// ================= MOTORS =================
int applyFloor(int sp) {
  if (sp > 0 && sp <  MIN_PWM) return  MIN_PWM;
  if (sp < 0 && sp > -MIN_PWM) return -MIN_PWM;
  return sp;
}

void setMotor(int inA, int inB, int ch, int sp) {
  sp = constrain(sp, -255, 255);
  if (sp > 0)      { digitalWrite(inA, HIGH); digitalWrite(inB, LOW);  ledcWrite(ch, sp);  }
  else if (sp < 0) { digitalWrite(inA, LOW);  digitalWrite(inB, HIGH); ledcWrite(ch, -sp); }
  else             { digitalWrite(inA, LOW);  digitalWrite(inB, LOW);  ledcWrite(ch, 0);   }
}

void setWheels(int l, int r) {
  setMotor(IN1, IN2, CH_A, l);
  setMotor(IN4, IN3, CH_B, r);   // IN4/IN3 order corrects right-motor polarity
  lastLeft = l; lastRight = r;
}

void stopMotors() { setWheels(0, 0); }

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(300);
  setupSensors();

  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  ledcSetup(CH_A, PWM_FREQ, PWM_RES); ledcAttachPin(ENA, CH_A);
  ledcSetup(CH_B, PWM_FREQ, PWM_RES); ledcAttachPin(ENB, CH_B);
  stopMotors();

  Serial.println("\n=== LINE FOLLOWER v4 (pivot / very slow) ===");
  lastSeenMs = millis();
}

// ================= MAIN LOOP =================
void loop() {
  int position;
  bool seen = readPosition(position);

  if (seen) {
    int error = position - CENTER_POS;     // <0 line left, >0 line right
    int mag   = abs(error);

    if (mag <= DEADBAND) {
      int s = applyFloor(SLOW);
      setWheels(s, s);                     // centered -> creep straight
    } else {
      int drive = SLOW + (int)(TURN_GAIN * (mag - DEADBAND));
      drive = applyFloor(constrain(drive, SLOW, MAX_SPEED));

      if (error > 0) setWheels(drive, 0);  // line RIGHT -> right(inner) off, left drives
      else           setWheels(0, drive);  // line LEFT  -> left(inner) off, right drives
      // --- To reverse pivot direction, swap the two lines above. ---
    }

    if (error > 0) lastLineSign = 1;
    else if (error < 0) lastLineSign = -1;
    lastSeenMs = millis();
  } else {
    if (millis() - lastSeenMs < LOST_GRACE_MS) {
      setWheels(lastLeft, lastRight);              // brief inter-sensor gap: coast
    } else if (lastLineSign >= 0) {
      setWheels(PIVOT_SPEED, -PIVOT_SPEED);        // recover toward last side (right)
    } else {
      setWheels(-PIVOT_SPEED, PIVOT_SPEED);        // recover toward last side (left)
    }
  }

  // Throttled debug (comment out once tuned).
  static unsigned long tDbg = 0;
  if (millis() - tDbg > 150) {
    tDbg = millis();
    Serial.printf("on: %d %d %d %d %d  pos:%s%d\n",
      onLine[0], onLine[1], onLine[2], onLine[3], onLine[4],
      seen ? " " : " LOST ", seen ? position : -1);
  }

  delay(LOOP_DELAY_MS);
}