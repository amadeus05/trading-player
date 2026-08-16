import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import {
  CandlestickSeries,
  CrosshairMode,
  createChart,
  HistogramSeries,
  type CandlestickData,
  type HistogramData,
  type LogicalRange,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type {
  Barrier,
  Candle,
  Trade,
} from "../../types";
import {
  attachFibonacciTool,
  attachFibonacciTrendExtensionTool,
  attachHorizontalLineTool,
  attachMeasureTool,
  attachParallelChannelTool,
  attachRectangleTool,
  attachTrendLineTool,
  attachVolumeProfileTool,
  DrawingManager,
  type DrawingMode,
} from "../../drawing";
import { attachClosedTradeOverlay } from "./closedTradeOverlay";
import { attachSessionsOverlay } from "./sessionsOverlay";
import { attachFvgOverlay } from "./fvgOverlay";
import { attachPriceMarkers } from "./priceMarkers";
import type { DrawingActions, DrawingCollections } from "../drawings/useDrawingCollections";
import { keepIncompleteLastBar } from "../replay/playheadCandle";
import { defaultFocusRange, isFocusRangeApplied, resolveChartViewport } from "./chartFocusRange";

const toCandlestickData = (candle: Candle): CandlestickData<UTCTimestamp> => ({
  time: candle.time as UTCTimestamp,
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
});

const toVolumeData = (candle: Candle): HistogramData<UTCTimestamp> => ({
  time: candle.time as UTCTimestamp,
  value: candle.volume,
  color: candle.close >= candle.open ? "#2bd9a8cc" : "#ff5c73cc",
});

const VOLUME_PANE_STRETCH_KEY = "player:volume-pane-stretch";
const DEFAULT_PRICE_PANE_STRETCH = 0.78;
const DEFAULT_VOLUME_PANE_STRETCH = 0.22;

function readVolumePaneStretch(): { price: number; volume: number } {
  try {
    const parsed = JSON.parse(localStorage.getItem(VOLUME_PANE_STRETCH_KEY) ?? "");
    if (
      typeof parsed?.price === "number"
      && typeof parsed?.volume === "number"
      && parsed.price > 0
      && parsed.volume > 0
    ) {
      return { price: parsed.price, volume: parsed.volume };
    }
  } catch {
    /* ignore */
  }
  return { price: DEFAULT_PRICE_PANE_STRETCH, volume: DEFAULT_VOLUME_PANE_STRETCH };
}

function writeVolumePaneStretch(price: number, volume: number) {
  try {
    localStorage.setItem(VOLUME_PANE_STRETCH_KEY, JSON.stringify({ price, volume }));
  } catch {
    /* ignore quota / private mode */
  }
}

const cloneDatasetItems = <Item extends { datasetId: string }>(items: Item[], datasetId: string): Item[] =>
  structuredClone(items.filter((item) => item.datasetId === datasetId));

interface PriceRange {
  from: number;
  to: number;
}

export type ChartViewportRef = {
  getVisiblePriceRange: () => PriceRange | null;
  /** Расширяет шкалу, чтобы стоп/тейк/вход не обрезались краем графика. */
  ensurePricesVisible: (prices: number[]) => void;
};

interface ReplayChartProps {
  candles: Candle[];
  /**
   * Свечи базового таймфрейма на окне (секунды, включительно) — того ТФ, в
   * котором скачана история. Пустой массив, если окно ещё не загружено.
   *
   * Нужны профилю объёма: он должен считаться по самым мелким доступным барам,
   * а не по тем, что сейчас на экране. На часовом графике это разница в
   * двенадцать раз по числу точек гистограммы.
   */
  getBaseCandles: (fromTime: number, toTime: number) => Candle[];
  /** Растёт, когда доехало очередное окно базовых свечей. */
  baseCandlesRevision: number;
  index: number;
  barriers: Barrier[];
  trades: Trade[];
  onBarrierChange: (id: string, kind: "tp" | "sl", price: number) => void;
  selectingStart: boolean;
  onStartSelected: (time: number) => void;
  focusRevision: number;
  onInteractionChange: (active: boolean) => void;
  pricePrecision: number;
  quoteAsset: string;
  entryMarker?: { id: string; price: number };
  onEntryMarkerChange: (id: string, price: number) => void;
  showClosedTradeOverlays: boolean;
  showTradingSessions: boolean;
  showFairValueGaps: boolean;
  markersEditable: boolean;
  drawings: DrawingCollections;
  drawingActions: DrawingActions;
  drawingRestoreRevision: number;
  drawingMode: DrawingMode;
  datasetId: string;
  drawingsVisible: boolean;
  followCandle: boolean;
  chartViewportRef?: MutableRefObject<ChartViewportRef | null>;
  onDrawingComplete: () => void;
  /** Вьюпорт ушёл левее первой свечи: missingBars — сколько баров не хватает до края рамки. */
  onNeedEarlierCandles?: (missingBars: number) => void;
  deleteAllDrawingsRef?: MutableRefObject<(() => void) | null>;
}

export function ReplayChart({
  candles,
  getBaseCandles,
  baseCandlesRevision,
  index,
  barriers,
  trades,
  onBarrierChange,
  selectingStart,
  onStartSelected,
  focusRevision,
  onInteractionChange,
  pricePrecision,
  quoteAsset,
  entryMarker,
  onEntryMarkerChange,
  showClosedTradeOverlays,
  showTradingSessions,
  showFairValueGaps,
  markersEditable,
  drawings,
  drawingActions,
  drawingRestoreRevision,
  drawingMode,
  datasetId,
  drawingsVisible,
  followCandle,
  chartViewportRef,
  onDrawingComplete,
  onNeedEarlierCandles,
  deleteAllDrawingsRef,
}: ReplayChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const getBaseCandlesRef = useRef(getBaseCandles);
  getBaseCandlesRef.current = getBaseCandles;
  const selectingStartRef = useRef(selectingStart);
  selectingStartRef.current = selectingStart;
  const followCandleRef = useRef(followCandle);
  followCandleRef.current = followCandle;
  const selectedTrendLineId = useRef<string | null>(null);
  const savedLogicalRange = useRef<LogicalRange | null>(null);
  const savedPriceRange = useRef<PriceRange | null>(null);
  const savedCandleInterval = useRef<number | null>(null);
  // Рамка, которую мы намеренно выставили (фокус/смена ТФ). На свежем монтаже
  // график ещё не разложил layout и обрезает её до прижатой к правому краю —
  // сохраняем намерение, а не фактический диапазон, иначе cleanup решит, что
  // пользователь «следует за реальным временем», и закрепит край.
  const pendingFocusRange = useRef<LogicalRange | null>(null);
  /** Пользователь потащил график: на пересборке держим живое окно, не старый прыжок. */
  const userMovedViewportRef = useRef(false);
  const indexRef = useRef(index);
  indexRef.current = index;
  const renderedIndex = useRef<number | null>(null);
  // Датасет, свечи которого сейчас на графике. Нужен, чтобы отличить смену
  // монеты от обычного обновления: рамка, ценовой диапазон и компенсация
  // догрузки истории имеют смысл только внутри одного датасета.
  const datasetIdRef = useRef(datasetId);
  datasetIdRef.current = datasetId;
  const renderedDatasetId = useRef<string | null>(null);
  /**
   * Ждём свечи нового рынка. datasetId меняется раньше данных, поэтому первое
   * обновление после переключения приходит ещё со свечами прошлой монеты — по
   * ним нельзя ни подгонять ценовую шкалу, ни запирать её.
   */
  const awaitingDatasetData = useRef(false);
  const followRealtime = useRef(true);
  // Заведомо «непринятая» ревизия: на переключении ТФ вверх candles на кадр
  // пустеет, PlayerPage размонтирует график, и все ref'ы сбрасываются. Если
  // считать фокус уже применённым, свежий монтаж уходит в scrollToPosition и
  // липнет к правому краю — вниз окно ставилось, вверх нет. Требуем фокус и на
  // первом монтаже, чтобы рамка была одинаковой в обе стороны.
  const drawingManagerRef = useRef<DrawingManager | null>(null);
  const appliedFocusRevision = useRef(focusRevision - 1);
  const appliedDrawingRestoreRevision = useRef(drawingRestoreRevision);
  const chartDatasetId = useRef<string | null>(null);
  const chartRuntimeRef = useRef<{
    applyReplayIndex: (
      nextIndex: number,
      allCandles: Candle[],
      forcedRange?: LogicalRange | null,
      preserveViewport?: boolean,
    ) => void;
    refreshLastCandle: (candle: Candle) => void;
    syncOverlays: () => void;
    setDrawingsVisible: (visible: boolean) => void;
    setDrawingMode: (mode: DrawingMode) => void;
    rebuildTradeOverlays: () => void;
    lockPriceScale: () => void;
  } | null>(null);
  const overlayPropsRef = useRef({
    barriers,
    trades,
    entryMarker,
    markersEditable,
    showClosedTradeOverlays,
    showTradingSessions,
    showFairValueGaps,
  });
  overlayPropsRef.current = {
    barriers,
    trades,
    entryMarker,
    markersEditable,
    showClosedTradeOverlays,
    showTradingSessions,
    showFairValueGaps,
  };
  const prevReplayIndexRef = useRef(index);
  const callbacksRef = useRef({
    onBarrierChange,
    onStartSelected,
    onEntryMarkerChange,
    drawingActions,
    onDrawingComplete,
    onNeedEarlierCandles,
  });
  callbacksRef.current = {
    onBarrierChange,
    onStartSelected,
    onEntryMarkerChange,
    drawingActions,
    onDrawingComplete,
    onNeedEarlierCandles,
  };
  // Stable primitive so prefetch-driven candle appends (same array identity
  // semantics aside, new reference / same interval) don't recreate the chart.
  const candleInterval = useMemo(
    () => (candles.length > 1 ? candles[1].time - candles[0].time : null),
    [candles],
  );
  useEffect(() => {
    const liveCandles = candlesRef.current;
    if (!ref.current || !liveCandles.length) return;
    const safeIndex = Math.max(0, Math.min(index, liveCandles.length - 1));
    const visible = liveCandles.slice(0, safeIndex + 1);
    const timeframeChanged = savedCandleInterval.current != null
      && candleInterval != null
      && savedCandleInterval.current !== candleInterval;
    const datasetSwitched = chartDatasetId.current != null
      && chartDatasetId.current !== datasetId;
    chartDatasetId.current = datasetId;
    const forceFocus = appliedFocusRevision.current !== focusRevision || datasetSwitched;
    if (datasetSwitched || forceFocus) userMovedViewportRef.current = false;
    const restoreDrawings = appliedDrawingRestoreRevision.current !== drawingRestoreRevision;
    const restoreViewportRange = restoreDrawings ? savedLogicalRange.current : null;
    const restorePriceRange = restoreDrawings ? savedPriceRange.current : null;
    if (!visible.length) return;
    const candleStore = { candles: visible as Candle[] };
    const drawingCandleStore = { candles: liveCandles as Candle[] };
    /**
     * Годится ли ценовой диапазон для текущих свечей. Мало проверить, что он
     * корректно сформирован: после пересоздания графика (смена датасета) шкала
     * возвращает диапазон от ПРЕЖНИХ данных — он валиден, но из другой ценовой
     * области. Защёлкнув его, мы уводили свечи за экран: оставались видны только
     * объёмы (у них своя шкала), и лечилось это лишь двойным кликом по шкале.
     */
    const priceRangeFitsCandles = (range: PriceRange | null | undefined): range is PriceRange => {
      if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from === range.to) return false;
      let low = Infinity;
      let high = -Infinity;
      for (const candle of candleStore.candles) {
        if (candle.low < low) low = candle.low;
        if (candle.high > high) high = candle.high;
      }
      if (!Number.isFinite(low) || !Number.isFinite(high)) return false;
      return Math.max(range.from, range.to) >= low && Math.min(range.from, range.to) <= high;
    };
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { color: "#0d0f15" },
        textColor: "#7f8494",
        panes: {
          enableResize: true,
          separatorColor: "#232632",
          separatorHoverColor: "rgba(124, 108, 242, 0.28)",
        },
      },
      grid: {
        vertLines: { color: "#171a22" },
        horzLines: { color: "#171a22" },
      },
      crosshair: {
        mode: drawingMode === "measure" ? CrosshairMode.Hidden : CrosshairMode.Normal,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
      },
      rightPriceScale: { borderColor: "#232632" },
      timeScale: {
        borderColor: "#232632",
        timeVisible: true,
        // Replay adds bars into the right whitespace; the default auto-shift
        // races overlay coordinate sync and causes a 1-bar flicker.
        shiftVisibleRangeOnNewBar: false,
        allowShiftVisibleRangeOnWhitespaceReplacement: false,
      },
    });
    const drawingManager = new DrawingManager(ref.current, {
      onDeleteAll: () => callbacksRef.current.drawingActions.deleteAllForDataset(datasetId),
    });
    drawingManagerRef.current = drawingManager;
    drawingManager.setMode(drawingMode);
    drawingManager.setDrawingsVisible(drawingsVisible);
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: "#2bd9a8",
      downColor: "#ff5c73",
      wickUpColor: "#2bd9a8",
      wickDownColor: "#ff5c73",
      borderVisible: false,
      priceFormat: { type: "price", precision: pricePrecision, minMove: 10 ** -pricePrecision },
    });
    cs.setData(candleStore.candles.map(toCandlestickData));
    // Сохранённый диапазон переживает смену датасета — применяем только если он
    // действительно про эти свечи.
    if (priceRangeFitsCandles(restorePriceRange)) {
      cs.priceScale().applyOptions({ autoScale: false });
      cs.priceScale().setVisibleRange(restorePriceRange);
    }
    const vs = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: true,
    }, 1);
    vs.priceScale().applyOptions({
      scaleMargins: { top: 0.08, bottom: 0 },
      borderColor: "#232632",
    });
    vs.setData(candleStore.candles.map(toVolumeData));
    const volumeStretch = readVolumePaneStretch();
    const panes = chart.panes();
    panes[0]?.setStretchFactor(volumeStretch.price);
    panes[1]?.setStretchFactor(volumeStretch.volume);
    let replayUpdateInProgress = false;
    let lastPriceFitAt = 0;
    let lastFittedLow = Number.NaN;
    let lastFittedHigh = Number.NaN;
    const primePriceScaleInteraction = () => {
      const range = cs.priceScale().getVisibleRange();
      if (priceRangeFitsCandles(range)) {
        cs.priceScale().applyOptions({ autoScale: false });
        cs.priceScale().setVisibleRange(range);
        return;
      }
      // Диапазон отсутствует или не про эти свечи — считаем его из самих свечей.
      // Автомасштаб она тоже выключает, так что перетаскивание шкалы не ломается.
      fitPriceScaleToVisible(true);
    };
    // Fits the price scale to whatever candles are on screen, like autoScale would,
    // but keeps autoScale itself off — lightweight-charts refuses to start a vertical
    // price-axis drag while autoScale is on, so toggling it on/off for follow mode
    // left dragging permanently stuck once follow mode was turned off.
    /**
     * explicitRange — рамка, которую мы только что выставили сами.
     *
     * Читать её обратно через getVisibleLogicalRange() нельзя: кадр ещё не
     * прошёл, и график отдаёт ПРЕЖНИЙ диапазон. На смене монеты это диапазон
     * прошлого рынка — шкала садилась на случайный кусок новых данных, и
     * половина графика уходила за экран, пока не отмасштабируешь вручную.
     */
    const fitPriceScaleToVisible = (force = false, explicitRange: LogicalRange | null = null) => {
      const all = candleStore.candles;
      if (!all.length) return;
      const now = performance.now();
      // During rapid replay appends, refitting every tick starves pointer input.
      if (!force && now - lastPriceFitAt < 100) return;
      const logicalRange = explicitRange ?? chart.timeScale().getVisibleLogicalRange();
      let from = 0;
      let to = all.length - 1;
      if (logicalRange) {
        from = Math.max(0, Math.floor(logicalRange.from));
        to = Math.min(all.length - 1, Math.ceil(logicalRange.to));
        if (to < from) return;
      }
      let low = Infinity;
      let high = -Infinity;
      for (let i = from; i <= to; i += 1) {
        const candle = all[i];
        if (candle.low < low) low = candle.low;
        if (candle.high > high) high = candle.high;
      }
      if (!Number.isFinite(low) || !Number.isFinite(high)) return;
      // Skip no-op fits when the visible high/low barely moved.
      if (
        !force
        && Math.abs(low - lastFittedLow) < 1e-8
        && Math.abs(high - lastFittedHigh) < 1e-8
      ) {
        return;
      }
      const span = high - low;
      const padding = span > 0 ? span * 0.08 : Math.max(Math.abs(high) * 0.01, 1);
      cs.priceScale().applyOptions({ autoScale: false });
      cs.priceScale().setVisibleRange({ from: low - padding, to: high + padding });
      lastPriceFitAt = now;
      lastFittedLow = low;
      lastFittedHigh = high;
    };
    const applyReplayIndex = (
      nextIndex: number,
      allCandles: Candle[],
      forcedRange: LogicalRange | null = null,
      preserveViewport = false,
    ) => {
      if (!allCandles.length) return;
      // Смена монеты — это не продолжение, а новый график. Всё накопленное
      // относится к прежнему датасету: сохранённая рамка, ценовой диапазон,
      // предыдущий состав свечей. Применять их к другому рынку нельзя — именно
      // так на новой монете оказывалась рамка от старой, и свечи рисовались
      // куском у правого края с пустотой слева.
      const datasetChanged = renderedDatasetId.current !== datasetIdRef.current;
      renderedDatasetId.current = datasetIdRef.current;
      if (datasetChanged) {
        renderedIndex.current = null;
        savedLogicalRange.current = null;
        savedPriceRange.current = null;
        followRealtime.current = false;
        // Не трогаем pendingFocusRange, если нам только что передали рамку:
        // иначе rAF после монтажа не знает, что ставить, и ряд липнет вправо.
        if (forcedRange == null) pendingFocusRange.current = null;
      }
      // Обычное обновление (без навязанной рамки) — значит момент фокуса позади.
      // Снимаем флаг, иначе syncViewportState останется выключенным навсегда, а
      // savedLogicalRange застрянет на устаревшем значении: пишем один диапазон,
      // читаем предыдущий, и вьюпорт начинает дёргаться между двумя на каждом тике.
      if (forcedRange == null) pendingFocusRange.current = null;
      const nextSafeIndex = Math.max(0, Math.min(nextIndex, allCandles.length - 1));
      const nextVisible = allCandles.slice(0, nextSafeIndex + 1);
      const shouldFollowRealtime = !datasetChanged && (followCandleRef.current || followRealtime.current);
      // На смене монеты прежний состав в расчёт не берём: сравнивать времена
      // свечей разных рынков бессмысленно, и компенсация догрузки истории
      // выдала бы мусорный сдвиг рамки.
      const previousVisible = datasetChanged ? [] : candleStore.candles;
      const delta = renderedIndex.current == null ? 0 : nextSafeIndex - renderedIndex.current;
      // Догрузка истории влево prepend'ит свечи: логические индексы графика
      // сдвигаются на prependedBars, и сохранённый viewport надо сдвинуть с ними,
      // иначе картинка прыгнет назад. Prepend валиден, только если прежняя первая
      // свеча всё ещё присутствует на позиции prependedBars (иначе это смена данных).
      const prevFirstTime = previousVisible[0]?.time;
      let prependedBars = 0;
      if (prevFirstTime != null && nextVisible.length && nextVisible[0].time < prevFirstTime) {
        while (prependedBars < nextVisible.length && nextVisible[prependedBars].time < prevFirstTime) {
          prependedBars += 1;
        }
        if (nextVisible[prependedBars]?.time !== prevFirstTime) prependedBars = 0;
      } else if (prevFirstTime != null && nextVisible.length && nextVisible[0].time > prevFirstTime) {
        // Симметричный случай: окно заменили на сдвинутое вперёд (перезагрузка
        // вокруг выбранной свечи), слева выпало N баров — логические индексы
        // уменьшились, рамку двигаем влево, чтобы картинка осталась на месте.
        let dropped = 0;
        while (dropped < previousVisible.length && previousVisible[dropped].time < nextVisible[0].time) {
          dropped += 1;
        }
        prependedBars = previousVisible[dropped]?.time === nextVisible[0].time ? -dropped : 0;
      }
      // На смене монеты откат к getVisibleLogicalRange() недопустим: там всё ещё
      // рамка прежнего рынка. Отдаём null, чтобы ниже встала defaultFocusRange.
      // Если пользователь уже потащил график — живой диапазон, не фокус прыжка.
      let preservedRange = resolveChartViewport({
        forcedRange,
        userMoved: userMovedViewportRef.current,
        liveRange: chart.timeScale().getVisibleLogicalRange(),
        savedRange: savedLogicalRange.current,
        datasetChanged,
        preserveViewport,
        followRealtime: shouldFollowRealtime,
      });
      if (preservedRange && prependedBars !== 0) {
        preservedRange = {
          from: preservedRange.from + prependedBars,
          to: preservedRange.to + prependedBars,
        } as LogicalRange;
      }
      const canAppendOneBar = delta === 1
        && nextVisible.length === previousVisible.length + 1
        && previousVisible.length > 0
        && nextVisible[previousVisible.length - 1].time === previousVisible[previousVisible.length - 1].time;
      // Зум/догрузка слева пересобирает серию. Последний бар не должен вырасти:
      // дорисовка идёт только шагом Play (append) или refreshLastCandle.
      const previousLast = previousVisible.at(-1);
      const incomingLast = nextVisible.at(-1);
      const retainedLast = keepIncompleteLastBar(previousLast, incomingLast, canAppendOneBar);
      if (retainedLast && incomingLast && retainedLast !== incomingLast) {
        nextVisible[nextVisible.length - 1] = retainedLast;
      }

      replayUpdateInProgress = true;
      try {
        candleStore.candles = nextVisible;
        drawingCandleStore.candles = allCandles;
        if (canAppendOneBar) {
          const appended = nextVisible[nextVisible.length - 1];
          cs.update(toCandlestickData(appended));
          vs.update(toVolumeData(appended));
        } else {
          cs.setData(nextVisible.map(toCandlestickData));
          vs.setData(nextVisible.map(toVolumeData));
        }

        // Запоминаем рамку, которую сами выставили. Читать её обратно через
        // getVisibleLogicalRange() сразу после записи нельзя: кадр ещё не прошёл
        // и возвращается предыдущее значение. Из-за этого savedLogicalRange
        // застревал на устаревшем диапазоне, и на следующем тике график
        // восстанавливал его — отсюда скачки масштаба и прижатие к правому краю.
        let appliedRange: LogicalRange | null = null;
        const leaveViewportAlone = userMovedViewportRef.current
          && !shouldFollowRealtime
          && forcedRange == null
          && (canAppendOneBar || preservedRange == null);
        if (leaveViewportAlone) {
          appliedRange = chart.timeScale().getVisibleLogicalRange();
        } else if (preservedRange) {
          chart.timeScale().setVisibleLogicalRange(preservedRange);
          appliedRange = preservedRange;
        } else if (!preserveViewport && shouldFollowRealtime && nextVisible.length > 1) {
          // scrollToRealTime() is always animated, which keeps firing visible-range
          // change events for ~1s and starves the overlay sync (each event reschedules
          // it 2 frames out). scrollToPosition(0, false) reaches the same edge instantly.
          chart.timeScale().scrollToPosition(0, false);
        } else if (!preserveViewport || datasetChanged) {
          // datasetChanged проходит даже при preserveViewport: сохранять нечего,
          // а без этой ветки рамка осталась бы от прежней монеты.
          appliedRange = defaultFocusRange(nextSafeIndex);
          chart.timeScale().setVisibleLogicalRange(appliedRange);
        }

        // Ветка scrollToPosition своей рамки не задаёт — только там читаем факт.
        savedLogicalRange.current = appliedRange ?? chart.timeScale().getVisibleLogicalRange();
        savedPriceRange.current = cs.priceScale().getVisibleRange();
        followRealtime.current = followCandleRef.current
          ? shouldFollowRealtime
          : (userMovedViewportRef.current ? false : shouldFollowRealtime);
        renderedIndex.current = nextIndex;
        if (datasetChanged) awaitingDatasetData.current = true;
        if (awaitingDatasetData.current) {
          // Ценовая шкала прежнего рынка новому не годится: SOL живёт около 150,
          // ETH около 1800. Держим автомасштаб, пока данные не сменились на самом
          // деле — по первому времени свечи. Разово подгонять нельзя: подгонка
          // ставит autoScale: false и запирает диапазон, а на этом шаге свечи ещё
          // от прошлой монеты либо окно приехало не целиком.
          if (!datasetChanged && previousVisible.length && nextVisible[0]?.time !== previousVisible[0]?.time) {
            awaitingDatasetData.current = false;
          }
          cs.priceScale().applyOptions({ autoScale: true });
        } else if (followCandleRef.current) {
          fitPriceScaleToVisible(true);
        } else if (!canAppendOneBar && !forcedRange) {
          primePriceScaleInteraction();
        }
        // Full jumps need an immediate overlay sync; per-bar playback must throttle
        // or pointer/crosshair input freezes on every tick at high speed.
        if (canAppendOneBar) {
          drawingManager.scheduleOverlaySyncThrottled(120);
        } else {
          drawingManager.scheduleOverlaySync();
        }
      } finally {
        replayUpdateInProgress = false;
      }
    };
    const syncViewportState = () => {
      if (replayUpdateInProgress) return;
      // Пока действует выставленная нами рамка и пользователь её не трогал, не
      // даём ещё не разложенному графику подменить намерение: он отдаёт диапазон,
      // прижатый к последней свече, и отсюда включалось «следование за краем».
      if (pendingFocusRange.current || awaitingDatasetData.current) return;
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      savedLogicalRange.current = range;
      savedPriceRange.current = cs.priceScale().getVisibleRange();
      followRealtime.current = Math.abs(range.to - (candleStore.candles.length - 1)) < 0.75;
    };
    // Пустота слева от первой свечи: |from| логического диапазона — это ровно
    // столько баров, сколько не хватает до края рамки. Догрузка строго ПОСЛЕ
    // отпускания мыши: замена данных посреди зажатого пана дёргает график.
    let earlierRequestTimer = 0;
    let earlierPointerHeld = false;
    let earlierCheckAfterRelease = false;
    const requestEarlierIfNeeded = () => {
      if (earlierPointerHeld) {
        earlierCheckAfterRelease = true;
        return;
      }
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range || range.from >= -0.5) return;
      callbacksRef.current.onNeedEarlierCandles?.(Math.ceil(-range.from));
    };
    const onEarlierPointerDown = () => {
      earlierPointerHeld = true;
    };
    const onEarlierPointerUp = () => {
      earlierPointerHeld = false;
      if (earlierCheckAfterRelease) {
        earlierCheckAfterRelease = false;
        window.clearTimeout(earlierRequestTimer);
        earlierRequestTimer = window.setTimeout(requestEarlierIfNeeded, 120);
      }
    };
    ref.current.addEventListener("pointerdown", onEarlierPointerDown, { capture: true });
    window.addEventListener("pointerup", onEarlierPointerUp);
    window.addEventListener("pointercancel", onEarlierPointerUp);
    const onVisibleRangeChange = () => {
      if (userMovedViewportRef.current) pendingFocusRange.current = null;
      const intended = pendingFocusRange.current;
      if (intended && !userMovedViewportRef.current) {
        const actual = chart.timeScale().getVisibleLogicalRange();
        if (isFocusRangeApplied(intended, actual)) {
          savedLogicalRange.current = intended;
          pendingFocusRange.current = null;
        } else {
          return;
        }
      }
      syncViewportState();
      if (!replayUpdateInProgress) {
        drawingManager.scheduleOverlaySync();
        window.clearTimeout(earlierRequestTimer);
        earlierRequestTimer = window.setTimeout(requestEarlierIfNeeded, 250);
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);
    if (!restoreDrawings) syncViewportState();
    let closedTradeOverlay: ReturnType<typeof attachClosedTradeOverlay> | null = null;
    let sessionsOverlay: ReturnType<typeof attachSessionsOverlay> | null = null;
    let fvgOverlay: ReturnType<typeof attachFvgOverlay> | null = null;
    let priceMarkers: ReturnType<typeof attachPriceMarkers> | null = null;
    let unregisterClosedTradeSync = () => {};
    let unregisterSessionsSync = () => {};
    let unregisterFvgSync = () => {};
    let unregisterPriceMarkerSync = () => {};
    const destroyTradeOverlays = () => {
      unregisterClosedTradeSync();
      unregisterSessionsSync();
      unregisterFvgSync();
      unregisterPriceMarkerSync();
      priceMarkers?.cleanup();
      closedTradeOverlay?.destroy();
      sessionsOverlay?.destroy();
      fvgOverlay?.destroy();
      priceMarkers = null;
      closedTradeOverlay = null;
      sessionsOverlay = null;
      fvgOverlay = null;
      unregisterClosedTradeSync = () => {};
      unregisterSessionsSync = () => {};
      unregisterFvgSync = () => {};
      unregisterPriceMarkerSync = () => {};
    };
    const rebuildTradeOverlays = () => {
      if (!ref.current) return;
      destroyTradeOverlays();
      const props = overlayPropsRef.current;
      closedTradeOverlay = attachClosedTradeOverlay({
        container: ref.current,
        chart,
        series: cs,
        candleStore,
        trades: props.trades,
        visible: props.showClosedTradeOverlays,
      });
      sessionsOverlay = attachSessionsOverlay({
        container: ref.current,
        chart,
        candleStore,
        visible: props.showTradingSessions,
      });
      fvgOverlay = attachFvgOverlay({
        container: ref.current,
        chart,
        series: cs,
        candleStore,
        visible: props.showFairValueGaps,
      });
      priceMarkers = attachPriceMarkers({
        container: ref.current,
        series: cs,
        barriers: props.barriers,
        trades: props.trades,
        entryMarker: props.entryMarker,
        editable: props.markersEditable,
        pricePrecision,
        quoteAsset,
        onBarrierChange: (id, kind, price) =>
          callbacksRef.current.onBarrierChange(id, kind, price),
        onEntryMarkerChange: (id, price) =>
          callbacksRef.current.onEntryMarkerChange(id, price),
        // closedTradeOverlay is registered on its own; avoid syncing it twice per frame.
        onFrame: () => {},
      });
      unregisterClosedTradeSync = drawingManager.registerOverlaySync(closedTradeOverlay.sync);
      unregisterSessionsSync = drawingManager.registerOverlaySync(sessionsOverlay.sync);
      unregisterFvgSync = drawingManager.registerOverlaySync(fvgOverlay.sync);
      unregisterPriceMarkerSync = drawingManager.registerOverlaySync(priceMarkers.sync);
      // Sync overlays immediately so they are positioned/hidden before the
      // browser paints, preventing a flash to the wrong position on rebuild.
      closedTradeOverlay.sync();
      sessionsOverlay.sync();
      fvgOverlay.sync();
      priceMarkers.sync();
      drawingManager.scheduleOverlaySync();
    };
    rebuildTradeOverlays();
    const selectStart = (event: MouseEventParams<Time>) => {
      if (selectingStartRef.current && typeof event.time === "number") {
        callbacksRef.current.onStartSelected(Number(event.time));
      }
    };
    chart.subscribeClick(selectStart);
    let deferredTimeRangeFrame = 0;
    let initialRange: LogicalRange | null = null;
    if (timeframeChanged || forceFocus) {
      // Keep a stable bar density when jumping to a bar or switching timeframe.
      // Смена монеты тоже: без рамки setVisibleLogicalRange не приживается до
      // layout, и график остаётся с пустотой слева / куском у правого края.
      initialRange = defaultFocusRange(safeIndex);
      userMovedViewportRef.current = false;
      if (forceFocus) followRealtime.current = false;
      if (datasetSwitched) {
        savedLogicalRange.current = null;
        savedPriceRange.current = null;
        renderedDatasetId.current = null;
      }
    } else if (restoreDrawings) {
      initialRange = restoreViewportRange;
      followRealtime.current = false;
    }
    if (initialRange) pendingFocusRange.current = initialRange;
    applyReplayIndex(safeIndex, liveCandles, initialRange, restoreDrawings);
    // Ставим именно initialRange, не pending: applyReplayIndex на первом кадре
    // считает смену датасета и раньше обнулял pending — rAF уходил в пустую
    // и график оставался прижатым вправо, слева дыра.
    const applyInitialFocusRange = (intended: LogicalRange): boolean => {
      // Если pending уже сброшен — пользователь сдвинул график. Не возвращаем окно.
      if (userMovedViewportRef.current || pendingFocusRange.current == null) return true;
      chart.timeScale().setVisibleLogicalRange(intended);
      fitPriceScaleToVisible(true, intended);
      const actual = chart.timeScale().getVisibleLogicalRange();
      if (!isFocusRangeApplied(intended, actual)) return false;
      savedLogicalRange.current = intended;
      pendingFocusRange.current = null;
      return true;
    };
    if (initialRange) {
      deferredTimeRangeFrame = requestAnimationFrame(() => {
        if (applyInitialFocusRange(initialRange)) return;
        deferredTimeRangeFrame = requestAnimationFrame(() => {
          applyInitialFocusRange(initialRange);
        });
      });
    }
    appliedFocusRevision.current = focusRevision;
    appliedDrawingRestoreRevision.current = drawingRestoreRevision;
    const syncWorkspaceLayout = () => {
      const nextPriceScaleWidth = Math.max(70, chart.priceScale("right").width());
      ref.current?.parentElement?.parentElement?.style.setProperty(
        "--chart-price-scale-width",
        `${nextPriceScaleWidth}px`,
      );
      return nextPriceScaleWidth;
    };
    let priceScaleWidth = syncWorkspaceLayout();
    const layoutObserver = new ResizeObserver(() => {
      priceScaleWidth = syncWorkspaceLayout();
      if (initialRange && pendingFocusRange.current) applyInitialFocusRange(initialRange);
    });
    if (ref.current) layoutObserver.observe(ref.current);
    const timeScaleHeight = Math.max(28, chart.timeScale().height());
    let chartAlive = true;
    // chartAlive обязателен: обработчик может пережить график, а обращение к
    // серии уничтоженного графика падает внутри библиотеки ("Value is null" из
    // getPane). Причём падало уже ПОСЛЕ выключения autoScale — шкала оставалась
    // запертой без диапазона. У zoomPriceScale такая защита была, у этих двух нет.
    const pricePaneBottom = () => {
      const height = chart.panes()[0]?.getHeight();
      if (height && height > 0) return height;
      const element = ref.current;
      if (!element) return 0;
      return Math.max(0, element.getBoundingClientRect().height - timeScaleHeight);
    };
    const persistVolumePaneStretch = () => {
      if (!chartAlive) return;
      try {
        const nextPanes = chart.panes();
        if (nextPanes.length < 2) return;
        writeVolumePaneStretch(nextPanes[0].getStretchFactor(), nextPanes[1].getStretchFactor());
      } catch {
        /* график уже снят */
      }
    };
    const markManualScale = (event: PointerEvent) => {
      if (!chartAlive) return;
      const element = ref.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      if (x >= bounds.width - priceScaleWidth - 4 && y < pricePaneBottom()) {
        primePriceScaleInteraction();
      }
    };
    const resetManualScale = (event: MouseEvent) => {
      if (!chartAlive) return;
      const element = ref.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      if (x >= bounds.width - priceScaleWidth - 4 && y < pricePaneBottom()) {
        cs.priceScale().applyOptions({ autoScale: true });
      }
    };
    const zoomPriceScale = (event: WheelEvent) => {
      if (!chartAlive) return;
      const element = ref.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const plotRight = bounds.width - priceScaleWidth - 4;
      const timeAxisTop = bounds.height - timeScaleHeight - 4;
      const paneBottom = pricePaneBottom();
      const onCandlePriceScale = x >= plotRight && y >= 0 && y < paneBottom;
      const onVolumePriceScale = x >= plotRight && y >= paneBottom && y < timeAxisTop;
      const withCtrl = event.ctrlKey || event.metaKey;
      if (onVolumePriceScale && !withCtrl) return;
      if (!onCandlePriceScale && !withCtrl) return;
      if (y >= timeAxisTop && x < plotRight) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const range = cs.priceScale().getVisibleRange();
      if (!range) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const factor = Math.min(1.35, Math.max(0.74, Math.exp(event.deltaY * 0.0015)));
      const center = (range.from + range.to) / 2;
      const half = ((range.to - range.from) * factor) / 2;
      const nextRange = { from: center - half, to: center + half };
      cs.priceScale().applyOptions({ autoScale: false });
      cs.priceScale().setVisibleRange(nextRange);
      drawingManager.scheduleOverlaySync();
    };
    let stopChartInteractionOverlayLoop: (() => void) | null = null;
    let chartInteractionWheelTimer = 0;
    const markManualViewportInteraction = () => {
      followRealtime.current = false;
      userMovedViewportRef.current = true;
      // Пользователь сам подвигал график — намерение по рамке больше не актуально.
      pendingFocusRange.current = null;
      if (deferredTimeRangeFrame) {
        cancelAnimationFrame(deferredTimeRangeFrame);
        deferredTimeRangeFrame = 0;
      }
    };
    const startChartInteractionOverlayLoop = () => {
      markManualViewportInteraction();
      if (!stopChartInteractionOverlayLoop) {
        stopChartInteractionOverlayLoop = drawingManager.ensureOverlayLoop();
      }
    };
    const stopChartInteractionOverlayLoopNow = () => {
      window.clearTimeout(chartInteractionWheelTimer);
      chartInteractionWheelTimer = 0;
      stopChartInteractionOverlayLoop?.();
      stopChartInteractionOverlayLoop = null;
      drawingManager.scheduleOverlaySync();
    };
    const syncOverlaysDuringWheel = () => {
      markManualViewportInteraction();
      startChartInteractionOverlayLoop();
      window.clearTimeout(chartInteractionWheelTimer);
      chartInteractionWheelTimer = window.setTimeout(stopChartInteractionOverlayLoopNow, 180);
    };
    ref.current.addEventListener("pointerdown", startChartInteractionOverlayLoop, { capture: true });
    window.addEventListener("pointerup", stopChartInteractionOverlayLoopNow);
    window.addEventListener("pointercancel", stopChartInteractionOverlayLoopNow);
    window.addEventListener("pointerup", persistVolumePaneStretch);
    ref.current.addEventListener("wheel", syncOverlaysDuringWheel, { capture: true, passive: true });
    ref.current.addEventListener("pointerdown", markManualScale);
    ref.current.addEventListener("dblclick", resetManualScale);
    ref.current.addEventListener("wheel", zoomPriceScale, { capture: true, passive: false });
    chartRuntimeRef.current = {
      applyReplayIndex,
      // Точечное обновление последнего бара: незакрытая свеча пересобирается,
      // когда доезжает 5м-окно. Гонять ради этого applyReplayIndex нельзя — там
      // вьюпорт, догрузка истории и события диапазона, и на перезагрузке данных
      // это уходит в бесконечный цикл с прыгающим графиком.
      refreshLastCandle: (candle: Candle) => {
        const current = candleStore.candles;
        if (!current.length) return;
        candleStore.candles = [...current.slice(0, -1), candle];
        cs.update(toCandlestickData(candle));
        vs.update(toVolumeData(candle));
        drawingManager.scheduleOverlaySync();
      },
      syncOverlays: () => drawingManager.scheduleOverlaySync(),
      setDrawingsVisible: (visible) => drawingManager.setDrawingsVisible(visible),
      setDrawingMode: (mode) => {
        drawingManager.setMode(mode);
        chart.applyOptions({
          crosshair: {
            mode: mode === "measure" ? CrosshairMode.Hidden : CrosshairMode.Normal,
          },
        });
      },
      rebuildTradeOverlays,
      lockPriceScale: primePriceScaleInteraction,
    };
    if (chartViewportRef) {
      chartViewportRef.current = {
        getVisiblePriceRange: () => cs.priceScale().getVisibleRange() ?? null,
        ensurePricesVisible: (prices) => {
          const valid = prices.filter((price) => Number.isFinite(price) && price > 0);
          if (!valid.length) return;
          const current = cs.priceScale().getVisibleRange();
          const min = Math.min(...valid);
          const max = Math.max(...valid);
          let from = current?.from ?? min;
          let to = current?.to ?? max;
          if (!(to > from)) {
            from = min;
            to = max;
          }
          const span = Math.max(to - from, max - min, 10 ** -pricePrecision);
          const pad = span * 0.16;
          const nextFrom = Math.min(from, min - pad);
          const nextTo = Math.max(to, max + pad);
          if (nextFrom === from && nextTo === to) return;
          cs.priceScale().applyOptions({ autoScale: false });
          cs.priceScale().setVisibleRange({ from: nextFrom, to: nextTo });
        },
      };
    }
    prevReplayIndexRef.current = index;
    const cleanupTrendLines = attachTrendLineTool({
      manager: drawingManager,
      container: ref.current!,
      chart,
      series: cs,
      candleStore: drawingCandleStore,
      trendLines: cloneDatasetItems(drawings.trendLines, datasetId),
      drawingMode,
      datasetId,
      selectedId: selectedTrendLineId.current,
      onSelect: (id) => { selectedTrendLineId.current = id; },
      callbacks: {
        onCreate: (line) => callbacksRef.current.drawingActions.trendLines.onCreate(line),
        onUpdate: (line) => callbacksRef.current.drawingActions.trendLines.onUpdate(line),
        onDelete: (id) => callbacksRef.current.drawingActions.trendLines.onDelete(id),
        onDrawingComplete: () => callbacksRef.current.onDrawingComplete(),
      },
    });
    const cleanupHorizontalLines = attachHorizontalLineTool({
      manager: drawingManager,
      container: ref.current!,
      chart,
      series: cs,
      candleStore: drawingCandleStore,
      horizontalLines: cloneDatasetItems(drawings.horizontalLines, datasetId),
      drawingMode,
      datasetId,
      pricePrecision,
      callbacks: {
        onCreate: (line) => callbacksRef.current.drawingActions.horizontalLines.onCreate(line),
        onUpdate: (line) => callbacksRef.current.drawingActions.horizontalLines.onUpdate(line),
        onDelete: (id) => callbacksRef.current.drawingActions.horizontalLines.onDelete(id),
        onDrawingComplete: () => callbacksRef.current.onDrawingComplete(),
      },
    });
    const cleanupMeasure = attachMeasureTool({
      manager: drawingManager,
      container: ref.current!,
      chart,
      series: cs,
      candleStore: drawingCandleStore,
      active: drawingMode === "measure",
      pricePrecision,
      onComplete: () => callbacksRef.current.onDrawingComplete(),
    });
    const cleanupRectangles = attachRectangleTool({
      manager: drawingManager,
      container: ref.current!,
      chart,
      series: cs,
      candleStore: drawingCandleStore,
      rectangles: cloneDatasetItems(drawings.rectangles, datasetId),
      drawingMode,
      datasetId,
      callbacks: {
        onCreate: (rectangle) => callbacksRef.current.drawingActions.rectangles.onCreate(rectangle),
        onUpdate: (rectangle) => callbacksRef.current.drawingActions.rectangles.onUpdate(rectangle),
        onDelete: (id) => callbacksRef.current.drawingActions.rectangles.onDelete(id),
        onDrawingComplete: () => callbacksRef.current.onDrawingComplete(),
      },
    });
    const cleanupFibonacci = attachFibonacciTool({
      manager: drawingManager,
      container: ref.current!,
      chart,
      series: cs,
      candleStore: drawingCandleStore,
      fibonacciRetracements: cloneDatasetItems(drawings.fibonacciRetracements, datasetId),
      drawingMode,
      datasetId,
      pricePrecision,
      callbacks: {
        onCreate: (fibonacci) => callbacksRef.current.drawingActions.fibonacciRetracements.onCreate(fibonacci),
        onUpdate: (fibonacci) => callbacksRef.current.drawingActions.fibonacciRetracements.onUpdate(fibonacci),
        onDelete: (id) => callbacksRef.current.drawingActions.fibonacciRetracements.onDelete(id),
        onDrawingComplete: () => callbacksRef.current.onDrawingComplete(),
      },
    });
    const cleanupFibonacciTrendExtensions = attachFibonacciTrendExtensionTool({
      manager: drawingManager,
      container: ref.current!,
      chart,
      series: cs,
      candleStore: drawingCandleStore,
      fibonacciTrendExtensions: cloneDatasetItems(drawings.fibonacciTrendExtensions, datasetId),
      drawingMode,
      datasetId,
      pricePrecision,
      callbacks: {
        onCreate: (extension) => callbacksRef.current.drawingActions.fibonacciTrendExtensions.onCreate(extension),
        onUpdate: (extension) => callbacksRef.current.drawingActions.fibonacciTrendExtensions.onUpdate(extension),
        onDelete: (id) => callbacksRef.current.drawingActions.fibonacciTrendExtensions.onDelete(id),
        onDrawingComplete: () => callbacksRef.current.onDrawingComplete(),
      },
    });
    const cleanupParallelChannels = attachParallelChannelTool({
      manager: drawingManager,
      container: ref.current!,
      chart,
      series: cs,
      candleStore: drawingCandleStore,
      parallelChannels: cloneDatasetItems(drawings.parallelChannels, datasetId),
      drawingMode,
      datasetId,
      callbacks: {
        onCreate: (channel) => callbacksRef.current.drawingActions.parallelChannels.onCreate(channel),
        onUpdate: (channel) => callbacksRef.current.drawingActions.parallelChannels.onUpdate(channel),
        onDelete: (id) => callbacksRef.current.drawingActions.parallelChannels.onDelete(id),
        onDrawingComplete: () => callbacksRef.current.onDrawingComplete(),
      },
    });
    const cleanupVolumeProfile = attachVolumeProfileTool({
      manager: drawingManager,
      container: ref.current!,
      chart,
      series: cs,
      candleStore: drawingCandleStore,
      // Базовые свечи, если они на это окно есть, иначе отображаемые. Правый
      // край профиля всё равно обрезается по голове воспроизведения ниже, так
      // что заглянуть в будущее мелкий таймфрейм не даёт.
      getProfileCandles: (fromTime, toTime) => {
        const base = getBaseCandlesRef.current(fromTime, toTime);
        return base.length ? base : candleStore.candles;
      },
      getReplayEndTime: () => {
        const lastVisibleCandle = candleStore.candles.at(-1);
        if (!lastVisibleCandle) return null;
        if (candleInterval == null || candleInterval <= 0) return lastVisibleCandle.time;
        return lastVisibleCandle.time + candleInterval - 1;
      },
      volumeProfiles: cloneDatasetItems(drawings.volumeProfiles, datasetId),
      drawingMode,
      datasetId,
      callbacks: {
        onCreate: (vp) => callbacksRef.current.drawingActions.volumeProfiles.onCreate(vp),
        onUpdate: (vp) => callbacksRef.current.drawingActions.volumeProfiles.onUpdate(vp),
        onDelete: (id) => callbacksRef.current.drawingActions.volumeProfiles.onDelete(id),
        onDrawingComplete: () => callbacksRef.current.onDrawingComplete(),
      },
    });
    drawingManager.scheduleOverlaySync();
    if (deleteAllDrawingsRef) {
      deleteAllDrawingsRef.current = () => { drawingManager.deleteAllDrawings(); };
    }
    return () => {
      layoutObserver.disconnect();
      if (deleteAllDrawingsRef) deleteAllDrawingsRef.current = null;
      chartAlive = false;
      const range = chart.timeScale().getVisibleLogicalRange();
      // Если рамку выставляли мы и пользователь её не трогал — переносим дальше
      // именно её, а не то, что успел показать ещё не разложенный график.
      savedLogicalRange.current = pendingFocusRange.current ?? range;
      savedPriceRange.current = cs.priceScale().getVisibleRange();
      // Между сменой ТФ есть кадр, где новых свечей ещё нет и candleInterval === null.
      // Если дать ему затереть сохранённый интервал, сравнение timeframeChanged на
      // следующем прогоне потеряет базу, фокус не сработает и график прилипнет к
      // правому краю — переключение «вверх» вело себя иначе, чем «вниз».
      if (candleInterval != null) savedCandleInterval.current = candleInterval;
      if (pendingFocusRange.current) followRealtime.current = false;
      else if (range) followRealtime.current = Math.abs(range.to - (candleStore.candles.length - 1)) < 0.75;
      ref.current?.removeEventListener("pointerdown", startChartInteractionOverlayLoop, { capture: true });
      window.removeEventListener("pointerup", stopChartInteractionOverlayLoopNow);
      window.removeEventListener("pointercancel", stopChartInteractionOverlayLoopNow);
      window.removeEventListener("pointerup", persistVolumePaneStretch);
      ref.current?.removeEventListener("wheel", syncOverlaysDuringWheel, { capture: true });
      stopChartInteractionOverlayLoopNow();
      ref.current?.removeEventListener("pointerdown", markManualScale);
      ref.current?.removeEventListener("dblclick", resetManualScale);
      ref.current?.removeEventListener("wheel", zoomPriceScale, { capture: true });
      destroyTradeOverlays();
      cancelAnimationFrame(deferredTimeRangeFrame);
      chart.unsubscribeClick(selectStart);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange); } catch { }
      window.clearTimeout(earlierRequestTimer);
      ref.current?.removeEventListener("pointerdown", onEarlierPointerDown, { capture: true });
      window.removeEventListener("pointerup", onEarlierPointerUp);
      window.removeEventListener("pointercancel", onEarlierPointerUp);
      syncViewportState();
      cleanupTrendLines();
      cleanupHorizontalLines();
      cleanupMeasure();
      cleanupRectangles();
      cleanupFibonacci();
      cleanupFibonacciTrendExtensions();
      cleanupParallelChannels();
      cleanupVolumeProfile();
      drawingManagerRef.current = null;
      drawingManager.destroy();
      chart.remove();
      chartRuntimeRef.current = null;
      if (chartViewportRef) chartViewportRef.current = null;
    };
  }, [candleInterval, pricePrecision, datasetId, chartViewportRef]);

  // Прыжок (рандом/дата) не пересоздаёт график: иначе зажатый пан срывается,
  // а новый инстанс снова ставит стартовую рамку — «кидает обратно».
  // Сам прыжок рамку всё равно ставит: клик/пан не должен глотать новую ревизию.
  useEffect(() => {
    if (appliedFocusRevision.current === focusRevision) return;
    appliedFocusRevision.current = focusRevision;
    userMovedViewportRef.current = false;
    const runtime = chartRuntimeRef.current;
    const all = candlesRef.current;
    if (!runtime || !all.length) return;
    const safeIndex = Math.max(0, Math.min(indexRef.current, all.length - 1));
    const range = defaultFocusRange(safeIndex);
    pendingFocusRange.current = range;
    runtime.applyReplayIndex(indexRef.current, all, range);
  }, [focusRevision]);

  /**
   * Отмена и повтор подменяют коллекции целиком. Раньше это доезжало до
   * инструментов единственным способом — drawingRestoreRevision стоял в
   * зависимостях эффекта выше, и каждый Ctrl+Z пересоздавал график со всей
   * потерей положения. Теперь коллекции доносим напрямую, график не трогаем.
   */
  const appliedRestoreRef = useRef(drawingRestoreRevision);
  useLayoutEffect(() => {
    if (appliedRestoreRef.current === drawingRestoreRevision) return;
    appliedRestoreRef.current = drawingRestoreRevision;
    // Держим в курсе и счётчик главного эффекта. Он больше не пересоздаёт
    // график на отмене, но если оставить его отставать, то следующий его запуск
    // по другой причине — смена ТФ — счёл бы, что надо восстанавливать вьюпорт.
    appliedDrawingRestoreRevision.current = drawingRestoreRevision;
    const manager = drawingManagerRef.current;
    if (!manager) return;
    manager.replaceAll("trendline", cloneDatasetItems(drawings.trendLines, datasetId));
    manager.replaceAll("horizontalline", cloneDatasetItems(drawings.horizontalLines, datasetId));
    manager.replaceAll("rectangle", cloneDatasetItems(drawings.rectangles, datasetId));
    manager.replaceAll("fibonacci", cloneDatasetItems(drawings.fibonacciRetracements, datasetId));
    manager.replaceAll("fibtrendext", cloneDatasetItems(drawings.fibonacciTrendExtensions, datasetId));
    manager.replaceAll("parallelchannel", cloneDatasetItems(drawings.parallelChannels, datasetId));
    manager.replaceAll("volumeprofile", cloneDatasetItems(drawings.volumeProfiles, datasetId));
  }, [drawingRestoreRevision, drawings, datasetId]);

  /**
   * Доехало окно базовых свечей — просим пересинхронизировать оверлеи. Профиль
   * читает источник синхронно при отрисовке, поэтому на кадр создания он считался
   * по свечам экрана; кэш у него сбросится сам, как только на том же диапазоне
   * окажется другое число свечей.
   */
  useEffect(() => {
    chartRuntimeRef.current?.syncOverlays();
  }, [baseCandlesRevision]);

  const prevOverlayKeyRef = useRef("");
  useLayoutEffect(() => {
    // Compute a key from display-relevant fields only; ignores barrier.entryTime so
    // that every replay step does not trigger a full rebuild when TP/SL are unchanged.
    const barriersKey = barriers.map((b) => `${b.id}:${b.upper ?? ""}:${b.lower ?? ""}`).join("|");
    // size входит в ключ: метки TP/SL показывают сумму прибыли и убытка, а она
    // считается из размера. Без него смена риска меняла объём тикета, ключ
    // оставался прежним, и на метках висели суммы от прошлого размера.
    const tradesKey = trades.map((t) => `${t.id}:${t.status}:${t.entry}:${t.size}:${t.tp ?? ""}:${t.sl ?? ""}:${t.exitTime ?? ""}:${t.exit ?? ""}`).join("|");
    const key = [barriersKey, tradesKey, entryMarker?.price ?? "", markersEditable, showClosedTradeOverlays, showTradingSessions, showFairValueGaps].join(";");
    if (key === prevOverlayKeyRef.current) return;
    prevOverlayKeyRef.current = key;
    chartRuntimeRef.current?.rebuildTradeOverlays();
  }, [barriers, trades, entryMarker, markersEditable, showClosedTradeOverlays, showTradingSessions, showFairValueGaps]);

  useLayoutEffect(() => {
    chartRuntimeRef.current?.setDrawingsVisible(drawingsVisible);
  }, [drawingsVisible]);

  useLayoutEffect(() => {
    chartRuntimeRef.current?.setDrawingMode(drawingMode);
  }, [drawingMode]);

  // useEffect (not useLayoutEffect): layout-sync on every replay tick blocks paint
  // and pointer events at high speed, making the crosshair feel stuck to candle ticks.
  const prevAppliedCandlesRef = useRef(candles);
  const prevAppliedDatasetRef = useRef(datasetId);
  useEffect(() => {
    const indexChanged = prevReplayIndexRef.current !== index;
    const previous = prevAppliedCandlesRef.current;
    const candlesChanged = previous !== candles;
    // Смена монеты при том же индексе. Этот случай и оставлял на экране чужой
    // график: индекс не менялся, а проверка ниже выходила по разной длине
    // массивов — 558 684 свечи ETH против 239 895 у BTC, — и перерисовки не
    // происходило вовсе. Заголовок и счётчик успевали обновиться, свечи нет.
    const datasetChanged = prevAppliedDatasetRef.current !== datasetId;
    prevReplayIndexRef.current = index;
    prevAppliedCandlesRef.current = candles;
    // Идентификатор датасета меняется раньше, чем приезжают его свечи: между
    // этими рендерами candles ещё от прежнего рынка. Рисовать в этот момент —
    // значит показать чужие свечи под новым заголовком. И отмечать датасет
    // применённым тоже рано: следующий рендер счёл бы перерисовку ненужной, и
    // чужой график остался бы висеть насовсем. Ждём настоящие свечи.
    if (datasetChanged && !candlesChanged) return;
    prevAppliedDatasetRef.current = datasetId;
    if (datasetChanged || indexChanged) {
      // На смене монеты сохранять вьюпорт нечего: он от прежнего рынка.
      chartRuntimeRef.current?.applyReplayIndex(index, candles, null, !datasetChanged && selectingStartRef.current);
      return;
    }
    if (previous === candles) return;
    // Индекс тот же, массив другой. Нас интересует только один случай: собралась
    // незакрытая свеча, когда доехало 5м-окно, — состав тот же, изменились
    // значения последнего бара. Обновляем его точечно. Всё остальное (прыжок,
    // перезагрузка окна, догрузка истории) обрабатывают свои пути, и дёргать
    // тут applyReplayIndex нельзя: он трогает вьюпорт и на смене данных
    // зацикливался, из-за чего график непрерывно прыгал.
    const safeIndex = Math.min(index, candles.length - 1);
    const nextCandle = candles[safeIndex];
    if (!nextCandle || previous.length !== candles.length) return;
    if (previous[safeIndex]?.time !== nextCandle.time) return;
    chartRuntimeRef.current?.refreshLastCandle(nextCandle);
  }, [index, candles, datasetId]);

  useLayoutEffect(() => {
    if (!followCandle) {
      // Leaving follow mode: autoScale was forced on every step; lock the price
      // scale back to manual so vertical drag/pan works again immediately.
      chartRuntimeRef.current?.lockPriceScale();
      return;
    }
    chartRuntimeRef.current?.applyReplayIndex(index, candles);
  }, [followCandle]);
  return <div
    className={`chart ${selectingStart ? "selecting-replay-start" : ""}`}
    ref={ref}
    onPointerDownCapture={() => onInteractionChange(true)}
    onPointerUpCapture={() => onInteractionChange(false)}
    onPointerCancel={() => onInteractionChange(false)}
    onLostPointerCapture={() => onInteractionChange(false)}
  />;
}
