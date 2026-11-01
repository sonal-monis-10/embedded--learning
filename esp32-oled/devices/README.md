# devices/

Put the `<deviceId>.env` files you download from the dashboard here
(**Add device** → **Download .env**). The firmware build reads them:

```bash
make firmware DEVICE=oled-7k2m9q    # uses devices/oled-7k2m9q.env
```

**These files are secrets.** Each one holds a device's MQTT password and
your Wi-Fi password. `*.env` in this folder is git-ignored; never commit,
paste or share one. If a file leaks, rotate that device's secret on the
dashboard and rebuild.

Example of what a file contains (values made up):

```env
DEVICE_ID=oled-7k2m9q
DEVICE_SECRET=<43 random characters>
BROKER_URL=wss://<backend>.onrender.com/mqtt
WIFI_SSID=HomeWiFi
WIFI_PASS=<your Wi-Fi password>
```
