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

// Music mode (docs/plan/phase-3-music.md). All three are retained, so a
// device that reconnects mid-song gets the song, its lyrics and the clock.
// Each carries the song ID; the device ignores pieces from another song.

// {id, title, artist, durationMs, lyrics, hasLyrics} or null.
export function publishTrack(deviceId, track) {
  transport.publish(`d/${deviceId}/music/track`, track, { retain: true });
}

// Plain text, "#<songId>" then one "<ms>\t<text>" per line; or null.
export function publishLines(deviceId, text) {
  transport.publish(`d/${deviceId}/music/lines`, text, { retain: true });
}

// {id, pos, playing, at}: the song was at `pos` ms at server time `at`.
export function publishSync(deviceId, sync) {
  transport.publish(`d/${deviceId}/music/sync`, sync, { retain: true });
}
