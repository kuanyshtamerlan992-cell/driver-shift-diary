import { createHash } from 'node:crypto';
import { parseInstant } from './time.js';

export const PAYMENT_METHODS = ['cash', 'card'];

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TRIP_MS = 24 * 60 * 60 * 1000;
const MAX_AMOUNT = 10_000_000; // тенге; защита от опечаток вроде лишних нулей

/**
 * Проверяет поездку из запроса.
 * Деньги — целые тенге: дробные суммы не принимаем, чтобы не ловить ошибки округления.
 *
 * @returns {{ok: true, trip: object, startMs: number, endMs: number}
 *         | {ok: false, errors: {field: string|null, message: string}[]}}
 */
export function validateTrip(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ field: null, message: 'Ожидается JSON-объект поездки' }] };
  }

  const errors = [];
  const fail = (field, message) => errors.push({ field, message });
  const { id, start, end, amount, payment, commission } = input;

  if (id !== undefined && (typeof id !== 'string' || !ID_RE.test(id))) {
    fail('id', 'id — строка до 64 символов: латиница, цифры, "-" и "_"');
  }

  const startMs = parseInstant(start);
  const endMs = parseInstant(end);
  const isoHint = 'ISO 8601 с часовым поясом, например 2026-10-01T08:10:00+05:00';
  if (startMs === null) fail('start', `Неверное время начала: нужен ${isoHint}`);
  if (endMs === null) fail('end', `Неверное время окончания: нужен ${isoHint}`);
  if (startMs !== null && endMs !== null) {
    if (endMs <= startMs) fail('end', 'Окончание должно быть позже начала');
    else if (endMs - startMs > MAX_TRIP_MS) fail('end', 'Поездка не может длиться дольше 24 часов');
  }

  const amountOk = Number.isSafeInteger(amount) && amount > 0;
  if (!amountOk) fail('amount', 'Сумма должна быть целым числом больше 0 (тенге)');
  else if (amount > MAX_AMOUNT) fail('amount', 'Сумма слишком большая — проверьте, нет ли лишних нулей');

  if (!PAYMENT_METHODS.includes(payment)) {
    fail('payment', 'Способ оплаты: "cash" (наличные) или "card" (карта)');
  }

  if (!Number.isSafeInteger(commission) || commission < 0) {
    fail('commission', 'Комиссия должна быть целым числом от 0 (тенге)');
  } else if (amountOk && commission > amount) {
    fail('commission', 'Комиссия не может быть больше суммы поездки');
  }

  if (errors.length) return { ok: false, errors };

  const trip = {
    id: id ?? contentId({ startMs, endMs, amount, payment, commission }),
    start, end, amount, payment, commission,
  };
  return { ok: true, trip, startMs, endMs };
}

/**
 * id для поездки, присланной без id: хеш от содержимого.
 * Повторная отправка той же поездки даёт тот же id и не создаёт дубль.
 */
export function contentId({ startMs, endMs, amount, payment, commission }) {
  const hash = createHash('sha256')
    .update([startMs, endMs, amount, payment, commission].join('|'))
    .digest('hex');
  return `auto-${hash.slice(0, 16)}`;
}

/** Одна и та же ли это поездка по смыслу (время сравниваем как моменты, а не как строки). */
export function sameTrip(a, b) {
  return a.startMs === b.startMs && a.endMs === b.endMs &&
    a.trip.amount === b.trip.amount && a.trip.payment === b.trip.payment &&
    a.trip.commission === b.trip.commission;
}
