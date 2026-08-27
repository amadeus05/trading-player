import { BASE_INTERVAL_MS, type Candle } from "../../domain/Candle.js";

const HOUR_MS = 3_600_000;

/**
 * Метки CSV отстают от UTC на пять часов зимой и на четыре летом.
 *
 * Заявлено, что время в файлах — нью-йоркское без летнего перехода, но данные
 * говорят другое: источник размечает их серверными часами европейского брокера
 * и переводит их, причём в разные годы по-разному. В 2021, 2022, 2023 и 2025 он
 * переходил в последнее воскресенье октября, а в 2024 — на неделю позже, вместе
 * с США. Поэтому календарного правила здесь нет и быть не может.
 */
export const WINTER_OFFSET_MS = 5 * HOUR_MS;
export const SUMMER_OFFSET_MS = 4 * HOUR_MS;

/** Разрыв, по которому распознаётся стык торговых недель. */
const WEEK_GAP_MS = 4 * HOUR_MS;

const FIELDS_PER_CANDLE = 5;

/**
 * Год минуток — почти четыреста тысяч свечей, и держать их объектами ради
 * нарезки страниц по тысяче штук слишком дорого. Числа лежат плотно, а объекты
 * рождаются только для запрошенного отрезка.
 */
export interface PackedCandles {
  times: Float64Array;
  /** По пять чисел на свечу: open, high, low, close, volume. */
  fields: Float64Array;
}

export const EMPTY_CANDLES: PackedCandles = {
  times: new Float64Array(0),
  fields: new Float64Array(0),
};

const nthSunday = (year: number, month: number, nth: number): number => {
  const first = Date.UTC(year, month, 1);
  const shift = (7 - new Date(first).getUTCDay()) % 7;
  return Date.UTC(year, month, 1 + shift + (nth - 1) * 7);
};

const lastSunday = (year: number, month: number): number => {
  const last = Date.UTC(year, month + 1, 0);
  return last - new Date(last).getUTCDay() * 86_400_000;
};

/** Второе воскресенье марта 07:00 UTC — первое воскресенье ноября 06:00 UTC. */
function newYorkSummer(instant: number): boolean {
  const year = new Date(instant).getUTCFullYear();
  return instant >= nthSunday(year, 2, 2) + 7 * HOUR_MS
    && instant < nthSunday(year, 10, 1) + 6 * HOUR_MS;
}

/** Последнее воскресенье марта 01:00 UTC — последнее воскресенье октября 01:00 UTC. */
function europeanSummer(instant: number): boolean {
  const year = new Date(instant).getUTCFullYear();
  return instant >= lastSunday(year, 2) + HOUR_MS && instant < lastSunday(year, 9) + HOUR_MS;
}

/** Неделя форекса открывается и закрывается в 17:00 по Нью-Йорку. */
const weekEdgeUtc = (label: number): number => {
  const date = new Date(label);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), newYorkSummer(label + WINTER_OFFSET_MS) ? 21 : 22);
};

const asOffset = (edgeUtc: number, label: number): number | null => {
  const hours = Math.round((edgeUtc - label) / HOUR_MS);
  return hours === 4 || hours === 5 ? hours * HOUR_MS : null;
};

/**
 * Сдвиг по открытию недели: воскресный первый бар должен встать ровно на
 * 17:00 Нью-Йорка, то есть на 21:00 UTC летом и 22:00 зимой. Это единственный
 * ориентир, который есть в данных каждую неделю и не зависит от того, какими
 * правилами перехода пользовался источник.
 */
function offsetFromWeekOpen(label: number): number | null {
  const date = new Date(label);
  if (date.getUTCDay() !== 0 || date.getUTCMinutes() > 15) return null;
  return asOffset(weekEdgeUtc(label), label);
}

/** Тот же ориентир с другого конца: последний бар недели — пятничные 16:59. */
function offsetFromWeekClose(label: number): number | null {
  const date = new Date(label);
  if (date.getUTCDay() !== 5 || date.getUTCMinutes() < 45) return null;
  return asOffset(weekEdgeUtc(label), label);
}

/** Формат метки: YYYYMMDD HHMMSS. Секунды у минуток всегда нулевые. */
function parseLabel(stamp: string): number {
  if (stamp.length < 15) return Number.NaN;
  const year = Number(stamp.slice(0, 4));
  const month = Number(stamp.slice(4, 6));
  const day = Number(stamp.slice(6, 8));
  const hour = Number(stamp.slice(9, 11));
  const minute = Number(stamp.slice(11, 13));
  if (!Number.isFinite(year + month + day + hour + minute)) return Number.NaN;
  return Date.UTC(year, month - 1, day, hour, minute);
}

interface Rows {
  labels: Float64Array;
  fields: Float64Array;
  count: number;
}

function readRows(text: string): Rows {
  let newlines = 0;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) newlines += 1;
  const labels = new Float64Array(newlines + 1);
  const fields = new Float64Array((newlines + 1) * FIELDS_PER_CANDLE);

  let count = 0;
  let cursor = 0;
  while (cursor < text.length) {
    let end = text.indexOf("\n", cursor);
    if (end === -1) end = text.length;
    const line = text.slice(cursor, end).trim();
    cursor = end + 1;
    if (!line) continue;

    const parts = line.split(";");
    if (parts.length < FIELDS_PER_CANDLE) continue;
    const label = parseLabel(parts[0]);
    if (!Number.isFinite(label) || label % BASE_INTERVAL_MS !== 0) continue;

    const values = [Number(parts[1]), Number(parts[2]), Number(parts[3]), Number(parts[4]),
      parts.length > FIELDS_PER_CANDLE ? Number(parts[5]) : 0];
    if (!values.every(Number.isFinite)) continue;

    labels[count] = label;
    fields.set(values, count * FIELDS_PER_CANDLE);
    count += 1;
  }

  return { labels, fields, count };
}

/**
 * Разбирает CSV вида `20210103 170000;1.22396;1.22396;1.22373;1.22395;0` и
 * переводит метки в UTC.
 *
 * Сдвиг определяется отдельно для каждого куска между недельными разрывами: на
 * стыке лет источник пересчитывает время не по фиксированному правилу, и
 * промахнуться здесь значит сдвинуть часть истории на час, оставив сессии и
 * новости не на своих местах.
 *
 * Час, повторённый источником при переходе на зимнее время, отбрасывается:
 * строки в нём совпадают с первым проходом байт в байт, а ломать возрастание
 * времени нельзя — на нём стоит и двоичный поиск, и весь стор.
 */
export function parseHistDataCsv(text: string): PackedCandles {
  const rows = readRows(text);
  const times = new Float64Array(rows.count);
  let written = 0;
  let offset: number | null = null;

  let start = 0;
  while (start < rows.count) {
    let end = start + 1;
    while (end < rows.count && rows.labels[end] - rows.labels[end - 1] <= WEEK_GAP_MS) end += 1;

    offset = offsetFromWeekOpen(rows.labels[start])
      ?? offsetFromWeekClose(rows.labels[end - 1])
      // Кусок без обоих краёв — это праздничный обрыв внутри недели: сдвиг
      // меняется только на выходных, поэтому наследуется предыдущий.
      ?? offset
      ?? (europeanSummer(rows.labels[start] + WINTER_OFFSET_MS) ? SUMMER_OFFSET_MS : WINTER_OFFSET_MS);

    for (let index = start; index < end; index += 1) {
      const time = rows.labels[index] + offset;
      if (written && time <= times[written - 1]) continue;
      times[written] = time;
      if (written !== index) {
        rows.fields.copyWithin(written * FIELDS_PER_CANDLE, index * FIELDS_PER_CANDLE, (index + 1) * FIELDS_PER_CANDLE);
      }
      written += 1;
    }

    start = end;
  }

  return {
    times: written === times.length ? times : times.slice(0, written),
    fields: rows.fields.slice(0, written * FIELDS_PER_CANDLE),
  };
}

/** Первая свеча со временем не меньше границы. */
function lowerBound(times: Float64Array, from: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (times[middle] < from) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Свечи полуинтервала [from, to) — ровно так нарезает страницы RangePlanner. */
export function sliceCandles(packed: PackedCandles, from: number, to: number): Candle[] {
  const candles: Candle[] = [];
  for (let index = lowerBound(packed.times, from); index < packed.times.length && packed.times[index] < to; index += 1) {
    const offset = index * FIELDS_PER_CANDLE;
    candles.push({
      openTime: packed.times[index],
      open: packed.fields[offset],
      high: packed.fields[offset + 1],
      low: packed.fields[offset + 2],
      close: packed.fields[offset + 3],
      volume: packed.fields[offset + 4],
      // Источник даёт только цены: оборота в минутках HistData нет.
      turnover: 0,
    });
  }
  return candles;
}
