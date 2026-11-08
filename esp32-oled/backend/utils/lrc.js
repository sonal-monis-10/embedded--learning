// Timed lyrics in LRC format, as LRCLIB returns them:
//   [00:12.34] First line
//   [00:15.80][01:40.00] A chorus that repeats
//   [offset:+250]
// parseLrc() turns them into [{ t: 12340, text: 'First line' }, …], sorted,
// with text the OLED's font can draw (plain ASCII).

const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\]/im;
const MAX_LINE_CHARS = 120;

// Characters with an obvious ASCII stand-in; NFKD handles accents.
const REPLACEMENTS = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '″': '"',
  '–': '-',
  '—': '-',
  '−': '-',
  '…': '...',
  ' ': ' ',
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  ø: 'o',
  Ø: 'O',
  œ: 'oe',
  Œ: 'OE',
  ł: 'l',
  Ł: 'L',
};

// Lines sorted by time. Empty lines stay: LRC uses them for instrumental gaps.
export function parseLrc(lrc) {
  if (!lrc) return [];
  const offsetMs = Number(OFFSET_TAG.exec(lrc)?.[1] ?? 0);
  const lines = [];

  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(TIMESTAMP)];
    if (stamps.length === 0) continue;
    const text = toOledText(raw.slice(stamps.at(-1).index + stamps.at(-1)[0].length));
    for (const [, min, sec, frac = '0'] of stamps) {
      // "12.3" is 300 ms, "12.34" is 340 ms, "12.345" is 345 ms.
      const ms = Number(frac.padEnd(3, '0').slice(0, 3));
      const t = Number(min) * 60_000 + Number(sec) * 1000 + ms - offsetMs;
      lines.push({ t: Math.max(0, t), text });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

// Plain printable ASCII: accents dropped, curly quotes straightened,
// anything else removed, spaces collapsed.
export function toOledText(text) {
  return text
    .replace(/[^\x20-\x7e]/g, (c) => REPLACEMENTS[c] ?? c)
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LINE_CHARS);
}

// True when most letters are Latin, i.e. the OLED can show the lyrics.
// Devanagari, Arabic, CJK, … are not in the OLED font.
export function isLatinScript(text) {
  const letters = [...(text ?? '')].filter((c) => /\p{L}/u.test(c));
  if (letters.length === 0) return false;
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  return latin / letters.length >= 0.9;
}
