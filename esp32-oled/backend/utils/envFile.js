// Builds the devices/<id>.env file the firmware build reads.
//
// Every value is written as a JSON string (KEY="value"), so Wi-Fi passwords
// with spaces, '#', quotes or backslashes survive unchanged. The firmware's
// gen_config.py reads each value back with json.loads().
export function buildEnvFile({ deviceId, secret, brokerUrl, wifiSsid, wifiPassword }) {
  const lines = [
    `# Device ${deviceId}: SECRET, never commit or share this file.`,
    `# Build with: make firmware DEVICE=${deviceId}`,
    `DEVICE_ID=${JSON.stringify(deviceId)}`,
    `DEVICE_SECRET=${JSON.stringify(secret)}`,
    `BROKER_URL=${JSON.stringify(brokerUrl)}`,
    `WIFI_SSID=${JSON.stringify(wifiSsid)}`,
    `WIFI_PASS=${JSON.stringify(wifiPassword)}`,
  ];
  return `${lines.join('\n')}\n`;
}
