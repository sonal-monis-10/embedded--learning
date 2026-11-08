#include "app.h"

#include <ArduinoJson.h>
#include <WiFi.h>

#include "build_config.h"
#include "display.h"
#include "modes/eyes.h"
#include "modes/music.h"
#include "net/mqtt_link.h"
#include "net/provision.h"
#include "screens/screens.h"

namespace app {
namespace {

constexpr uint32_t FRAME_MS = 33;  // ~30 frames per second
constexpr uint32_t SETUP_RETRY_MS = 60000;
constexpr uint32_t WIFI_HINT_AFTER_MS = 20000;
constexpr uint32_t IDENTIFY_MS = 3000;
constexpr int AUTH_REJECTS_BEFORE_RESET = 3;
constexpr uint32_t AUTH_REJECT_WINDOW_MS = 30000;
constexpr uint8_t BOOT_BUTTON = 0;

enum class State { Wifi, Registering, SetupFailed, Connecting, Online };
enum class Mode { Idle, Eyes, Music };

State state = State::Wifi;
provision::Credentials creds;
bool haveCreds = false;
bool mqttStarted = false;

String setupError;
uint32_t retryAtMs = 0;
uint32_t wifiSinceMs = 0;

int authRejects = 0;
uint32_t firstRejectMs = 0;

// What the backend last told us (retained messages arrive on connect).
bool pairingShown = false;
String pairingCode, pairingUrl;
Mode mode = Mode::Idle;
uint32_t identifyUntilMs = 0;

bool dirty = true;  // static screens redraw only when something changed
uint32_t lastFrameMs = 0;

void enter(State next) {
  if (state == next) return;
  static const char *const names[] = {"WIFI", "REGISTERING", "SETUP_FAILED", "CONNECTING", "ONLINE"};
  Serial.printf("[app] %s -> %s\n", names[static_cast<int>(state)], names[static_cast<int>(next)]);
  state = next;
  dirty = true;
}

String wifiHint() {
  switch (WiFi.status()) {
    case WL_NO_SSID_AVAIL: return "network not found";
    case WL_CONNECT_FAILED: return "wrong password?";
    default: return "still trying";
  }
}

void drawScreen(uint32_t nowMs) {
  switch (state) {
    case State::Wifi:
      screens::status("Connecting to Wi-Fi", WIFI_SSID,
                      nowMs - wifiSinceMs > WIFI_HINT_AFTER_MS ? wifiHint() : "");
      break;
    case State::Registering:
      screens::status("Setting up", "registering device", "can take a minute");
      break;
    case State::SetupFailed:
      screens::status("Setup failed", setupError,
                      "retry in " + String((retryAtMs - nowMs) / 1000 + 1) + " s");
      break;
    case State::Connecting:
      screens::status("Connecting", creds.deviceId, "waking the server...");
      break;
    case State::Online:
      if (pairingShown) {
        screens::pairing(creds.deviceId, pairingCode, pairingUrl);
      } else if (mode == Mode::Eyes) {
        eyes::draw(nowMs);
      } else if (mode == Mode::Music) {
        music::draw(nowMs);
      } else {
        screens::idle();
      }
      break;
  }
}

// Screens that change every frame; the rest redraw only when dirty.
bool animating() {
  return state == State::SetupFailed ||
         (state == State::Online && !pairingShown && mode != Mode::Idle);
}

void onPairing(const char *payload) {
  JsonDocument doc;
  // Empty = the backend cleared it: someone paired, or the device is busy.
  pairingShown = payload[0] != '\0' && !deserializeJson(doc, payload) && doc["code"].is<const char *>();
  if (pairingShown) {
    pairingCode = doc["code"].as<const char *>();
    pairingUrl = doc["url"] | "";
    Serial.printf("[app] pairing code %s\n", pairingCode.c_str());
  } else {
    Serial.println("[app] pairing cleared");
  }
  dirty = true;
}

void onMode(const char *payload) {
  JsonDocument doc;
  if (deserializeJson(doc, payload)) return;
  String name = doc["mode"] | "idle";
  mode = name == "eyes" ? Mode::Eyes : name == "music" ? Mode::Music : Mode::Idle;
  Serial.printf("[app] mode %s\n", name.c_str());
  dirty = true;
}

void onImu(const char *payload, uint32_t nowMs) {
  JsonDocument doc;
  if (deserializeJson(doc, payload) || !doc.is<JsonArray>()) return;
  eyes::look(doc[0] | 0.0f, doc[1] | 0.0f, nowMs);
}

void onCommand(const char *payload, uint32_t nowMs) {
  JsonDocument doc;
  if (deserializeJson(doc, payload)) return;
  String op = doc["op"] | "";
  Serial.printf("[app] command %s\n", op.c_str());
  if (op == "identify") {
    identifyUntilMs = nowMs + IDENTIFY_MS;
    display::setInverted(true);
  } else if (op == "brightness") {
    display::setBrightness(doc["value"] | 255);
  } else if (op == "reboot") {
    ESP.restart();
  }
}

void onAuthRejected(uint32_t nowMs) {
  // One refusal can be a broker still loading its logins after a restart;
  // several over half a minute mean this login is gone for good.
  if (authRejects == 0) firstRejectMs = nowMs;
  authRejects++;
  Serial.printf("[app] login refused (%d)\n", authRejects);
  if (authRejects >= AUTH_REJECTS_BEFORE_RESET && nowMs - firstRejectMs >= AUTH_REJECT_WINDOW_MS) {
    screens::status("Login refused", "registering again");
    display::show();
    provision::forget();
    delay(2000);
    ESP.restart();
  }
}

void handleEvents(uint32_t nowMs) {
  mqtt_link::Event event;
  while (mqtt_link::poll(event)) {
    switch (event.type) {
      case mqtt_link::EventType::Connected:
        authRejects = 0;
        enter(State::Online);
        break;
      case mqtt_link::EventType::Disconnected:
        enter(State::Connecting);
        break;
      case mqtt_link::EventType::AuthRejected:
        onAuthRejected(nowMs);
        break;
      case mqtt_link::EventType::Message:
        switch (event.topic) {
          case mqtt_link::Topic::Pairing: onPairing(event.text()); break;
          case mqtt_link::Topic::Mode: onMode(event.text()); break;
          case mqtt_link::Topic::Imu: onImu(event.text(), nowMs); break;
          case mqtt_link::Topic::Cmd: onCommand(event.text(), nowMs); break;
          case mqtt_link::Topic::MusicTrack: music::onTrack(event.text()); dirty = true; break;
          case mqtt_link::Topic::MusicLines: music::onLines(event.text()); dirty = true; break;
          case mqtt_link::Topic::MusicSync: music::onSync(event.text(), nowMs); break;
          case mqtt_link::Topic::Other: break;
        }
        mqtt_link::release(event);
        break;
    }
  }
}

void registerNow() {
  // Draw first: the request blocks while a sleeping server wakes.
  screens::status("Setting up", "registering device", "can take a minute");
  display::show();

  provision::Result result = provision::registerDevice(creds);
  if (result.ok) {
    provision::save(creds);
    haveCreds = true;
    Serial.printf("[app] registered as %s\n", creds.deviceId.c_str());
    enter(State::Connecting);
  } else {
    setupError = result.error;
    retryAtMs = millis() + SETUP_RETRY_MS;
    Serial.printf("[app] registration failed: %s\n", setupError.c_str());
    enter(State::SetupFailed);
  }
}

// Hold BOOT while powering on for 3 s to forget the saved login.
void maybeFactoryReset() {
  pinMode(BOOT_BUTTON, INPUT_PULLUP);
  if (digitalRead(BOOT_BUTTON) != LOW) return;
  screens::status("Keep holding BOOT", "to forget this device");
  display::show();
  uint32_t start = millis();
  while (millis() - start < 3000) {
    if (digitalRead(BOOT_BUTTON) != LOW) return;
    delay(20);
  }
  provision::forget();
  screens::status("Device forgotten", "release BOOT");
  display::show();
  while (digitalRead(BOOT_BUTTON) == LOW) delay(20);
}

}  // namespace

void begin() {
  Serial.printf("\n[app] esp32-oled %s (%s), display %s\n", FW_VERSION, FW_GIT_SHA,
                display::controllerName());
  maybeFactoryReset();
  haveCreds = provision::load(creds);
  Serial.printf("[app] %s\n", haveCreds ? ("saved login " + creds.deviceId).c_str() : "no saved login");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  wifiSinceMs = millis();
  dirty = true;
}

void tick() {
  uint32_t now = millis();
  bool wifiUp = WiFi.status() == WL_CONNECTED;

  if (!wifiUp && state != State::Wifi) {
    wifiSinceMs = now;
    enter(State::Wifi);
  }

  switch (state) {
    case State::Wifi:
      if (wifiUp) {
        Serial.printf("[app] Wi-Fi up, %s, RSSI %d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
        // Wall-clock time (UTC), so music sync can allow for message delay.
        configTime(0, 0, "pool.ntp.org", "time.google.com");
        enter(haveCreds ? State::Connecting : State::Registering);
      }
      break;
    case State::Registering:
      registerNow();
      break;
    case State::SetupFailed:
      if (static_cast<int32_t>(now - retryAtMs) >= 0) enter(State::Registering);
      break;
    case State::Connecting:
    case State::Online:
      if (!mqttStarted) {
        mqtt_link::start(creds.deviceId, creds.secret);
        mqttStarted = true;
      }
      break;
  }
  handleEvents(now);

  if (identifyUntilMs && static_cast<int32_t>(now - identifyUntilMs) >= 0) {
    identifyUntilMs = 0;
    display::setInverted(false);
  }

  if (now - lastFrameMs >= FRAME_MS && (dirty || animating())) {
    lastFrameMs = now;
    dirty = false;
    drawScreen(now);
    display::show();
  }
}

}  // namespace app
