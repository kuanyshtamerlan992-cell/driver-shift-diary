import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TripStore } from '../src/store.js';
import { createServer } from '../src/server.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
let server;
let base;

before(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trips-api-')), 'trips.json');
  const seed = [
    { id: 't1', start: '2026-10-01T08:10:00+05:00', end: '2026-10-01T08:32:00+05:00', amount: 2400, payment: 'card', commission: 360 },
    { id: 't2', start: '2026-10-01T09:05:00+05:00', end: '2026-10-01T09:20:00+05:00', amount: 1500, payment: 'cash', commission: 225 },
  ];
  fs.writeFileSync(file, JSON.stringify(seed));
  const store = TripStore.open({ file, timeZone: 'Asia/Almaty' });
  server = createServer({ store, timeZone: 'Asia/Almaty', publicDir: path.join(root, 'public') });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const get = (p) => fetch(base + p).then(async (r) => ({ status: r.status, body: await r.json() }));
const post = (body, raw = false) =>
  fetch(`${base}/api/trips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? body : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('GET /api/days/:date — сводка и поездки за день', async () => {
  const { status, body } = await get('/api/days/2026-10-01');
  assert.equal(status, 200);
  assert.equal(body.date, '2026-10-01');
  assert.deepEqual(body.trips.map((t) => t.id), ['t1', 't2']);
  assert.equal(body.trips[0].net, 2040);
  assert.equal(body.trips[0].durationMinutes, 22);
  assert.equal(body.summary.trips, 2);
  assert.equal(body.summary.revenue, 3900);
  assert.equal(body.summary.commission, 585);
  assert.equal(body.summary.net, 3315);
  assert.equal(body.summary.byPayment.cash.amount, 1500);
  assert.equal(body.summary.byPayment.card.amount, 2400);
});

test('GET /api/days/:date/trips и /summary — по отдельности', async () => {
  const trips = await get('/api/days/2026-10-01/trips');
  assert.equal(trips.body.trips.length, 2);
  const summary = await get('/api/days/2026-10-01/summary');
  assert.equal(summary.body.summary.net, 3315);
});

test('день без поездок — пустой список и нулевая сводка', async () => {
  const { status, body } = await get('/api/days/2026-09-01');
  assert.equal(status, 200);
  assert.deepEqual(body.trips, []);
  assert.equal(body.summary.revenue, 0);
});

test('неверная дата — 400', async () => {
  for (const d of ['2026-13-01', '01.10.2026', '2026-02-30']) {
    const { status, body } = await get(`/api/days/${d}`);
    assert.equal(status, 400);
    assert.equal(body.error.code, 'invalid_date');
  }
});

test('POST: создание — 201, повтор — 200 без дубля', async () => {
  const trip = { id: 'api-1', start: '2026-10-04T10:00:00+05:00', end: '2026-10-04T10:25:00+05:00', amount: 2000, payment: 'cash', commission: 300 };
  const first = await post(trip);
  assert.equal(first.status, 201);
  assert.equal(first.body.created, true);

  const second = await post(trip);
  assert.equal(second.status, 200);
  assert.equal(second.body.created, false);

  const day = await get('/api/days/2026-10-04');
  assert.equal(day.body.trips.length, 1);
});

test('POST: одновременные одинаковые запросы создают ровно одну поездку', async () => {
  const trip = { id: 'race', start: '2026-10-04T12:00:00+05:00', end: '2026-10-04T12:10:00+05:00', amount: 1000, payment: 'card', commission: 150 };
  const results = await Promise.all(Array.from({ length: 10 }, () => post(trip)));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 200).length, 9);
  const day = await get('/api/days/2026-10-04');
  assert.equal(day.body.trips.filter((t) => t.id === 'race').length, 1);
});

test('POST: невалидные данные — 422 со списком ошибок по полям', async () => {
  const { status, body } = await post({ start: '2026-10-04T15:00:00+05:00', end: '2026-10-04T14:00:00+05:00', amount: 0, payment: 'card', commission: 0 });
  assert.equal(status, 422);
  assert.equal(body.error.code, 'validation_error');
  assert.deepEqual(body.error.details.map((d) => d.field).sort(), ['amount', 'end']);
});

test('POST: тот же id с другими данными — 409', async () => {
  const { status, body } = await post({ id: 't1', start: '2026-10-01T08:10:00+05:00', end: '2026-10-01T08:32:00+05:00', amount: 5000, payment: 'card', commission: 360 });
  assert.equal(status, 409);
  assert.equal(body.error.code, 'id_conflict');
});

test('POST: пересечение с существующей поездкой — 409', async () => {
  const { status, body } = await post({ id: 'other', start: '2026-10-01T08:20:00+05:00', end: '2026-10-01T08:40:00+05:00', amount: 1000, payment: 'cash', commission: 150 });
  assert.equal(status, 409);
  assert.equal(body.error.code, 'overlap');
  assert.equal(body.error.conflictsWith, 't1');
  assert.match(body.error.message, /2026-10-01 08:10–08:32/);
});

test('POST: битый JSON — 400, неверный Content-Type — 415', async () => {
  const bad = await post('{"amount": ', true);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'invalid_json');

  const r = await fetch(`${base}/api/trips`, { method: 'POST', body: 'amount=1' });
  assert.equal(r.status, 415);
});

test('неизвестный адрес — 404, неверный метод — 405', async () => {
  assert.equal((await get('/api/nope')).status, 404);
  const r = await fetch(`${base}/api/trips`);
  assert.equal(r.status, 405);
});

test('GET /api/days — дни с поездками', async () => {
  const { body } = await get('/api/days');
  assert.ok(body.days.some((d) => d.date === '2026-10-01' && d.trips === 2));
});

test('клиент отдаётся с /', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
});
