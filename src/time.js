// Работа со временем. Все моменты храним как миллисекунды UTC,
// а "день" поездки считаем в часовом поясе сервиса (по умолчанию Asia/Almaty).

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isRealDate(year, month, day) {
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 &&
    day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Разбирает ISO 8601 с обязательным часовым поясом ("Z" или "+05:00").
 * Возвращает миллисекунды UTC или null.
 *
 * Date.parse тут не подходит: он молча превращает 2026-02-30 в 2 марта
 * и принимает строки без часового пояса, трактуя их по-разному.
 */
export function parseInstant(value) {
  if (typeof value !== 'string') return null;
  const m = ISO_RE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', frac = '0', zone, sign, oh, om] = m;
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number);
  if (!isRealDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;

  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const offH = Number(oh);
    const offM = Number(om);
    if (offH > 14 || offM > 59) return null;
    offsetMinutes = (sign === '+' ? 1 : -1) * (offH * 60 + offM);
  }
  const ms = Number(frac.padEnd(3, '0'));
  return Date.UTC(year, month - 1, day, hour, minute, second, ms) - offsetMinutes * 60_000;
}

/** Проверяет строку дня вида YYYY-MM-DD. */
export function isValidDay(value) {
  if (typeof value !== 'string') return false;
  const m = DAY_RE.exec(value);
  return Boolean(m) && isRealDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

const dayFormatters = new Map();

/** Календарный день (YYYY-MM-DD) момента времени в заданном часовом поясе. */
export function localDay(ms, timeZone) {
  let fmt = dayFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    dayFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(ms));
}

/** Время суток "ЧЧ:ММ" в заданном часовом поясе — для сообщений человеку. */
export function clock(ms, timeZone) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit' })
    .format(new Date(ms));
}

/** Смещение часового пояса для момента времени, например "+05:00". */
export function utcOffset(timeZone, date = new Date()) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName').value; // "GMT+05:00" или "GMT"
  return part === 'GMT' ? '+00:00' : part.slice(3);
}
