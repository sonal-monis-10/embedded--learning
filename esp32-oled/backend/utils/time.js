// Time-zone helpers for the nightly cleanup, built on Intl so no date library
// is needed. "Midnight" means 00:00 in config.cleanupTz (Asia/Kolkata).

function partsIn(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map(({ type, value }) => [type, value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

// The calendar date in `timeZone`, e.g. "2026-11-01". Compared against the
// date of the last cleanup to decide whether one is due.
export function dateIn(timeZone, now = new Date()) {
  const { year, month, day } = partsIn(now, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// How far `timeZone` is ahead of UTC at `date`, in ms (IST: +5:30).
function offsetMs(date, timeZone) {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// The next 00:00 in `timeZone` after `now`. Sessions expire at this instant.
export function nextMidnight(timeZone, now = new Date()) {
  const { year, month, day } = partsIn(now, timeZone);
  // Midnight of the next local day, first computed as if the zone were UTC,
  // then shifted by the zone's offset. Date.UTC rolls day 32 into the next month.
  const localMidnightAsUtc = Date.UTC(year, month - 1, day + 1);
  return new Date(localMidnightAsUtc - offsetMs(new Date(localMidnightAsUtc), timeZone));
}
