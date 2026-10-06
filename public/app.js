// Клиент дневника смен. Без фреймворков: состояние — выбранный день, всё остальное берём из API.

const $ = (id) => document.getElementById(id);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const state = {
  config: { timeZone: 'Asia/Almaty', utcOffset: '+05:00' },
  day: null,
  days: [],
  loadToken: 0,
  pendingId: null, // ключ идемпотентности текущей формы
  freshId: null,
};

// ---------- форматирование ----------

const money = (n) => `${new Intl.NumberFormat('ru-RU').format(n)} ₸`;

const dayTitleFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });
const chipFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
let timeFmt;
let dayOfFmt;

const dayToDate = (day) => new Date(`${day}T00:00:00Z`);
const addDays = (day, n) => {
  const d = dayToDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = () => dayOfFmt.format(new Date());

function dayTitle(day) {
  const t = today();
  const base = dayTitleFmt.format(dayToDate(day));
  if (day === t) return `Сегодня, ${base}`;
  if (day === addDays(t, -1)) return `Вчера, ${base}`;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function duration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}

// ---------- API ----------

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ---------- день ----------

function setDay(day, { push = true } = {}) {
  if (!DAY_RE.test(day)) return;
  state.day = day;
  if (push && location.hash !== `#${day}`) history.replaceState(null, '', `#${day}`);
  $('dayLabel').textContent = dayTitle(day);
  $('dayInput').value = day;
  renderChips();
  loadDay();
}

async function loadDay() {
  const token = ++state.loadToken;
  $('loadError').hidden = true;
  try {
    const { status, body } = await api(`/api/days/${state.day}`);
    if (token !== state.loadToken) return; // пользователь уже переключил день
    if (status !== 200) throw new Error(body.error?.message ?? `Ошибка ${status}`);
    renderSummary(body.summary);
    renderTrips(body.trips);
  } catch (err) {
    if (token !== state.loadToken) return;
    $('loadError').textContent = `Не удалось загрузить день: ${err.message}`;
    $('loadError').hidden = false;
  }
}

async function loadDays() {
  const { body } = await api('/api/days');
  state.days = body.days ?? [];
  renderChips();
}

// ---------- отрисовка ----------

function renderChips() {
  const box = $('dayChips');
  box.replaceChildren(...state.days.slice(0, 14).map(({ date, trips }) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = `${chipFmt.format(dayToDate(date))} · ${trips}`;
    b.title = `${trips} поездок`;
    if (date === state.day) b.setAttribute('aria-current', 'date');
    b.addEventListener('click', () => setDay(date));
    return b;
  }));
}

function renderSummary(s) {
  $('sNet').textContent = money(s.net);
  $('sTrips').textContent = s.trips;
  $('sRevenue').textContent = money(s.revenue);
  $('sCommission').textContent = money(s.commission);
  $('sCash').textContent = money(s.byPayment.cash.amount);
  $('sCard').textContent = money(s.byPayment.card.amount);

  const cashShare = s.revenue ? (s.byPayment.cash.amount / s.revenue) * 100 : 0;
  $('splitCash').style.width = `${cashShare}%`;
  $('splitCard').style.width = `${s.revenue ? 100 - cashShare : 0}%`;
  $('splitBar').setAttribute('aria-label',
    `Наличные ${Math.round(cashShare)}%, карта ${s.revenue ? Math.round(100 - cashShare) : 0}%`);

  $('sNetSub').textContent = s.onTripMinutes
    ? `В поездках ${duration(s.onTripMinutes)} · ${money(Math.round(s.net / (s.onTripMinutes / 60)))} в час`
    : '';

  const st = $('sSettlement');
  if (!s.trips) st.textContent = '';
  else if (s.settlement > 0) st.innerHTML = `Взаиморасчёт: агрегатор должен вам <b>${money(s.settlement)}</b>`;
  else if (s.settlement < 0) st.innerHTML = `Взаиморасчёт: вы должны агрегатору <b>${money(-s.settlement)}</b>`;
  else st.textContent = 'Взаиморасчёт: в ноль';
}

function renderTrips(trips) {
  $('empty').hidden = trips.length > 0;
  $('tripList').replaceChildren(...trips.map((t) => {
    const li = document.createElement('li');
    li.className = `trip ${t.payment}`;
    if (t.id === state.freshId) li.classList.add('fresh');

    const start = new Date(t.start);
    const end = new Date(t.end);
    const nextDay = dayOfFmt.format(end) !== dayOfFmt.format(start) ? ' (+1)' : '';

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = `${timeFmt.format(start)}–${timeFmt.format(end)}${nextDay}`;

    const pay = document.createElement('span');
    pay.className = 'pay';
    pay.textContent = t.payment === 'cash' ? 'Наличные' : 'Карта';

    const amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = money(t.amount);

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = duration(t.durationMinutes);

    const fee = document.createElement('span');
    fee.className = 'fee';
    fee.textContent = `−${money(t.commission)}`;

    li.append(time, pay, amount, meta, fee);
    return li;
  }));
  state.freshId = null;
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
}

// ---------- форма ----------

const newId = () =>
  `web-${crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;

const form = $('addForm');
const dialog = $('addDialog');

function clearErrors() {
  form.querySelectorAll('.field-error').forEach((p) => { p.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
  $('formError').textContent = '';
}

function showFieldErrors(details) {
  const inputs = { start: 'fStart', end: 'fEnd', amount: 'fAmount', commission: 'fCommission' };
  for (const { field, message } of details) {
    const p = [...form.querySelectorAll('.field-error')].find((el) => el.dataset.for.split(' ').includes(field));
    if (p) p.textContent = p.textContent ? `${p.textContent} ${message}` : message;
    else $('formError').textContent = message;
    if (inputs[field]) $(inputs[field]).setAttribute('aria-invalid', 'true');
  }
}

const endsNextDay = () => $('fStart').value && $('fEnd').value && $('fEnd').value <= $('fStart').value;

function openForm() {
  form.reset();
  clearErrors();
  state.pendingId = newId();
  if (state.day === today()) {
    $('fEnd').value = timeFmt.format(new Date());
  }
  $('fNextDay').hidden = true;
  dialog.showModal();
  $('fStart').focus();
}

function buildTrip() {
  const day = state.day;
  const offset = state.config.utcOffset;
  const endDay = endsNextDay() ? addDays(day, 1) : day;
  return {
    id: state.pendingId,
    start: `${day}T${$('fStart').value}:00${offset}`,
    end: `${endDay}T${$('fEnd').value}:00${offset}`,
    amount: Number($('fAmount').value),
    commission: Number($('fCommission').value),
    payment: form.elements.payment.value,
  };
}

form.addEventListener('input', () => {
  $('fNextDay').hidden = !endsNextDay();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  const missing = [];
  if (!$('fStart').value) missing.push({ field: 'start', message: 'Укажите время начала.' });
  if (!$('fEnd').value) missing.push({ field: 'end', message: 'Укажите время окончания.' });
  if ($('fAmount').value === '') missing.push({ field: 'amount', message: 'Укажите сумму.' });
  if ($('fCommission').value === '') missing.push({ field: 'commission', message: 'Укажите комиссию (можно 0).' });
  if (missing.length) return showFieldErrors(missing);

  const save = $('saveAdd');
  save.disabled = true;
  try {
    const { status, body } = await api('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildTrip()),
    });
    if (status === 201 || status === 200) {
      dialog.close();
      state.freshId = body.trip.id;
      state.pendingId = null;
      toast(status === 201 ? 'Поездка сохранена' : 'Эта поездка уже была сохранена — дубль не создан');
      await Promise.all([loadDays(), loadDay()]);
    } else if (status === 422) {
      showFieldErrors(body.error.details ?? []);
    } else {
      $('formError').textContent = body.error?.message ?? `Ошибка сервера (${status})`;
    }
  } catch {
    // id не меняем: повторная отправка не создаст дубль, даже если первый запрос всё-таки дошёл
    $('formError').textContent = 'Нет связи с сервером. Нажмите «Сохранить» ещё раз — дубль не создастся.';
  } finally {
    save.disabled = false;
  }
});

$('cancelAdd').addEventListener('click', () => dialog.close());
$('openAdd').addEventListener('click', openForm);
$('prevDay').addEventListener('click', () => setDay(addDays(state.day, -1)));
$('nextDay').addEventListener('click', () => setDay(addDays(state.day, 1)));
$('dayInput').addEventListener('change', (e) => setDay(e.target.value));
window.addEventListener('hashchange', () => setDay(location.hash.slice(1), { push: false }));
document.addEventListener('keydown', (e) => {
  if (dialog.open || e.target.closest('input')) return;
  if (e.key === 'ArrowLeft') setDay(addDays(state.day, -1));
  if (e.key === 'ArrowRight') setDay(addDays(state.day, 1));
});

// ---------- старт ----------

async function init() {
  try {
    const { body } = await api('/api/config');
    if (body.timeZone) state.config = body;
  } catch { /* остаёмся на значениях по умолчанию */ }

  const tz = state.config.timeZone;
  timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  dayOfFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz });

  await loadDays().catch(() => {});
  const fromHash = location.hash.slice(1);
  const t = today();
  const initial = DAY_RE.test(fromHash) ? fromHash
    : state.days.some((d) => d.date === t) || !state.days.length ? t
    : state.days[0].date; // сегодня пусто — открываем последний день с поездками
  setDay(initial);
}

init();
