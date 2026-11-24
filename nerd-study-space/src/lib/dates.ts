/**
 * Date handling.
 *
 * Every "day" in Nerd is a calendar day in the user's chosen timezone
 * (preferences.timezone, defaulting to the browser's). Day keys are plain
 * 'YYYY-MM-DD' strings, so they sort, compare and group without Date quirks.
 * Day arithmetic is done in UTC on the key itself, which is DST-safe.
 */
export const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(date: Date, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
    } catch {
      f = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    fmtCache.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return o;
}

/** 'YYYY-MM-DD' of an instant in the given timezone. */
export function dayKey(date: Date | string | number, tz: string): string {
  const d = date instanceof Date ? date : new Date(date);
  const p = parts(d, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

export const todayKey = (tz: string) => dayKey(new Date(), tz);

/** Wall-clock hour/minute/second of an instant in the timezone. */
export function clockParts(date: Date, tz: string) {
  const p = parts(date, tz);
  return { h: Number(p.hour), m: Number(p.minute), s: Number(p.second) };
}

const toUTC = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (key: string, n: number) => fromUTC(toUTC(key) + n * 86400000);
export const diffDays = (a: string, b: string) => Math.round((toUTC(a) - toUTC(b)) / 86400000);

/** 0 = Sunday … 6 = Saturday */
export const weekday = (key: string) => new Date(toUTC(key)).getUTCDay();

export function startOfWeek(key: string, weekStartsOn: number): string {
  const diff = (weekday(key) - weekStartsOn + 7) % 7;
  return addDays(key, -diff);
}
export const endOfWeek = (key: string, ws: number) => addDays(startOfWeek(key, ws), 6);

export const startOfMonth = (key: string) => `${key.slice(0, 7)}-01`;
export function endOfMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return fromUTC(Date.UTC(y, m, 0));
}
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  return fromUTC(Date.UTC(y, m - 1 + n, 1));
}

export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let k = start; k <= end; k = addDays(k, 1)) out.push(k);
  return out;
}

const DAY_FMT: Intl.DateTimeFormatOptions = { timeZone: 'UTC' };
export function formatDay(key: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Date(toUTC(key)).toLocaleDateString(undefined, { ...opts, ...DAY_FMT });
}
export const formatMonth = (key: string) => formatDay(key, { month: 'long', year: 'numeric' });
export const weekdayLabels = (weekStartsOn: number): string[] => {
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    formatDay(addDays('2023-01-01', (weekStartsOn + i) % 7), { weekday: 'short' }),
  );
};

export const nowIso = () => new Date().toISOString();

export const isValidDayKey = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
