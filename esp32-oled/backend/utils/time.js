// "Midnight" for the nightly cleanup means 00:00 in config.cleanupTimeZone.

// The calendar date in `timeZone`, e.g. "2026-11-01".
export function dateIn(timeZone, now = new Date()) {
  const { year, month, day } = clockIn(timeZone, now);
  return `${year}-${pad(month)}-${pad(day)}`;
}

// The next 00:00 in `timeZone` after `now`.
export function nextMidnight(timeZone, now = new Date()) {
  const { year, month, day } = clockIn(timeZone, now);
  // Tomorrow 00:00 as if the zone were UTC, shifted back by the zone's offset.
  const tomorrowAsUtc = Date.UTC(year, month - 1, day + 1);
  return new Date(tomorrowAsUtc - utcOffsetMs(timeZone, new Date(tomorrowAsUtc)));
}

function clockIn(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(date);

  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

// How far `timeZone` is ahead of UTC at `date`, e.g. +5:30 h for Asia/Kolkata.
function utcOffsetMs(timeZone, date) {
  const c = clockIn(timeZone, date);
  const wallClockAsUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  return wallClockAsUtc - (date.getTime() - date.getMilliseconds());
}

function pad(n) {
  return String(n).padStart(2, '0');
}
