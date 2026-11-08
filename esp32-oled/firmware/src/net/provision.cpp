#include "provision.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFiClientSecure.h>

#include "build_config.h"
#include "display.h"
#include "root_certs.h"

namespace provision {
namespace {

constexpr const char *NVS_NAMESPACE = "oled";
constexpr uint16_t TIMEOUT_MS = 65000;  // HTTPClient's limit is 65535

}  // namespace

bool load(Credentials &out) {
  Preferences prefs;
  prefs.begin(NVS_NAMESPACE, true);
  out.deviceId = prefs.getString("id", "");
  out.secret = prefs.getString("secret", "");
  prefs.end();
  return out.deviceId.length() > 0 && out.secret.length() > 0;
}

void save(const Credentials &creds) {
  Preferences prefs;
  prefs.begin(NVS_NAMESPACE, false);
  prefs.putString("id", creds.deviceId);
  prefs.putString("secret", creds.secret);
  prefs.end();
}

void forget() {
  Preferences prefs;
  prefs.begin(NVS_NAMESPACE, false);
  prefs.clear();
  prefs.end();
}

Result registerDevice(Credentials &out) {
  WiFiClientSecure tls;
  tls.setCACert(ROOT_CERTS);

  HTTPClient http;
  http.setConnectTimeout(TIMEOUT_MS);
  http.setTimeout(TIMEOUT_MS);
  if (!http.begin(tls, API_URL "/api/admin/devices")) return {false, "bad API_URL"};
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Provision-Key", PROVISION_KEY);

  JsonDocument body;
  body["kind"] = "hardware";
  body["display"] = display::controllerName();
  body["fw"]["version"] = FW_VERSION;
  body["fw"]["gitSha"] = FW_GIT_SHA;
  body["fw"]["builtAt"] = FW_BUILT_AT;
  String json;
  serializeJson(body, json);

  int status = http.POST(json);
  if (status <= 0) {
    String error = HTTPClient::errorToString(status);
    http.end();
    return {false, error};
  }
  String response = http.getString();
  http.end();

  JsonDocument reply;
  if (deserializeJson(reply, response)) return {false, "HTTP " + String(status) + " not JSON"};
  if (status != 201) {
    const char *code = reply["error"]["code"] | "error";
    return {false, "HTTP " + String(status) + " " + code};
  }

  out.deviceId = reply["deviceId"] | "";
  out.secret = reply["secret"] | "";
  if (out.deviceId.isEmpty() || out.secret.isEmpty()) return {false, "reply missing fields"};
  return {true, ""};
}

}  // namespace provision
