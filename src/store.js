import fs from 'node:fs';
import path from 'node:path';
import { clock, localDay } from './time.js';
import { validateTrip, sameTrip } from './validation.js';

/**
 * Хранилище поездок одного водителя в JSON-файле.
 *
 * Правила добавления:
 *  - тот же id и те же данные   → дубль, возвращаем уже сохранённую поездку (идемпотентность);
 *  - тот же id, другие данные   → конфликт: id занят;
 *  - другой id, но время пересекается с уже сохранённой поездкой → конфликт:
 *    один водитель не может везти две поездки одновременно. Это ловит дубли,
 *    которые пришли с разными id (например, повтор после перезапуска клиента).
 */
export class TripStore {
  #file;
  #timeZone;
  #entries = new Map(); // id → { trip, startMs, endMs }

  constructor({ file, timeZone }) {
    this.#file = file;
    this.#timeZone = timeZone;
  }

  /** Открывает файл данных; если его нет — создаёт из файла-примера. */
  static open({ file, seedFile, timeZone }) {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (seedFile) fs.copyFileSync(seedFile, file);
      else fs.writeFileSync(file, '[]\n');
    }
    const store = new TripStore({ file, timeZone });
    store.#load();
    return store;
  }

  #load() {
    const raw = JSON.parse(fs.readFileSync(this.#file, 'utf8'));
    if (!Array.isArray(raw)) throw new Error(`${this.#file}: ожидается JSON-массив поездок`);
    raw.forEach((item, i) => {
      const result = this.#check(item);
      if (result.status !== 'ok') {
        const why = result.errors?.map((e) => `${e.field}: ${e.message}`).join('; ') ?? result.message;
        throw new Error(`${this.#file}, поездка #${i} (${item?.id ?? 'без id'}): ${why}`);
      }
      this.#entries.set(result.entry.trip.id, result.entry);
    });
  }

  /** Проверка без записи: валидация, дубли, пересечения. */
  #check(input) {
    const v = validateTrip(input);
    if (!v.ok) return { status: 'invalid', errors: v.errors };
    const entry = { trip: v.trip, startMs: v.startMs, endMs: v.endMs };

    const existing = this.#entries.get(entry.trip.id);
    if (existing) {
      return sameTrip(existing, entry)
        ? { status: 'exists', entry: existing }
        : { status: 'conflict', code: 'id_conflict',
            message: `Поездка с id "${entry.trip.id}" уже есть, и её данные отличаются` };
    }

    for (const other of this.#entries.values()) {
      if (entry.startMs < other.endMs && other.startMs < entry.endMs) {
        const tz = this.#timeZone;
        return { status: 'conflict', code: 'overlap', conflictsWith: other.trip.id,
          message: `Время пересекается с другой поездкой: ` +
                   `${localDay(other.startMs, tz)} ${clock(other.startMs, tz)}–${clock(other.endMs, tz)}` };
      }
    }
    return { status: 'ok', entry };
  }

  /**
   * Добавляет поездку.
   * @returns {{status: 'created'|'exists', trip}
   *         | {status: 'invalid', errors}
   *         | {status: 'conflict', code, message}}
   */
  add(input) {
    const result = this.#check(input);
    if (result.status === 'exists') return { status: 'exists', trip: result.entry.trip };
    if (result.status !== 'ok') return result;

    // Сначала пишем на диск, потом меняем память: если запись упадёт, состояние не разъедется.
    const { entry } = result;
    this.#persist([...this.#entries.values(), entry]);
    this.#entries.set(entry.trip.id, entry);
    return { status: 'created', trip: entry.trip };
  }

  /** Поездки за календарный день (по времени начала), отсортированные по началу. */
  listByDay(day) {
    return [...this.#entries.values()]
      .filter((e) => localDay(e.startMs, this.#timeZone) === day)
      .sort((a, b) => a.startMs - b.startMs)
      .map((e) => e.trip);
  }

  /** Дни, в которых есть поездки, — от новых к старым. */
  days() {
    const counts = new Map();
    for (const e of this.#entries.values()) {
      const day = localDay(e.startMs, this.#timeZone);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return [...counts].sort(([a], [b]) => b.localeCompare(a)).map(([date, trips]) => ({ date, trips }));
  }

  get size() {
    return this.#entries.size;
  }

  /** Атомарная запись: во временный файл, затем переименование поверх старого. */
  #persist(entries) {
    const trips = entries.sort((a, b) => a.startMs - b.startMs).map((e) => e.trip);
    const tmp = `${this.#file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(trips, null, 2)}\n`);
    fs.renameSync(tmp, this.#file);
  }
}
