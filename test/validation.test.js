import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrip } from '../src/validation.js';
import { parseInstant, isValidDay, localDay } from '../src/time.js';

const valid = {
  id: 'trip-1',
  start: '2026-10-01T08:10:00+05:00',
  end: '2026-10-01T08:32:00+05:00',
  amount: 2400,
  payment: 'card',
  commission: 360,
};

const fields = (result) => result.errors.map((e) => e.field);

test('корректная поездка проходит проверку', () => {
  const r = validateTrip(valid);
  assert.equal(r.ok, true);
  assert.deepEqual(r.trip, valid);
});

test('сумма должна быть целым числом больше 0', () => {
  for (const amount of [0, -100, 10.5, '2400', null, undefined, NaN, Infinity]) {
    const r = validateTrip({ ...valid, amount });
    assert.equal(r.ok, false, `amount=${amount} должен отклоняться`);
    assert.deepEqual(fields(r), ['amount']);
  }
});

test('окончание должно быть позже начала', () => {
  assert.deepEqual(fields(validateTrip({ ...valid, end: valid.start })), ['end']);
  assert.deepEqual(fields(validateTrip({ ...valid, end: '2026-10-01T08:00:00+05:00' })), ['end']);
});

test('время сравнивается как моменты, а не как строки', () => {
  // 03:20Z — это 08:20 по Алматы, т.е. позже начала в 08:10+05:00
  assert.equal(validateTrip({ ...valid, end: '2026-10-01T03:20:00Z' }).ok, true);
  // 03:00Z — 08:00 по Алматы, раньше начала
  assert.deepEqual(fields(validateTrip({ ...valid, end: '2026-10-01T03:00:00Z' })), ['end']);
});

test('поездка длиннее 24 часов — ошибка', () => {
  assert.deepEqual(fields(validateTrip({ ...valid, end: '2026-10-02T08:11:00+05:00' })), ['end']);
});

test('время без часового пояса и несуществующие даты отклоняются', () => {
  for (const start of [
    '2026-10-01T08:10:00',        // без пояса — неоднозначно
    '2026-02-30T08:10:00+05:00',  // Date.parse превратил бы это в 2 марта
    '2026-10-01T24:00:00+05:00',
    '2026-10-01 08:10:00+05:00',
    '01.10.2026 08:10',
    1759288200000,
  ]) {
    assert.equal(validateTrip({ ...valid, start }).ok, false, `start=${start} должен отклоняться`);
  }
});

test('способ оплаты — только cash или card', () => {
  for (const payment of ['Card', 'наличные', '', undefined]) {
    assert.deepEqual(fields(validateTrip({ ...valid, payment })), ['payment']);
  }
});

test('комиссия от 0 до суммы поездки', () => {
  assert.equal(validateTrip({ ...valid, commission: 0 }).ok, true);
  assert.equal(validateTrip({ ...valid, commission: valid.amount }).ok, true);
  assert.deepEqual(fields(validateTrip({ ...valid, commission: -1 })), ['commission']);
  assert.deepEqual(fields(validateTrip({ ...valid, commission: 2401 })), ['commission']);
  assert.deepEqual(fields(validateTrip({ ...valid, commission: 1.5 })), ['commission']);
});

test('все ошибки возвращаются сразу, а не по одной', () => {
  const r = validateTrip({ start: 'x', end: 'y', amount: 0, payment: 'btc', commission: -1 });
  assert.deepEqual(fields(r).sort(), ['amount', 'commission', 'end', 'payment', 'start']);
});

test('не объект — ошибка', () => {
  for (const input of [null, [], 'trip', 42]) assert.equal(validateTrip(input).ok, false);
});

test('без id — id выводится из содержимого и одинаков для одинаковых поездок', () => {
  const { id, ...noId } = valid;
  const a = validateTrip(noId);
  const b = validateTrip({ ...noId });
  assert.match(a.trip.id, /^auto-[0-9a-f]{16}$/);
  assert.equal(a.trip.id, b.trip.id);
  assert.notEqual(a.trip.id, validateTrip({ ...noId, amount: 2500 }).trip.id);
});

test('parseInstant: Z и смещение дают один и тот же момент', () => {
  assert.equal(parseInstant('2026-10-01T08:10:00+05:00'), parseInstant('2026-10-01T03:10:00Z'));
});

test('isValidDay', () => {
  assert.equal(isValidDay('2026-10-01'), true);
  assert.equal(isValidDay('2026-02-29'), false);
  assert.equal(isValidDay('2028-02-29'), true);
  assert.equal(isValidDay('2026-1-1'), false);
});

test('день поездки считается по часовому поясу сервиса', () => {
  // 00:30 по Алматы 2 октября — это ещё 1 октября по UTC
  const ms = parseInstant('2026-10-02T00:30:00+05:00');
  assert.equal(localDay(ms, 'Asia/Almaty'), '2026-10-02');
  assert.equal(localDay(ms, 'UTC'), '2026-10-01');
});
