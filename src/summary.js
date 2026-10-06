import { parseInstant } from './time.js';

const emptyBucket = () => ({ trips: 0, amount: 0, commission: 0, net: 0 });

/**
 * Сводка за день.
 *
 * net ("на руки") = выручка − комиссия.
 * settlement — взаиморасчёт с агрегатором: деньги за поездки по карте получает агрегатор,
 * а комиссию водитель должен со всех поездок. Плюс — агрегатор должен водителю,
 * минус — водитель должен агрегатору.
 */
export function summarize(trips) {
  const byPayment = { cash: emptyBucket(), card: emptyBucket() };
  let onTripMs = 0;

  for (const t of trips) {
    const bucket = byPayment[t.payment];
    bucket.trips += 1;
    bucket.amount += t.amount;
    bucket.commission += t.commission;
    bucket.net += t.amount - t.commission;
    onTripMs += parseInstant(t.end) - parseInstant(t.start);
  }

  const { cash, card } = byPayment;
  const revenue = cash.amount + card.amount;
  const commission = cash.commission + card.commission;

  return {
    trips: cash.trips + card.trips,
    revenue,
    commission,
    net: revenue - commission,
    byPayment,
    settlement: card.amount - commission,
    onTripMinutes: Math.round(onTripMs / 60_000),
  };
}
