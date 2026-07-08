#include <Arduino.h>

/*
 * LINE FOLLOWER — 5ch IR array + L298N (ESP32 core 2.x)
 * -----------------------------------------------------
 * Sensors: 0 = ON line, 1 = OFF line.
 * Gentle-arc turns: one wheel full, inner wheel slowed (both forward).
 * ENA/ENB jumpers OFF (PWM control). Wheels on ground once logic confirmed.
 * Power: motors from battery, ESP32 from LM2596S buck (5V), grounds common.
 */

// ================= SENSORS =================
const int IR_SENSORS = 5;
const int PIN_S1 = 36, PIN_S2 = 39, PIN_S3 = 34, PIN_S4 = 35, PIN_S5 = 32;
const int LINE_PINS[IR_SENSORS] = { PIN_S1, PIN_S2, PIN_S3, PIN_S4, PIN_S5 };
int lineValues[IR_SENSORS];   // 0 = on line, 1 = off line

// ================= MOTORS =================
const int IN1 = 25, IN2 = 26;   // Motor A (left)
const int IN3 = 27, IN4 = 14;   // Motor B (right)
const int ENA = 13, ENB = 33;   // PWM enables

const int PWM_FREQ = 1000, PWM_RES = 8;
const int CH_A = 0, CH_B = 1;

// ---- Speeds (0..255). Lower = slower/gentler. ----
const int SPEED     = 128;   // main forward / fast-wheel speed
const int TURN_SLOW = 45;    // slowed inner wheel during a turn — TUNE this

// ================= SENSOR FUNCTIONS =================

// Configure the five channels as digital inputs.
void setupSensors() {
  for (int s = 0; s < IR_SENSORS; s += 1) pinMode(LINE_PINS[s], INPUT);
}

// Read all five channels (0 = on line, 1 = off line).
void readLineSensors() {
  for (int s = 0; s < IR_SENSORS; s += 1) lineValues[s] = digitalRead(LINE_PINS[s]);
}

// ================= MOTOR FUNCTIONS =================

// Drive one motor. speed -255..255: + forward, - reverse, 0 stop.
void setMotor(int inA, int inB, int ch, int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 0)      { digitalWrite(inA, HIGH); digitalWrite(inB, LOW);  ledcWrite(ch, speed); }
  else if (speed < 0) { digitalWrite(inA, LOW);  digitalWrite(inB, HIGH); ledcWrite(ch, -speed); }
  else                { digitalWrite(inA, LOW);  digitalWrite(inB, LOW);  ledcWrite(ch, 0); }
}

// Set both wheels at once (left, right).
void setWheels(int left, int right) {
  setMotor(IN1, IN2, CH_A, left);
  setMotor(IN4, IN3, CH_B, right);
}

// ================= MOVEMENT FUNCTIONS =================

// Both wheels forward at SPEED.
void forward() { setWheels(SPEED, SPEED); }

// Gentle right: left wheel full, right (inner) wheel slowed. Arcs right.
void right() { setWheels(SPEED, TURN_SLOW); }

// Gentle left: right wheel full, left (inner) wheel slowed. Arcs left.
void left() { setWheels(TURN_SLOW, SPEED); }

// Both wheels stopped.
void stop() { setWheels(0, 0); }

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(300);

  setupSensors();

  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  ledcSetup(CH_A, PWM_FREQ, PWM_RES); ledcAttachPin(ENA, CH_A);
  ledcSetup(CH_B, PWM_FREQ, PWM_RES); ledcAttachPin(ENB, CH_B);

  stop();
  Serial.println("\n=== LINE FOLLOWER ready ===");
}

// ================= MAIN LOOP =================
void loop() {
  readLineSensors();

  // Shorthand: true = that sensor is ON the line (reads 0).
  bool s1 = (lineValues[0] == 0);   // far left
  bool s2 = (lineValues[1] == 0);
  bool s3 = (lineValues[2] == 0);   // center
  bool s4 = (lineValues[3] == 0);
  bool s5 = (lineValues[4] == 0);   // far right

  // ---- Decide movement from the pattern ----
  if (s3 || (s2 && s4)) {
    forward();            // line centered -> straight
  } else if (s4 || s5) {
    right();              // line drifted right -> arc right toward it
  } else if (s1 || s2) {
    left();               // line drifted left -> arc left toward it
  } else {
    stop();               // no sensor on line -> stop
  }

  // No delay() — fast loop = smoother following.
}