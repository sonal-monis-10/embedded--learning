// The device's connection state in plain words. Online/offline comes from
// the device's own status messages once the broker is connected; until a
// device has ever reported, it is "Not connected yet".
function deviceStatus(device) {
  if (device.online) return { tone: 'ok', label: 'On and connected' };
  if (!device.lastSeenAt) return { tone: 'idle', label: 'Not connected yet' };
  const time = new Date(device.lastSeenAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  return { tone: 'idle', label: `Offline since ${time}` };
}

export default function StatusPill({ device }) {
  const { tone, label } = deviceStatus(device);
  return (
    <span className={`pill pill-${tone}`}>
      <span className="pill-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
