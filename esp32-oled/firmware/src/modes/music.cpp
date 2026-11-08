#include "music.h"

#include <ArduinoJson.h>
#include <sys/time.h>

#include "display.h"
#include "screens/screens.h"

namespace music {
namespace {

using display::HEIGHT;
using display::OFF;
using display::ON;
using display::WIDTH;

constexpr int CHAR_W = 6;  // built-in font at size 1, with spacing
constexpr int CHAR_H = 8;
constexpr int MAX_LINES = 400;
constexpr uint32_t SLEW_MS = 1000;      // small corrections ease in over this
constexpr int32_t SNAP_MS = 300;        // bigger ones (a seek) jump
constexpr uint32_t SLIDE_MS = 150;      // lyric line change
constexpr uint32_t GAP_MS = 5000;       // no line this long: instrumental
constexpr float DISC_RPM = 33.3f;
constexpr int64_t SANE_EPOCH_S = 1700000000;  // before this, SNTP hasn't synced yet

// ---- What the backend told us ----

struct Track {
  long id = 0;
  String title, artist;
  uint32_t durationMs = 0;
  bool lyrics = false;  // karaoke screen (else disc + progress)
} track;

struct Line {
  uint32_t t;
  const char *text;  // points into lineText
};
char *lineText = nullptr;  // our copy of music/lines, split in place
Line *lines = nullptr;
int lineCount = 0;
long linesId = 0;

// The clock: at local time baseMs the song was at basePos. A small
// correction `slew` fades out over SLEW_MS so the lyrics don't jump.
long syncId = 0;
bool playing = false;
int64_t basePos = 0;
uint32_t baseMs = 0;
int32_t slew = 0;

// Line change animation.
int shownLine = -2;
uint32_t lineChangedMs = 0;

// ---- Helpers ----

// Wall-clock time in ms (set by SNTP at boot), or -1 until it is set.
int64_t epochMs() {
  timeval tv;
  gettimeofday(&tv, nullptr);
  if (tv.tv_sec < SANE_EPOCH_S) return -1;
  return static_cast<int64_t>(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
}

uint32_t position(uint32_t nowMs) {
  int64_t pos = basePos + (playing ? static_cast<int64_t>(nowMs - baseMs) : 0);
  uint32_t since = nowMs - baseMs;
  if (since < SLEW_MS) pos += static_cast<int64_t>(slew) * (SLEW_MS - since) / SLEW_MS;
  if (pos < 0) return 0;
  if (track.durationMs && pos > track.durationMs) return track.durationMs;
  return static_cast<uint32_t>(pos);
}

void clearLines() {
  free(lines);
  free(lineText);
  lines = nullptr;
  lineText = nullptr;
  lineCount = 0;
  linesId = 0;
  shownLine = -2;
}

// Index of the line being sung at `pos`, or -1 before the first.
int lineAt(uint32_t pos) {
  int lo = 0, hi = lineCount - 1, found = -1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    if (lines[mid].t <= pos) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

String formatTime(uint32_t ms) {
  uint32_t s = ms / 1000;
  char buf[16];
  snprintf(buf, sizeof buf, "%lu:%02lu", static_cast<unsigned long>(s / 60),
           static_cast<unsigned long>(s % 60));
  return buf;
}

// Word-wraps `text` to `width` characters. Returns the number of rows,
// at most `maxRows`; `fits` is false if text was left over.
int wrap(const char *text, int width, String *rows, int maxRows, bool &fits) {
  String rest(text);
  int count = 0;
  while (rest.length() && count < maxRows) {
    if (static_cast<int>(rest.length()) <= width) {
      rows[count++] = rest;
      rest = "";
      break;
    }
    int cut = rest.lastIndexOf(' ', width);
    if (cut <= 0) cut = width;  // one long word: break it
    rows[count++] = rest.substring(0, cut);
    rest = rest.substring(cut);
    rest.trim();
  }
  fits = rest.length() == 0;
  return count;
}

void textAt(int x, int y, const String &value, uint8_t size = 1) {
  Adafruit_GFX &g = display::gfx();
  g.setTextSize(size);
  g.setTextColor(ON);
  g.setTextWrap(false);
  g.setCursor(x, y);
  g.print(value);
}

// Scrolls `value` sideways inside [x, WIDTH) when it is too long.
void marquee(int x, int y, const String &value, uint32_t nowMs) {
  int room = (WIDTH - x) / CHAR_W;
  if (static_cast<int>(value.length()) <= room) {
    textAt(x, y, value);
    return;
  }
  String loop = value + "    ";
  int cycle = loop.length() * CHAR_W;
  int shift = (nowMs / 40) % cycle;  // 25 px per second
  textAt(x - shift, y, loop + value);
}

void progressBar(int y, int h, uint32_t pos) {
  Adafruit_GFX &g = display::gfx();
  int w = track.durationMs ? static_cast<int64_t>(pos) * WIDTH / track.durationMs : 0;
  if (h > 1) g.drawRect(0, y, WIDTH, h, ON);
  g.fillRect(0, y, w, h, ON);
}

// A record: outline, grooves turning with the song, a label in the middle.
void disc(int cx, int cy, int r, uint32_t pos) {
  Adafruit_GFX &g = display::gfx();
  g.fillCircle(cx, cy, r, OFF);
  g.drawCircle(cx, cy, r, ON);
  float turns = pos / 60000.0f * DISC_RPM;
  for (int i = 0; i < 3; i++) {
    float a = (turns + i / 3.0f) * TWO_PI;
    float c = cosf(a), s = sinf(a);
    g.drawLine(cx + c * (r * 0.45f), cy + s * (r * 0.45f), cx + c * (r - 3), cy + s * (r - 3), ON);
  }
  g.fillCircle(cx, cy, r / 4 + 1, ON);
  g.drawPixel(cx, cy, OFF);
}

void pauseIcon(int cx, int cy) {
  Adafruit_GFX &g = display::gfx();
  g.fillRoundRect(cx - 7, cy - 7, 15, 15, 3, OFF);
  g.fillRect(cx - 4, cy - 5, 3, 11, ON);
  g.fillRect(cx + 2, cy - 5, 3, 11, ON);
}

// ---- Screens ----

// Lyrics off: disc on the left, title and artist, time, progress bar.
void drawNowPlaying(uint32_t pos, uint32_t nowMs) {
  Adafruit_GFX &g = display::gfx();
  constexpr int TEXT_X = 46;
  marquee(TEXT_X, 6, track.title, nowMs);
  marquee(TEXT_X, 18, track.artist, nowMs);
  textAt(TEXT_X, 34, formatTime(pos) + "/" + formatTime(track.durationMs));
  // The marquee runs under the disc: clear that strip, then draw the disc.
  g.fillRect(0, 0, TEXT_X - 2, 52, OFF);
  disc(21, 25, 19, pos);
  if (!playing) pauseIcon(21, 25);
  progressBar(56, 6, pos);
}

// Lyrics on: the current line large, the next one small, a thin progress bar.
void drawLyrics(uint32_t pos, uint32_t nowMs) {
  Adafruit_GFX &g = display::gfx();
  int index = lineAt(pos);
  if (index != shownLine) {
    shownLine = index;
    lineChangedMs = nowMs;
  }
  const char *now = index >= 0 ? lines[index].text : "";
  const char *next = index + 1 < lineCount ? lines[index + 1].text : "";

  // Instrumental: before the first line, an empty line, or a long gap.
  uint32_t nextAt = index + 1 < lineCount ? lines[index + 1].t : track.durationMs;
  bool instrumental = now[0] == '\0' ||
                      (nextAt - lines[index].t > GAP_MS * 3 && pos - lines[index].t > GAP_MS);
  if (instrumental) {
    disc(64, 24, 18, pos);
    if (!playing) pauseIcon(64, 24);
    // Two notes bobbing either side of the disc.
    int bob = playing ? (nowMs / 250) % 2 : 0;
    g.drawChar(30, 18 + bob * 3, 14, ON, OFF, 2);  // ♫ in the GFX font
    g.drawChar(86, 21 - bob * 3, 13, ON, OFF, 2);  // ♪
    if (next[0]) {
      String row[1];
      bool fits;
      wrap(next, WIDTH / CHAR_W, row, 1, fits);
      textAt((WIDTH - row[0].length() * CHAR_W) / 2, 48, row[0]);
    }
    progressBar(HEIGHT - 1, 1, pos);
    return;
  }

  // Slide the new line up into place.
  uint32_t since = nowMs - lineChangedMs;
  int slide = since < SLIDE_MS ? 10 - static_cast<int>(since * 10 / SLIDE_MS) : 0;

  String rows[4];
  bool fits;
  // Size 2 (10 characters a row) when it fits on two rows, else size 1.
  int count = wrap(now, WIDTH / (CHAR_W * 2), rows, 2, fits);
  uint8_t size = 2;
  if (!fits) {
    size = 1;
    count = wrap(now, WIDTH / CHAR_W, rows, 4, fits);
  }
  int rowH = CHAR_H * size + (size == 1 ? 2 : 1);
  int top = (44 - count * rowH) / 2 + slide;
  for (int i = 0; i < count; i++) {
    int w = rows[i].length() * CHAR_W * size;
    textAt((WIDTH - w) / 2, top + i * rowH, rows[i], size);
  }
  if (!playing) pauseIcon(WIDTH - 9, 8);

  g.drawFastHLine(32, 46, WIDTH - 64, ON);
  if (next[0]) {
    String row[1];
    wrap(next, WIDTH / CHAR_W, row, 1, fits);
    textAt((WIDTH - row[0].length() * CHAR_W) / 2, 51, row[0]);
  }
  progressBar(HEIGHT - 1, 1, pos);
}

}  // namespace

void onTrack(const char *payload) {
  JsonDocument doc;
  if (payload[0] == '\0' || deserializeJson(doc, payload)) {
    track = Track{};
    clearLines();
    syncId = 0;
    playing = false;
    Serial.println("[music] cleared");
    return;
  }
  long id = doc["id"] | 0L;
  if (id != track.id) {
    playing = false;
    basePos = 0;
    slew = 0;
  }
  track.id = id;
  track.title = doc["title"] | "";
  track.artist = doc["artist"] | "";
  track.durationMs = doc["durationMs"] | 0;
  track.lyrics = doc["lyrics"] | false;
  Serial.printf("[music] %s - %s (%lu s), lyrics %s\n", track.title.c_str(), track.artist.c_str(),
                static_cast<unsigned long>(track.durationMs / 1000), track.lyrics ? "on" : "off");
}

void onLines(const char *payload) {
  clearLines();
  if (payload[0] != '#') return;

  size_t length = strlen(payload);
  lineText = static_cast<char *>(malloc(length + 1));
  if (!lineText) return;
  memcpy(lineText, payload, length + 1);

  int rows = 0;
  for (const char *p = lineText; *p; p++) rows += *p == '\n';
  rows = min(rows, MAX_LINES);
  lines = static_cast<Line *>(malloc(sizeof(Line) * max(rows, 1)));
  if (!lines) {
    clearLines();
    return;
  }

  // "#<id>\n" then "<ms>\t<text>\n" per line; split in place.
  char *p = lineText + 1;
  linesId = strtol(p, &p, 10);
  p = strchr(p, '\n');
  while (p && *++p && lineCount < rows) {
    char *tab = strchr(p, '\t');
    char *end = strchr(p, '\n');
    if (!tab || (end && tab > end)) break;
    *tab = '\0';
    if (end) *end = '\0';
    lines[lineCount++] = {static_cast<uint32_t>(strtoul(p, nullptr, 10)), tab + 1};
    p = end;
  }
  Serial.printf("[music] %d lyric lines\n", lineCount);
}

void onSync(const char *payload, uint32_t nowMs) {
  JsonDocument doc;
  if (payload[0] == '\0' || deserializeJson(doc, payload)) {
    syncId = 0;
    playing = false;
    return;
  }
  long id = doc["id"] | 0L;
  int64_t pos = doc["pos"] | 0LL;
  bool nowPlaying = doc["playing"] | false;
  int64_t at = doc["at"] | 0LL;

  // Add the time the message spent travelling (needs SNTP; else assume 0).
  int64_t serverNow = epochMs();
  if (nowPlaying && serverNow > 0 && at > 0) pos += constrain(serverNow - at, 0LL, 10000LL);

  // A small difference while playing on: ease it in. Anything else: jump.
  int32_t diff = static_cast<int32_t>(static_cast<int64_t>(position(nowMs)) - pos);
  bool ease = id == syncId && playing && nowPlaying && abs(diff) < SNAP_MS;

  syncId = id;
  playing = nowPlaying;
  basePos = pos;
  baseMs = nowMs;
  slew = ease ? diff : 0;
}

void draw(uint32_t nowMs) {
  if (track.id == 0) {
    screens::status("Music", "pick a song", "on your phone");
    return;
  }
  display::clear();
  uint32_t pos = syncId == track.id ? position(nowMs) : 0;
  bool showLyrics = track.lyrics && linesId == track.id && lineCount > 0;
  if (showLyrics) {
    drawLyrics(pos, nowMs);
  } else {
    drawNowPlaying(pos, nowMs);
  }
}

}  // namespace music
