// Device logins on the broker, as the routes see them. Once the broker is
// running, broker.js plugs in the Dynamic Security client; with
// MQTT_ENABLED=false (or in tests) these do nothing.

let dynsec = null;

export function useDynsec(next) {
  dynsec = next;
}

export async function createDeviceLogin(deviceId, secret) {
  await dynsec?.createClient(deviceId, secret, 'device');
}

// Also disconnects the device if it is online.
export async function deleteDeviceLogin(deviceId) {
  await dynsec?.deleteClient(deviceId);
}
