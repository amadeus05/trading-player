import type { IChartApi } from "lightweight-charts";
import type { Candle } from "../../types";
import { timeToX } from "../../drawing/shared/coordinates";
import { inferTimeframeMinutes } from "../datasets/marketCandleRanges";

const SVG_NS = "http://www.w3.org/2000/svg";
const DAY = 24 * 3_600;

interface SessionDef {
  id: string;
  name: string;
  /** Короткий код — когда полное название не влезает в полосу. */
  short: string;
  /** Зона IANA: границы считаются в ней, поэтому переходы на летнее время учтены. */
  timeZone: string;
  /** Часы местного времени биржи; в UTC сессия может переходить через полночь. */
  startHour: number;
  endHour: number;
  color: string;
}

/**
 * Классические торговые сессии. Часы заданы местным временем биржи, а не UTC:
 * фиксированные UTC-часы промахиваются на час четыре раза в год, когда Лондон,
 * Нью-Йорк и Сидней переходят на летнее время в разные даты.
 */
export const TRADING_SESSIONS: SessionDef[] = [
  { id: "sydney", name: "Сидней", short: "SYD", timeZone: "Australia/Sydney", startHour: 7, endHour: 16, color: "#a78bfa" },
  { id: "tokyo", name: "Токио", short: "TYO", timeZone: "Asia/Tokyo", startHour: 9, endHour: 18, color: "#fbbf24" },
  { id: "london", name: "Лондон", short: "LDN", timeZone: "Europe/London", startHour: 8, endHour: 17, color: "#38bdf8" },
  { id: "newyork", name: "Нью-Йорк", short: "NY", timeZone: "America/New_York", startHour: 8, endHour: 17, color: "#34d399" },
];

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Календарные части момента `utcSeconds`, как их видит биржа в своей зоне. */
function zonedParts(timeZone: string, utcSeconds: number) {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(utcSeconds * 1_000));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

/** Смещение зоны в секундах на момент `utcSeconds` (местное время минус UTC). */
function zoneOffset(timeZone: string, utcSeconds: number) {
  const parts = zonedParts(timeZone, utcSeconds);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) / 1_000;
  return asUtc - utcSeconds;
}

const wallTimeCache = new Map<string, number>();

/** UTC-момент, в который на бирже наступает `hour:00` календарной даты (y-m-d). */
function zonedWallTime(timeZone: string, year: number, month: number, day: number, hour: number) {
  const key = `${timeZone}|${year}-${month}-${day}|${hour}`;
  const cached = wallTimeCache.get(key);
  if (cached !== undefined) return cached;
  const wall = Date.UTC(year, month - 1, day, hour) / 1_000;
  // Первое приближение по смещению в самой точке `wall`, второе — по смещению
  // уже в найденном моменте: так корректно разрешаются сутки перехода на DST.
  const approx = wall - zoneOffset(timeZone, wall);
  const utc = wall - zoneOffset(timeZone, approx);
  wallTimeCache.set(key, utc);
  return utc;
}

/** Лента внутридневная: на большем охвате полосы сливаются и смысла не несут. */
const MAX_VISIBLE_DAYS = 12;
const ROW_HEIGHT = 13;
const ROW_GAP = 2;
const RIBBON_TOP = 10;
/** Оценка ширины символа при шрифте 10px semibold + отступы внутри полосы. */
const LABEL_CHAR_WIDTH = 6;
const LABEL_PADDING = 12;

interface SessionsOverlayOptions {
  container: HTMLElement;
  chart: IChartApi;
  candleStore: { candles: Candle[] };
  visible: boolean;
}

interface Segment {
  start: number;
  end: number;
}

/** Отрезки сессии, пересекающиеся с видимым диапазоном времени. */
function sessionSegments(session: SessionDef, fromTs: number, toTs: number): Segment[] {
  const segments: Segment[] = [];
  const first = zonedParts(session.timeZone, fromTs - DAY);
  const last = zonedParts(session.timeZone, toTs + DAY);
  // Курсор держим на полудне UTC: полдень не задевают переходы DST, поэтому шаг
  // ровно в сутки всегда сдвигает календарную дату на один день без пропусков.
  const firstNoon = Date.UTC(first.year, first.month - 1, first.day, 12) / 1_000;
  const lastNoon = Date.UTC(last.year, last.month - 1, last.day, 12) / 1_000;
  for (let cursor = firstNoon; cursor <= lastNoon; cursor += DAY) {
    const date = new Date(cursor * 1_000);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const start = zonedWallTime(session.timeZone, year, month, day, session.startHour);
    const end = zonedWallTime(session.timeZone, year, month, day, session.endHour);
    if (end < fromTs || start > toTs) continue;
    segments.push({ start, end });
  }
  return segments;
}

/** Индекс последнего бара со временем не позже `time`; -1 — все бары позже. */
function lastBarAtOrBefore(candles: Candle[], time: number): number {
  let low = 0;
  let high = candles.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (candles[mid].time <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * Отрезок сессии, обрезанный по фактически торговавшимся барам.
 *
 * Шкала времени графика нумерует бары, а не минуты: простой рынка сжат на ней
 * до одного шага бара. У круглосуточной крипты простоев нет, а у форекса
 * выходные без баров превращали сессии субботы и воскресенья в узкие полоски-
 * «щепки», висящие над графиком. Край отрезка, попавший в простой, притягиваем
 * к ближайшему реальному бару, а отрезок целиком внутри простоя отбрасываем.
 * На данных без простоев функция ничего не меняет.
 */
export function clampSegmentToBars(
  segment: Segment,
  candles: Candle[],
  barStepSeconds: number,
): Segment | null {
  if (candles.length < 2) return null;
  const gapLimit = Math.max(barStepSeconds, 1) * 1.5;

  /** Соседи момента внутри простоя — иначе null. */
  const gapAround = (time: number): { before: number; after: number } | null => {
    const index = lastBarAtOrBefore(candles, time);
    if (index < 0 || index >= candles.length - 1) return null;
    if (candles[index].time === time) return null;
    const before = candles[index].time;
    const after = candles[index + 1].time;
    return after - before > gapLimit ? { before, after } : null;
  };

  const startGap = gapAround(segment.start);
  const endGap = gapAround(segment.end);
  const start = startGap ? startGap.after : segment.start;
  const end = endGap ? endGap.before : segment.end;
  return start < end ? { start, end } : null;
}

export function attachSessionsOverlay({
  container,
  chart,
  candleStore,
  visible,
}: SessionsOverlayOptions) {
  const overlay = document.createElementNS(SVG_NS, "svg");
  overlay.classList.add("sessions-overlay");
  container.appendChild(overlay);

  /** Пул элементов на сессию — переиспользуем, чтобы не пересоздавать узлы. */
  const pools = new Map<string, Array<{ group: SVGGElement; rect: SVGRectElement; label: SVGTextElement }>>(
    TRADING_SESSIONS.map((session) => [session.id, []]),
  );

  const acquire = (session: SessionDef, index: number) => {
    const pool = pools.get(session.id)!;
    let cell = pool[index];
    if (cell) return cell;
    const group = document.createElementNS(SVG_NS, "g");
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("class", "session-band");
    rect.setAttribute("rx", "2");
    rect.setAttribute("fill", session.color);
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "session-label");
    label.setAttribute("fill", session.color);
    group.append(rect, label);
    overlay.appendChild(group);
    cell = { group, rect, label };
    pool[index] = cell;
    return cell;
  };

  // Скрываем через display, а не visibility: visibility наследуется, и подпись
  // со своим visibility="visible" пересилила бы скрытую группу — на графике
  // оставались висеть названия сессий от прошлого кадра, уже без полос.
  const hideFrom = (session: SessionDef, index: number) => {
    const pool = pools.get(session.id)!;
    for (let i = index; i < pool.length; i += 1) {
      pool[i].group.setAttribute("display", "none");
    }
  };

  const hideAll = () => TRADING_SESSIONS.forEach((session) => hideFrom(session, 0));

  // Шаг бара нужен каждому кадру, а массив свечей меняется редко: считаем один
  // раз на массив, чтобы не проходить его на каждой прокрутке.
  let stepSource: Candle[] | null = null;
  let stepSeconds = 60;
  const barStep = (candles: Candle[]) => {
    if (candles !== stepSource) {
      stepSource = candles;
      stepSeconds = inferTimeframeMinutes(candles, 1) * 60;
    }
    return stepSeconds;
  };

  const sync = () => {
    if (!visible) {
      hideAll();
      return;
    }
    const candles = candleStore.candles;
    if (candles.length < 2) {
      hideAll();
      return;
    }
    // Пока график не разложил layout, getVisibleRange() пуст — тогда берём
    // диапазон самих загруженных свечей, чтобы лента не пропадала.
    const range = chart.timeScale().getVisibleRange();
    const fromTs = range ? Number(range.from) : candles[0].time;
    const toTs = range ? Number(range.to) : candles[candles.length - 1].time;
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || toTs <= fromTs) {
      hideAll();
      return;
    }
    // Сессии — внутридневная разметка: на дневках и большем зуме прячем.
    if (toTs - fromTs > MAX_VISIBLE_DAYS * DAY) {
      hideAll();
      return;
    }

    const plotWidth = Math.max(0, Number(chart.timeScale().width()) || 0);
    const stepSeconds = barStep(candles);

    TRADING_SESSIONS.forEach((session, rowIndex) => {
      const y = RIBBON_TOP + rowIndex * (ROW_HEIGHT + ROW_GAP);
      const segments = sessionSegments(session, fromTs, toTs);
      let used = 0;
      segments.forEach((rawSegment) => {
        const segment = clampSegmentToBars(rawSegment, candles, stepSeconds);
        if (!segment) return;
        const rawX1 = timeToX(chart, segment.start, candles);
        const rawX2 = timeToX(chart, segment.end, candles);
        if (rawX1 == null || rawX2 == null) return;
        const x1 = Math.max(0, Math.min(rawX1, plotWidth));
        const x2 = Math.max(0, Math.min(rawX2, plotWidth));
        const width = x2 - x1;
        if (width < 1) return;

        const cell = acquire(session, used);
        used += 1;
        cell.group.removeAttribute("display");
        cell.rect.setAttribute("x", String(x1));
        cell.rect.setAttribute("y", String(y));
        cell.rect.setAttribute("width", String(width));
        cell.rect.setAttribute("height", String(ROW_HEIGHT));

        // Подпись подстраивается под ширину полосы: полное имя → короткий код → скрыть.
        const text = width >= session.name.length * LABEL_CHAR_WIDTH + LABEL_PADDING
          ? session.name
          : width >= session.short.length * LABEL_CHAR_WIDTH + LABEL_PADDING
            ? session.short
            : null;
        if (text) {
          cell.label.textContent = text;
          cell.label.setAttribute("x", String(x1 + 6));
          cell.label.setAttribute("y", String(y + ROW_HEIGHT / 2));
          cell.label.removeAttribute("display");
        } else {
          cell.label.setAttribute("display", "none");
        }
      });
      hideFrom(session, used);
    });
  };

  return { sync, destroy: () => overlay.remove() };
}
