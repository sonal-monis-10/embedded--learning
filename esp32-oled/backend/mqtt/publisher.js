// Everything the backend sends to devices, one function per topic
// (docs/plan/README.md §6). broker.js plugs in the real Mosquitto client
// with usePublisher(); without a broker (MQTT_ENABLED=false, tests) messages
// go to a stand-in that only records them.

const recorded = [];

const standIn = {
  publish(topic, payload, { retain = false, qos = 1 } = {}) {
    recorded.push({ topic, payload, retain, qos });
  },
};

let transport = standIn;

export function usePublisher(next) {
  transport = next;
}

// The messages sent through the stand-in, oldest first. Tests only.
export function recordedMessages() {
  return recorded;
}

// A free device draws its ID, the QR and the code; null clears the screen.
export function publishPairing(deviceId, pairing) {
  transport.publish(`d/${deviceId}/pairing`, pairing, { retain: true });
}

export function publishMode(deviceId, mode) {
  transport.publish(`d/${deviceId}/mode`, { mode }, { retain: true });
}

export function publishImu(deviceId, reading) {
  // QoS 0: a lost reading is replaced by the next one 50 ms later.
  transport.publish(`d/${deviceId}/imu`, reading, { qos: 0 });
}

export function publishCommand(deviceId, command) {
  transport.publish(`d/${deviceId}/cmd`, command);
}
