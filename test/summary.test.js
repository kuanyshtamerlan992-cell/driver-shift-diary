import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/summary.js';

const t1 = { id: 't1', start: '2026-10-01T08:10:00+05:00', end: '2026-10-01T08:32:00+05:00', amount: 2400, payment: 'card', commission: 360 };
const t2 = { id: 't2', start: '2026-10-01T09:05:00+05:00', end: '2026-10-01T09:20:00+05:00', amount: 1500, payment: 'cash', commission: 225 };

test('пустой день — все нули', () => {
  assert.deepEqual(summarize([]), {
    trips: 0, revenue: 0, commission: 0, net: 0,
    byPayment: {
      cash: { trips: 0, amount: 0, commission: 0, net: 0 },
      card: { trips: 0, amount: 0, commission: 0, net: 0 },
    },
    settlement: 0,
    onTripMinutes: 0,
  });
});

test('сводка по примеру из задания', () => {
  const s = summarize([t1, t2]);
  assert.equal(s.trips, 2);
  assert.equal(s.revenue, 3900);
  assert.equal(s.commission, 585);
  assert.equal(s.net, 3315);
  assert.deepEqual(s.byPayment.card, { trips: 1, amount: 2400, commission: 360, net: 2040 });
  assert.deepEqual(s.byPayment.cash, { trips: 1, amount: 1500, commission: 225, net: 1275 });
  assert.equal(s.onTripMinutes, 22 + 15);
});

test('итоги сходятся с разбивкой по способам оплаты', () => {
  const s = summarize([t1, t2, { ...t1, id: 't3', amount: 999, commission: 150 }]);
  const { cash, card } = s.byPayment;
  assert.equal(s.trips, cash.trips + card.trips);
  assert.equal(s.revenue, cash.amount + card.amount);
  assert.equal(s.commission, cash.commission + card.commission);
  assert.equal(s.net, cash.net + card.net);
});

test('взаиморасчёт: по карте деньги у агрегатора, комиссия — со всех поездок', () => {
  // Карта 2400 − комиссия (360 + 225) = агрегатор должен водителю 1815
  assert.equal(summarize([t1, t2]).settlement, 1815);
  // Только наличные: водитель должен агрегатору комиссию
  assert.equal(summarize([t2]).settlement, -225);
});

test('деньги считаются в целых тенге без ошибок округления', () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ ...t2, id: `x${i}`, amount: 1, commission: 0 }));
  assert.equal(summarize(many).revenue, 1000);
});
