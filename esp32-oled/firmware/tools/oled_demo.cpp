// =============================================================================
//  ESP32 + SSD1306 OLED (128x64, I2C) — "Hello, ESP32!" + counter demo
// =============================================================================
//
//  WIRING
//      OLED VCC -> ESP32 3V3
//      OLED GND -> ESP32 GND
//      OLED SDA -> GPIO 21 (D21)
//      OLED SCL -> GPIO 22 (D22)
//
//  HOW IT WORKS
//      The library keeps a 1024-byte copy of the screen in RAM (128 x 64 pixels,
//      1 bit each). print(), drawLine(), fillRect() only change that RAM copy.
//      display.display() sends the whole 1024 bytes over I2C — only then does
//      the screen change. Forget display() and you see nothing.
// =============================================================================

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>

// Two common controllers sit on these modules. The SSD1306 (usually 0.96")
// and the SH1106 (usually 1.3"). The SH1106 accepts SSD1306 commands but not
// its addressing mode, so the wrong driver leaves the power-on noise on screen.
// Build with -DUSE_SH1106 (env: oled_sh1106) for SH1106 modules.
#ifdef USE_SH1106
#include <Adafruit_SH110X.h>
#define OLED_WHITE  SH110X_WHITE
#define DRIVER_NAME "SH1106"
#else
#include <Adafruit_SSD1306.h>
#define OLED_WHITE  SSD1306_WHITE
#define DRIVER_NAME "SSD1306"
#endif

// ---------------------------------------------------------------------------
//  Configuration
// ---------------------------------------------------------------------------
constexpr int SCREEN_WIDTH  = 128;
constexpr int SCREEN_HEIGHT = 64;
constexpr int OLED_RESET    = -1;    // no reset pin wired; share the ESP32 reset
constexpr uint8_t OLED_ADDR = 0x3C;  // some modules use 0x3D — run `make scanner`

constexpr int PIN_SDA = 21;
constexpr int PIN_SCL = 22;

constexpr uint32_t SERIAL_BAUD = 115200;  // must match monitor_speed in platformio.ini
constexpr uint32_t I2C_FREQ_HZ = 400000;  // 400 kHz "fast mode": ~7 ms per frame instead of ~25 ms
constexpr uint32_t SPLASH_MS   = 2000;
constexpr uint32_t RETRY_MS    = 1000;

// &Wire = use the ESP32's first hardware I2C controller.
#ifdef USE_SH1106
Adafruit_SH1106G display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
#else
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
#endif

static uint32_t counter = 0;

// Forward declarations. The Arduino IDE generates these for .ino files;
// in a real .cpp file (PlatformIO) we must write them ourselves.
static bool initDisplay();
static void showSplash();
static void drawFrame(uint32_t value);

// ---------------------------------------------------------------------------
//  setup() — runs once after every power-on or reset
//
//  1. Serial      Start the USB serial link so status messages reach
//                 `make monitor`.
//  2. Status LED  The on-board LED (GPIO 2) is our "something is wrong"
//                 signal. It works even with no computer attached.
//  3. I2C bus     Wire.begin() routes the ESP32's I2C controller to our
//                 SDA/SCL pins; setClock() raises the speed from 100 kHz to
//                 400 kHz so a full screen update takes ~7 ms.
//  4. Banner      Print which driver, address and pins this build expects.
//                 When something goes wrong, that line is the first thing to
//                 compare against your wiring.
//  5. Display     initDisplay() sends the controller its power-up command
//                 sequence. If the OLED does not answer (loose wire, wrong
//                 address) we do NOT freeze forever: we print a message,
//                 toggle the LED and try again every second. Fix the wire
//                 and the program continues on its own, with no reset needed.
//  6. Splash      Show "Hello, ESP32!" for two seconds, then loop() takes over.
// ---------------------------------------------------------------------------
void setup() {
    Serial.begin(SERIAL_BAUD);
    pinMode(LED_BUILTIN, OUTPUT);

    Wire.begin(PIN_SDA, PIN_SCL);
    Wire.setClock(I2C_FREQ_HZ);

    Serial.printf("\nOLED demo: %s at 0x%02X, SDA=GPIO%d SCL=GPIO%d\n",
                  DRIVER_NAME, OLED_ADDR, PIN_SDA, PIN_SCL);

    while (!initDisplay()) {
        Serial.println("OLED not responding - check wiring / address, retrying...");
        digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
        delay(RETRY_MS);
    }
    digitalWrite(LED_BUILTIN, LOW);

    Serial.println("OLED ready");
    showSplash();
    delay(SPLASH_MS);
}

void loop() {
    drawFrame(counter);
    Serial.printf("counter = %lu\n", (unsigned long)counter);
    counter++;
    delay(1000);
}

// ---------------------------------------------------------------------------
//  Screens
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
//  initDisplay() — send the controller its start-up commands
//
//  Returns true when the OLED acknowledged on the I2C bus, false otherwise.
//  The two libraries take different arguments, so the #ifdef lives here
//  instead of cluttering setup():
//    SH1106   begin(address, reset): `true` sends the reset sequence.
//    SSD1306  begin(vccMode, address): SSD1306_SWITCHCAPVCC tells the chip
//             to make its panel voltage with its internal charge pump, which
//             every common breakout board needs.
//  Calling it again after a failure is safe: the libraries allocate the
//  1024-byte screen buffer only once.
// ---------------------------------------------------------------------------
static bool initDisplay() {
#ifdef USE_SH1106
    return display.begin(OLED_ADDR, true);
#else
    return display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
#endif
}

static void showSplash() {
    display.clearDisplay();               // 1. wipe the RAM buffer
    display.setTextColor(OLED_WHITE);
    display.setTextSize(2);               // 12x16 px characters
    display.setCursor(4, 16);
    display.println("Hello,");
    display.setCursor(4, 36);
    display.println("ESP32!");
    display.display();                    // 2. push the buffer to the screen
}

static void drawFrame(uint32_t value) {
    display.clearDisplay();

    // Header (size 1 = 6x8 px characters, 21 per line)
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("ESP32 + OLED demo");
    display.drawLine(0, 10, SCREEN_WIDTH - 1, 10, OLED_WHITE);

    // Big counter
    display.setTextSize(2);
    display.setCursor(0, 18);
    display.print("Count:");
    display.print(value);

    // Progress bar: fills over 10 seconds, then restarts
    constexpr int BAR_X = 0, BAR_Y = 48, BAR_W = SCREEN_WIDTH, BAR_H = 12;
    int fill = map(value % 10, 0, 9, 0, BAR_W - 4);
    display.drawRect(BAR_X, BAR_Y, BAR_W, BAR_H, OLED_WHITE);           // outline
    display.fillRect(BAR_X + 2, BAR_Y + 2, fill, BAR_H - 4, OLED_WHITE);  // fill

    display.display();
}
