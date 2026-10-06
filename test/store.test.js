import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TripStore } from '../src/store.js';

const TZ = 'Asia/Almaty';
const trip = {
  id: 't1',
  start: '2026-10-01T08:10:00+05:00',
  end: '2026-10-01T08:32:00+05:00',
  amount: 2400,
  payment: 'card',
  commission: 360,
};

let file;
beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trips-')), 'trips.json');
});

const open = () => TripStore.open({ file, timeZone: TZ });

test('повторная отправка той же поездки не создаёт дубль', () => {
  const store = open();
  assert.equal(store.add(trip).status, 'created');
  assert.equal(store.add(trip).status, 'exists');
  assert.equal(store.add({ ...trip }).status, 'exists');
  assert.equal(store.size, 1);
});

test('повтор с тем же моментом в другой записи времени — тоже дубль', () => {
  const store = open();
  store.add(trip);
  const sameInUtc = { ...trip, start: '2026-10-01T03:10:00Z', end: '2026-10-01T03:32:00Z' };
  assert.equal(store.add(sameInUtc).status, 'exists');
  assert.equal(store.size, 1);
});

test('поездка без id: повторная отправка не создаёт дубль', () => {
  const store = open();
  const { id, ...noId } = trip;
  const first = store.add(noId);
  assert.equal(first.status, 'created');
  assert.equal(store.add(noId).status, 'exists');
  assert.equal(store.size, 1);
});

test('тот же id с другими данными — конфликт, старая запись не меняется', () => {
  const store = open();
  store.add(trip);
  const r = store.add({ ...trip, amount: 9999 });
  assert.equal(r.status, 'conflict');
  assert.equal(r.code, 'id_conflict');
  assert.equal(store.listByDay('2026-10-01')[0].amount, 2400);
});

test('пересечение по времени с другой поездкой — конфликт (ловит дубли с разными id)', () => {
  const store = open();
  store.add(trip);
  const r = store.add({ ...trip, id: 't1-again' });
  assert.equal(r.status, 'conflict');
  assert.equal(r.code, 'overlap');
  assert.equal(store.size, 1);
});

test('поездки встык не считаются пересечением', () => {
  const store = open();
  store.add(trip);
  const next = { ...trip, id: 't2', start: trip.end, end: '2026-10-01T08:50:00+05:00' };
  assert.equal(store.add(next).status, 'created');
});

test('невалидная поездка не сохраняется', () => {
  const store = open();
  const r = store.add({ ...trip, amount: 0 });
  assert.equal(r.status, 'invalid');
  assert.equal(store.size, 0);
});

test('данные сохраняются в файл и переживают перезапуск', () => {
  open().add(trip);
  const reopened = open();
  assert.equal(reopened.size, 1);
  assert.equal(reopened.add(trip).status, 'exists');
});

test('новый файл создаётся из файла-примера', () => {
  const seedFile = path.join(path.dirname(file), 'seed.json');
  fs.writeFileSync(seedFile, JSON.stringify([trip]));
  const store = TripStore.open({ file, seedFile, timeZone: TZ });
  assert.equal(store.size, 1);
  assert.ok(fs.existsSync(file));
});

test('битые данные в файле — понятная ошибка при старте', () => {
  fs.writeFileSync(file, JSON.stringify([{ ...trip, amount: -5 }]));
  assert.throws(() => open(), /поездка #0 \(t1\).*amount/);
});

test('дубли в файле данных тоже ловятся при загрузке', () => {
  fs.writeFileSync(file, JSON.stringify([trip, { ...trip, id: 'copy' }]));
  assert.throws(() => open(), /пересекается/);
});

test('listByDay: поездка через полночь относится к дню начала', () => {
  const store = open();
  store.add({ ...trip, id: 'night', start: '2026-10-02T23:40:00+05:00', end: '2026-10-03T00:05:00+05:00' });
  assert.equal(store.listByDay('2026-10-02').length, 1);
  assert.equal(store.listByDay('2026-10-03').length, 0);
});

test('listByDay сортирует по времени начала; days() — от новых к старым', () => {
  const store = open();
  store.add({ ...trip, id: 'b', start: '2026-10-01T12:00:00+05:00', end: '2026-10-01T12:20:00+05:00' });
  store.add(trip);
  store.add({ ...trip, id: 'c', start: '2026-10-03T09:00:00+05:00', end: '2026-10-03T09:20:00+05:00' });
  assert.deepEqual(store.listByDay('2026-10-01').map((t) => t.id), ['t1', 'b']);
  assert.deepEqual(store.days(), [{ date: '2026-10-03', trips: 1 }, { date: '2026-10-01', trips: 2 }]);
});
