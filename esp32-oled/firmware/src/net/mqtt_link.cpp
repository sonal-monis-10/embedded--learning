#include "mqtt_link.h"

#include <WiFi.h>
#include <mqtt_client.h>

#include "build_config.h"
#include "root_certs.h"

namespace mqtt_link {
namespace {

constexpr int QUEUE_LENGTH = 16;  // tilt arrives at up to 30/s
constexpr int KEEPALIVE_S = 30;
constexpr int NETWORK_TIMEOUT_MS = 20000;  // TLS + WebSocket handshake via Render
constexpr int RECONNECT_MS = 5000;

QueueHandle_t queue;
esp_mqtt_client_handle_t client;

// Kept for the client's lifetime: esp-mqtt keeps pointers to these strings.
String username, password, statusTopic, prefix;

const char *const OFFLINE = "{\"online\":false}";

void push(const Event &event) {
  // Never block esp-mqtt's task; a full queue drops the event (only tilt
  // readings arrive fast enough for that, and the next one follows).
  xQueueSend(queue, &event, 0);
}

Topic topicFrom(const char *name, int length) {
  String topic(name, length);
  if (!topic.startsWith(prefix)) return Topic::Other;
  String leaf = topic.substring(prefix.length());
  if (leaf == "pairing") return Topic::Pairing;
  if (leaf == "mode") return Topic::Mode;
  if (leaf == "imu") return Topic::Imu;
  if (leaf == "cmd") return Topic::Cmd;
  return Topic::Other;
}

void publishOnline() {
  char body[160];
  snprintf(body, sizeof body,
           "{\"online\":true,\"fw\":\"%s\",\"sha\":\"%s\",\"rssi\":%d,\"ip\":\"%s\"}",
           FW_VERSION, FW_GIT_SHA, WiFi.RSSI(), WiFi.localIP().toString().c_str());
  esp_mqtt_client_publish(client, statusTopic.c_str(), body, 0, 1, true);
}

void onEvent(void *, esp_event_base_t, int32_t id, void *data) {
  auto *event = static_cast<esp_mqtt_event_handle_t>(data);
  Event out{};

  switch (static_cast<esp_mqtt_event_id_t>(id)) {
    case MQTT_EVENT_CONNECTED:
      for (const char *leaf : {"pairing", "mode", "imu", "cmd"}) {
        esp_mqtt_client_subscribe(client, (prefix + leaf).c_str(), 0);
      }
      publishOnline();
      out.type = EventType::Connected;
      push(out);
      break;

    case MQTT_EVENT_DISCONNECTED:
      out.type = EventType::Disconnected;
      push(out);
      break;

    case MQTT_EVENT_ERROR:
      // Mosquitto answers a wrong ID or secret with CONNACK code 5
      // (not authorised); 4 is a bad username or password.
      if (event->error_handle->error_type == MQTT_ERROR_TYPE_CONNECTION_REFUSED &&
          (event->error_handle->connect_return_code == MQTT_CONNECTION_REFUSE_NOT_AUTHORIZED ||
           event->error_handle->connect_return_code == MQTT_CONNECTION_REFUSE_BAD_USERNAME)) {
        out.type = EventType::AuthRejected;
        push(out);
      }
      break;

    case MQTT_EVENT_DATA:
      // Only whole messages: ours are far smaller than the 4 KB buffer.
      if (event->current_data_offset != 0 || event->data_len != event->total_data_len) break;
      if (event->data_len >= static_cast<int>(sizeof out.payload)) break;
      out.type = EventType::Message;
      out.topic = topicFrom(event->topic, event->topic_len);
      memcpy(out.payload, event->data, event->data_len);
      out.payload[event->data_len] = '\0';
      push(out);
      break;

    default:
      break;
  }
}

}  // namespace

void start(const String &deviceId, const String &secret) {
  queue = xQueueCreate(QUEUE_LENGTH, sizeof(Event));
  username = deviceId;
  password = secret;
  prefix = "d/" + deviceId + "/";
  statusTopic = prefix + "status";

  esp_mqtt_client_config_t cfg = {};
  cfg.uri = BROKER_URL;
  cfg.cert_pem = ROOT_CERTS;
  cfg.client_id = username.c_str();
  cfg.username = username.c_str();
  cfg.password = password.c_str();
  cfg.keepalive = KEEPALIVE_S;
  cfg.lwt_topic = statusTopic.c_str();
  cfg.lwt_msg = OFFLINE;
  cfg.lwt_qos = 1;
  cfg.lwt_retain = 1;
  cfg.buffer_size = 4096;
  cfg.network_timeout_ms = NETWORK_TIMEOUT_MS;
  cfg.reconnect_timeout_ms = RECONNECT_MS;

  client = esp_mqtt_client_init(&cfg);
  esp_mqtt_client_register_event(client, MQTT_EVENT_ANY, onEvent, nullptr);
  esp_mqtt_client_start(client);  // connects and reconnects on its own
}

bool poll(Event &out) { return queue && xQueueReceive(queue, &out, 0) == pdTRUE; }

}  // namespace mqtt_link
