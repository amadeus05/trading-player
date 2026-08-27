import { BASE_TIMEFRAME_MINUTES } from "../../shared/config/simulation";

export { BASE_TIMEFRAME_MINUTES };
export const MARKET_CANDLE_INTERVAL_MS = BASE_TIMEFRAME_MINUTES * 60 * 1_000;
export const INITIAL_MARKET_CANDLE_LIMIT = 5_000;
export const NEXT_MARKET_CANDLE_LIMIT = 5_000;
/**
 * Запас хода при загрузке и при прыжке — в БАРАХ ЭКРАНА, а не в базовых свечах.
 *
 * Раньше окно мерялось базовыми свечами: пять тысяч штук. На пятиминутной базе
 * это было семнадцать дней, на минутной стало бы три с половиной — то есть от
 * смены базы менялся бы объём истории на часовом графике. В барах экрана
 * окно одинаково на любом таймфрейме, и вес ответа тоже: около двух тысяч
 * строк, сколько бы минут ни было в баре.
 */
export const REPLAY_FORWARD_TIMEFRAME_BARS = 2_000;
/**
 * Предыстория при прыжке: ровно столько баров, сколько рамка показывает слева
 * от точки старта (defaultFocusRange = 80 назад) — первая загруженная свеча
 * ложится на левый край окна, дальше влево работает только ленивая догрузка.
 */
export const REPLAY_BACK_TIMEFRAME_BARS = 80;
export const MARKET_CANDLE_PREFETCH_THRESHOLD = 500;
export const MARKET_TIMEFRAME_PREFETCH_BARS = 20;

export interface MarketCandleRange {
  from: number;
  to: number;
}

interface MarketRangeBoundary {
  from: number;
  to: number;
}

const alignDown = (timeMs: number): number =>
  Math.floor(timeMs / MARKET_CANDLE_INTERVAL_MS) * MARKET_CANDLE_INTERVAL_MS;

const alignUp = (timeMs: number): number =>
  Math.ceil(timeMs / MARKET_CANDLE_INTERVAL_MS) * MARKET_CANDLE_INTERVAL_MS;

export function buildInitialMarketCandleRange(
  boundary: MarketRangeBoundary,
  candleLimit = INITIAL_MARKET_CANDLE_LIMIT,
): MarketCandleRange | null {
  const from = alignDown(boundary.from);
  const to = Math.min(alignUp(boundary.to), from + candleLimit * MARKET_CANDLE_INTERVAL_MS);
  return to > from ? { from, to } : null;
}

const timeframeToBaseCandles = (timeframeMinutes: number): number => {
  if (!Number.isFinite(timeframeMinutes) || timeframeMinutes <= 0) return 1;
  return Math.max(1, Math.ceil((timeframeMinutes * 60 * 1_000) / MARKET_CANDLE_INTERVAL_MS));
};

/** Базовых свечей вперёд, которые intrabar-резолвер SL/TP держит вокруг головы. */
export const INTRABAR_FORWARD_BASE_CANDLES = 5_000;

/**
 * Базовое окно вокруг времени воспроизведения для intrabar-резолвера: текущий
 * бар таймфрейма целиком (на бар назад) плюс форвардный буфер (~3.5 суток на
 * минутной базе). НЕ весь форвард дисплея — иначе на старших ТФ это сотни
 * тысяч свечей.
 */
export function buildIntrabarWindow(
  boundary: MarketRangeBoundary,
  targetTimeMs: number,
  timeframeMinutes: number,
): MarketCandleRange | null {
  const boundaryFrom = alignDown(boundary.from);
  const boundaryTo = alignUp(boundary.to);
  if (boundaryTo <= boundaryFrom) return null;
  const tfBaseCandles = timeframeToBaseCandles(timeframeMinutes);
  const aligned = alignDown(targetTimeMs);
  const from = Math.max(boundaryFrom, aligned - tfBaseCandles * MARKET_CANDLE_INTERVAL_MS);
  const to = Math.min(boundaryTo, aligned + INTRABAR_FORWARD_BASE_CANDLES * MARKET_CANDLE_INTERVAL_MS);
  return to > from ? { from, to } : null;
}

export function initialMarketCandleLimitForTimeframe(timeframeMinutes: number): number {
  return Math.max(
    INITIAL_MARKET_CANDLE_LIMIT,
    REPLAY_FORWARD_TIMEFRAME_BARS * timeframeToBaseCandles(timeframeMinutes),
  );
}

export function prefetchMarketCandleThresholdForTimeframe(timeframeMinutes: number): number {
  return Math.max(
    MARKET_CANDLE_PREFETCH_THRESHOLD,
    MARKET_TIMEFRAME_PREFETCH_BARS * timeframeToBaseCandles(timeframeMinutes),
  );
}

export function buildReplayStartMarketCandleRange(
  boundary: MarketRangeBoundary,
  targetTimeMs: number,
  timeframeMinutes = BASE_TIMEFRAME_MINUTES,
): MarketCandleRange | null {
  const boundaryFrom = alignDown(boundary.from);
  const boundaryTo = alignUp(boundary.to);
  if (boundaryTo <= boundaryFrom) return null;

  const timeframeBaseCandles = timeframeToBaseCandles(timeframeMinutes);
  const forwardCandles = REPLAY_FORWARD_TIMEFRAME_BARS * timeframeBaseCandles;
  // Окно, а не весь префикс датасета: прыжок на дату/рандом/смену таймфрейма
  // грузит ограниченную предысторию, дальше влево лениво догружает loadEarlier.
  const backCandles = REPLAY_BACK_TIMEFRAME_BARS * timeframeBaseCandles;
  const alignedTarget = alignDown(targetTimeMs);
  const from = Math.max(boundaryFrom, alignedTarget - backCandles * MARKET_CANDLE_INTERVAL_MS);
  const to = Math.min(boundaryTo, alignedTarget + forwardCandles * MARKET_CANDLE_INTERVAL_MS);

  return to > from ? { from, to } : null;
}

export function hasLoadedMarketCandleRange(
  loadedCandles: { time: number }[],
  range: MarketCandleRange,
): boolean {
  const first = loadedCandles[0];
  const last = loadedCandles.at(-1);
  if (!first || !last) return false;
  const firstTimeMs = first.time * 1_000;
  const lastExclusiveMs = (last.time * 1_000) + MARKET_CANDLE_INTERVAL_MS;
  return firstTimeMs <= range.from && lastExclusiveMs >= range.to;
}

/**
 * Голова правее последнего закрытого бакета — типичный случай 30m на последнем
 * дне истории, затем переход на 1д: дневка этого дня ещё не закрыта и в окне
 * нет. Ждать больше нечего, ставим якорь в конец последней доступной свечи.
 * Левее окна не трогаем: так и раньше changeTimeframe ставил индекс на первую свечу.
 */
export function clampPlayheadToLoadedWindow(
  playheadTime: number,
  candles: { time: number }[],
  timeframeMinutes: number,
): number {
  if (!candles.length || !Number.isFinite(playheadTime)) return playheadTime;
  const lastOpen = candles[candles.length - 1].time;
  const lastEnd = lastOpen + Math.max(1, timeframeMinutes) * 60;
  return playheadTime > lastEnd ? lastEnd - 1 : playheadTime;
}

/**
 * Решение эффекта смены ТФ: ждать, пока окно не в новом разрешении, и только
 * если голова уехала за последний закрытый бакет — подрезать якорь.
 */
export function resolvePendingTimeframeChange(
  pending: { timeframe: number; replayTime: number } | null,
  candles: { time: number }[],
): { timeframe: number; replayTime: number } | null {
  if (!pending || !candles.length) return null;
  const loadedTf = candles.length > 1 ? inferTimeframeMinutes(candles, pending.timeframe) : null;
  if (loadedTf != null && loadedTf !== pending.timeframe) return null;
  return {
    timeframe: pending.timeframe,
    replayTime: clampPlayheadToLoadedWindow(
      pending.replayTime,
      candles,
      loadedTf ?? pending.timeframe,
    ),
  };
}

/**
 * Таймфрейм загруженного окна — по МИНИМАЛЬНОМУ расстоянию между барами.
 *
 * По первым двум свечам считать нельзя: у форекса окно нередко начинается перед
 * выходными, и тогда «час» превращался в двое суток. От этого разъезжались и
 * запросы догрузки, и распознавание смены таймфрейма.
 */
export function inferTimeframeMinutes(
  candles: { time: number }[],
  fallbackMinutes: number,
): number {
  let smallest = Infinity;
  for (let index = 1; index < candles.length; index += 1) {
    const delta = candles[index].time - candles[index - 1].time;
    if (delta > 0 && delta < smallest) smallest = delta;
  }
  return Number.isFinite(smallest) ? Math.max(1, Math.round(smallest / 60)) : fallbackMinutes;
}

/**
 * Среднее календарное расстояние между барами загруженного окна.
 *
 * У круглосуточной крипты оно равно таймфрейму, у форекса больше: выходные
 * съедают почти треть недели. По нему и меряются окна догрузки — иначе число
 * баров и календарное время расходятся.
 */
export function averageBarSpacingMs(candles: { time: number }[]): number | null {
  if (candles.length < 2) return null;
  const spanMs = (candles[candles.length - 1].time - candles[0].time) * 1_000;
  return spanMs > 0 ? spanMs / (candles.length - 1) : null;
}

/**
 * Окно влево под нужное число баров.
 *
 * Просить «missingBars × таймфрейм» назад нельзя: у форекса такой отрезок может
 * целиком лежать в закрытом рынке и не дать ни одной свечи — график упирался в
 * край и переставал догружать. Шаг берётся по фактической плотности окна, а
 * attempt расширяет его, когда рынок молчал дольше обычного: праздники длиннее
 * выходных, и одной попытки на них не хватает.
 */
export function buildEarlierMarketCandleRange(
  boundary: MarketRangeBoundary,
  loadedCandles: { time: number }[],
  missingBars: number,
  attempt = 0,
  fallbackTimeframeMinutes = BASE_TIMEFRAME_MINUTES,
): MarketCandleRange | null {
  const first = loadedCandles[0];
  if (!first || missingBars <= 0) return null;
  const to = first.time * 1_000;
  const boundaryFrom = alignDown(boundary.from);
  if (to <= boundaryFrom) return null;

  const timeframeMs = inferTimeframeMinutes(loadedCandles, fallbackTimeframeMinutes) * 60_000;
  const spacing = Math.max(timeframeMs, averageBarSpacingMs(loadedCandles) ?? timeframeMs);
  const from = Math.max(boundaryFrom, to - Math.ceil(missingBars * spacing * 3 ** attempt));
  return from < to ? { from, to } : null;
}

export function buildNextMarketCandleRange(
  boundary: MarketRangeBoundary,
  loadedCandles: { time: number }[],
  candleLimit = NEXT_MARKET_CANDLE_LIMIT,
): MarketCandleRange | null {
  const lastLoaded = loadedCandles.at(-1);
  if (!lastLoaded) return buildInitialMarketCandleRange(boundary, candleLimit);
  const from = alignDown((lastLoaded.time * 1_000) + MARKET_CANDLE_INTERVAL_MS);
  const to = Math.min(alignUp(boundary.to), from + candleLimit * MARKET_CANDLE_INTERVAL_MS);
  return to > from ? { from, to } : null;
}

/** Сколько загруженных баров осталось правее головы. */
function barsAhead(loadedCandles: { time: number }[], currentTime: number): number {
  let low = 0;
  let high = loadedCandles.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (loadedCandles[middle].time <= currentTime) low = middle + 1;
    else high = middle;
  }
  return loadedCandles.length - low;
}

export function shouldPrefetchMarketCandles(
  loadedCandles: { time: number }[],
  currentTime: number | null | undefined,
  threshold = MARKET_CANDLE_PREFETCH_THRESHOLD,
): boolean {
  const last = loadedCandles.at(-1);
  if (!last || currentTime == null) return false;
  const remainingMs = (last.time - currentTime) * 1_000;
  if (remainingMs <= threshold * MARKET_CANDLE_INTERVAL_MS) return true;
  // На закрытом рынке календарный остаток врёт: выходные внутри него раздувают
  // время, а баров до края окна остаются единицы, и подкачка просыпалась, когда
  // голова уже упиралась в край. Поэтому считаем ещё и сами бары. Круглосуточный
  // рынок этой ветки не замечает: там календарный порог срабатывает не позже.
  return barsAhead(loadedCandles, currentTime) <= MARKET_TIMEFRAME_PREFETCH_BARS;
}
