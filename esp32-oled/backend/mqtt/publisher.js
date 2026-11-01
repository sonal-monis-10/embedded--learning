// Everything the backend sends to devices, one function per topic
// (docs/plan/README.md §6). Step 3 plugs in the real Mosquitto client with
// usePublisher(); until then messages go to a stand-in that only records
// them, which is also what the tests read.

const recorded = [];

const standIn = {
  publish(topic, payload, { retain = false } = {}) {
    recorded.push({ topic, payload, retain });
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
  transport.publish(`d/${deviceId}/imu`, reading);
}

export function publishCommand(deviceId, command) {
  transport.publish(`d/${deviceId}/cmd`, command);
}
