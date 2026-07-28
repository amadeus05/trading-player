import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import {
  CandlestickSeries,
  CrosshairMode,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type CandlestickData,
  type HistogramData,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
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
import { CCI_DEFAULTS, computeCci, computeLastCci, type IndicatorPoint } from "./computeCci";
import { computeDivergences, divergenceKey, type DivergenceKind } from "./computeDivergences";
import { attachSessionsOverlay } from "./sessionsOverlay";
import { attachPriceMarkers } from "./priceMarkers";
import type { DrawingActions, DrawingCollections } from "../drawings/useDrawingCollections";

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
  color: candle.close >= candle.open ? "#2bd9a855" : "#ff5c7355",
});

/** Stable bar width with whitespace — avoids stretching a single replay bar across the chart. */
const defaultFocusRange = (barIndex: number) => ({
  from: barIndex - 80,
  to: barIndex + 20,
} as LogicalRange);

const cloneDatasetItems = <Item extends { datasetId: string }>(items: Item[], datasetId: string): Item[] =>
  structuredClone(items.filter((item) => item.datasetId === datasetId));

interface PriceRange {
  from: number;
  to: number;
}

export type ChartViewportRef = {
  getVisiblePriceRange: () => PriceRange | null;
};

interface ReplayChartProps {
  candles: Candle[];
  index: number;
  barriers: Barrier[];
  trades: Trade[];
  onBarrierChange: (id: string, kind: "tp" | "sl", price: number) => void;
  selectingStart: boolean;
  onStartSelected: (time: number) => void;
  focusRevision: number;
  onInteractionChange: (active: boolean) => void;
  pricePrecision: number;
  entryMarker?: { id: string; price: number };
  onEntryMarkerChange: (id: string, price: number) => void;
  showClosedTradeOverlays: boolean;
  showTradingSessions: boolean;
  showCci: boolean;
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
  index,
  barriers,
  trades,
  onBarrierChange,
  selectingStart,
  onStartSelected,
  focusRevision,
  onInteractionChange,
  pricePrecision,
  entryMarker,
  onEntryMarkerChange,
  showClosedTradeOverlays,
  showTradingSessions,
  showCci,
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
  const renderedIndex = useRef<number | null>(null);
  const followRealtime = useRef(true);
  // Заведомо «непринятая» ревизия: на переключении ТФ вверх candles на кадр
  // пустеет, PlayerPage размонтирует график, и все ref'ы сбрасываются. Если
  // считать фокус уже применённым, свежий монтаж уходит в scrollToPosition и
  // липнет к правому краю — вниз окно ставилось, вверх нет. Требуем фокус и на
  // первом монтаже, чтобы рамка была одинаковой в обе стороны.
  const appliedFocusRevision = useRef(focusRevision - 1);
  const appliedDrawingRestoreRevision = useRef(drawingRestoreRevision);
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
  });
  overlayPropsRef.current = {
    barriers,
    trades,
    entryMarker,
    markersEditable,
    showClosedTradeOverlays,
    showTradingSessions,
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
    const forceFocus = appliedFocusRevision.current !== focusRevision;
    const restoreDrawings = appliedDrawingRestoreRevision.current !== drawingRestoreRevision;
    const restoreViewportRange = restoreDrawings ? savedLogicalRange.current : null;
    const restorePriceRange = restoreDrawings ? savedPriceRange.current : null;
    if (!visible.length) return;
    const candleStore = { candles: visible as Candle[] };
    const drawingCandleStore = { candles: liveCandles as Candle[] };
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { color: "#0d0f15" }, textColor: "#7f8494" },
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
    if (restorePriceRange) {
      cs.priceScale().applyOptions({ autoScale: false });
      cs.priceScale().setVisibleRange(restorePriceRange);
    }
    const vs = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    vs.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vs.setData(candleStore.candles.map(toVolumeData));
    // CCI живёт в отдельной панели: диапазон ±300 на ценовую шкалу не наложить.
    let cciSeries: ISeriesApi<"Line"> | null = null;
    let cciPaneApi: ReturnType<typeof chart.addPane> | null = null;
    let cciMarkers: ISeriesMarkersPluginApi<Time> | null = null;
    const divergenceLines = new Map<string, ISeriesApi<"Line">>();
    const DIVERGENCE_COLORS: Record<DivergenceKind, string> = { bull: "#2bd9a8", bear: "#ff5c73" };
    const cciPoint = (point: { time: number; value: number }): LineData<UTCTimestamp> => ({
      time: point.time as UTCTimestamp,
      value: point.value,
    });
    /**
     * Дивергенции пересобираются по ключу отрезка: за один шаг обычно добавляется
     * ноль или одна линия, а не перерисовывается весь набор.
     */
    const syncDivergences = (visible: Candle[], points: IndicatorPoint[]) => {
      if (!cciSeries || !cciPaneApi) return;
      const found = computeDivergences(visible, points);
      const liveKeys = new Set(found.map(divergenceKey));
      for (const [key, series] of divergenceLines) {
        if (liveKeys.has(key)) continue;
        chart.removeSeries(series);
        divergenceLines.delete(key);
      }
      for (const divergence of found) {
        const key = divergenceKey(divergence);
        if (divergenceLines.has(key)) continue;
        const line = cciPaneApi.addSeries(LineSeries, {
          color: DIVERGENCE_COLORS[divergence.kind],
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        line.setData([
          { time: divergence.fromTime as UTCTimestamp, value: divergence.fromValue },
          { time: divergence.toTime as UTCTimestamp, value: divergence.toValue },
        ]);
        divergenceLines.set(key, line);
      }
      // Метки должны идти по возрастанию времени и без дублей.
      const markers = [...found]
        .sort((left, right) => left.toTime - right.toTime)
        .filter((divergence, index, list) => index === 0 || list[index - 1].toTime !== divergence.toTime)
        .map((divergence) => ({
          time: divergence.toTime as UTCTimestamp,
          position: divergence.kind === "bull" ? ("belowBar" as const) : ("aboveBar" as const),
          color: DIVERGENCE_COLORS[divergence.kind],
          shape: "circle" as const,
          text: divergence.kind === "bull" ? "Bull" : "Bear",
        }));
      cciMarkers?.setMarkers(markers);
    };
    if (showCci) {
      const cciPane = chart.addPane();
      cciPaneApi = cciPane;
      cciSeries = cciPane.addSeries(LineSeries, {
        color: "#ffd600",
        lineWidth: 1,
        priceLineVisible: false,
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      });
      const band = (price: number, color: string) => cciSeries?.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: "",
      });
      band(CCI_DEFAULTS.upperBand, "#787b86");
      band(0, "#5d606b");
      band(CCI_DEFAULTS.lowerBand, "#787b86");
      const initialCci = computeCci(candleStore.candles, CCI_DEFAULTS.length);
      cciSeries.setData(initialCci.map(cciPoint));
      cciMarkers = createSeriesMarkers(cciSeries);
      syncDivergences(candleStore.candles, initialCci);
      // Пропорции задаём после того, как в панели появилась серия с данными:
      // на пустой панели размер не применяется.
      chart.panes()[0]?.setStretchFactor(3);
      cciPane.setStretchFactor(1);
    }
    let replayUpdateInProgress = false;
    let lastPriceFitAt = 0;
    let lastFittedLow = Number.NaN;
    let lastFittedHigh = Number.NaN;
    const primePriceScaleInteraction = () => {
      const range = cs.priceScale().getVisibleRange();
      // Проверять надо и содержимое, а не только сам объект: from/to бывают
      // пустыми, пока шкала не посчитана. Раньше autoScale успевал выключиться,
      // а setVisibleRange падал с "Value is null" — шкала оставалась запертой
      // без валидного диапазона, и график пропадал с экрана.
      if (range && Number.isFinite(range.from) && Number.isFinite(range.to) && range.from !== range.to) {
        cs.priceScale().applyOptions({ autoScale: false });
        cs.priceScale().setVisibleRange(range);
        return;
      }
      // Диапазона ещё нет — считаем его из самих свечей. Автомасштаб она тоже
      // выключает, так что перетаскивание шкалы не ломается.
      fitPriceScaleToVisible(true);
    };
    // Fits the price scale to whatever candles are on screen, like autoScale would,
    // but keeps autoScale itself off — lightweight-charts refuses to start a vertical
    // price-axis drag while autoScale is on, so toggling it on/off for follow mode
    // left dragging permanently stuck once follow mode was turned off.
    const fitPriceScaleToVisible = (force = false) => {
      const all = candleStore.candles;
      if (!all.length) return;
      const now = performance.now();
      // During rapid replay appends, refitting every tick starves pointer input.
      if (!force && now - lastPriceFitAt < 100) return;
      const logicalRange = chart.timeScale().getVisibleLogicalRange();
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
      // Обычное обновление (без навязанной рамки) — значит момент фокуса позади.
      // Снимаем флаг, иначе syncViewportState останется выключенным навсегда, а
      // savedLogicalRange застрянет на устаревшем значении: пишем один диапазон,
      // читаем предыдущий, и вьюпорт начинает дёргаться между двумя на каждом тике.
      if (forcedRange == null) pendingFocusRange.current = null;
      const nextSafeIndex = Math.max(0, Math.min(nextIndex, allCandles.length - 1));
      const nextVisible = allCandles.slice(0, nextSafeIndex + 1);
      const shouldFollowRealtime = followCandleRef.current || followRealtime.current;
      const previousVisible = candleStore.candles;
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
      let preservedRange = forcedRange
        ?? (preserveViewport
          ? savedLogicalRange.current ?? chart.timeScale().getVisibleLogicalRange()
          : shouldFollowRealtime
            ? null
            : savedLogicalRange.current ?? chart.timeScale().getVisibleLogicalRange());
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

      replayUpdateInProgress = true;
      try {
        candleStore.candles = nextVisible;
        drawingCandleStore.candles = allCandles;
        if (canAppendOneBar) {
          const appended = nextVisible[nextVisible.length - 1];
          cs.update(toCandlestickData(appended));
          vs.update(toVolumeData(appended));
          // Новый бар меняет только последнее значение CCI — считаем его одно.
          const lastCci = computeLastCci(nextVisible, CCI_DEFAULTS.length);
          if (lastCci && cciSeries) {
            cciSeries.update(cciPoint(lastCci));
            // Новый бар мог подтвердить пивот, а с ним и дивергенцию.
            syncDivergences(nextVisible, computeCci(nextVisible, CCI_DEFAULTS.length));
          }
        } else {
          cs.setData(nextVisible.map(toCandlestickData));
          vs.setData(nextVisible.map(toVolumeData));
          if (cciSeries) {
            const points = computeCci(nextVisible, CCI_DEFAULTS.length);
            cciSeries.setData(points.map(cciPoint));
            syncDivergences(nextVisible, points);
          }
        }

        // Запоминаем рамку, которую сами выставили. Читать её обратно через
        // getVisibleLogicalRange() сразу после записи нельзя: кадр ещё не прошёл
        // и возвращается предыдущее значение. Из-за этого savedLogicalRange
        // застревал на устаревшем диапазоне, и на следующем тике график
        // восстанавливал его — отсюда скачки масштаба и прижатие к правому краю.
        let appliedRange: LogicalRange | null = null;
        if (preservedRange) {
          chart.timeScale().setVisibleLogicalRange(preservedRange);
          appliedRange = preservedRange;
        } else if (!preserveViewport && shouldFollowRealtime && nextVisible.length > 1) {
          // scrollToRealTime() is always animated, which keeps firing visible-range
          // change events for ~1s and starves the overlay sync (each event reschedules
          // it 2 frames out). scrollToPosition(0, false) reaches the same edge instantly.
          chart.timeScale().scrollToPosition(0, false);
        } else if (!preserveViewport) {
          appliedRange = defaultFocusRange(nextSafeIndex);
          chart.timeScale().setVisibleLogicalRange(appliedRange);
        }

        // Ветка scrollToPosition своей рамки не задаёт — только там читаем факт.
        savedLogicalRange.current = appliedRange ?? chart.timeScale().getVisibleLogicalRange();
        savedPriceRange.current = cs.priceScale().getVisibleRange();
        followRealtime.current = shouldFollowRealtime;
        renderedIndex.current = nextIndex;
        if (followCandleRef.current) {
          fitPriceScaleToVisible(!canAppendOneBar);
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
      if (pendingFocusRange.current) return;
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
    let priceMarkers: ReturnType<typeof attachPriceMarkers> | null = null;
    let unregisterClosedTradeSync = () => {};
    let unregisterSessionsSync = () => {};
    let unregisterPriceMarkerSync = () => {};
    const destroyTradeOverlays = () => {
      unregisterClosedTradeSync();
      unregisterSessionsSync();
      unregisterPriceMarkerSync();
      priceMarkers?.cleanup();
      closedTradeOverlay?.destroy();
      sessionsOverlay?.destroy();
      priceMarkers = null;
      closedTradeOverlay = null;
      sessionsOverlay = null;
      unregisterClosedTradeSync = () => {};
      unregisterSessionsSync = () => {};
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
      priceMarkers = attachPriceMarkers({
        container: ref.current,
        series: cs,
        barriers: props.barriers,
        trades: props.trades,
        entryMarker: props.entryMarker,
        editable: props.markersEditable,
        pricePrecision,
        onBarrierChange: (id, kind, price) =>
          callbacksRef.current.onBarrierChange(id, kind, price),
        onEntryMarkerChange: (id, price) =>
          callbacksRef.current.onEntryMarkerChange(id, price),
        // closedTradeOverlay is registered on its own; avoid syncing it twice per frame.
        onFrame: () => {},
      });
      unregisterClosedTradeSync = drawingManager.registerOverlaySync(closedTradeOverlay.sync);
      unregisterSessionsSync = drawingManager.registerOverlaySync(sessionsOverlay.sync);
      unregisterPriceMarkerSync = drawingManager.registerOverlaySync(priceMarkers.sync);
      // Sync both overlays immediately so they are positioned/hidden before the
      // browser paints, preventing a flash to the wrong position on rebuild.
      closedTradeOverlay.sync();
      sessionsOverlay.sync();
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
      initialRange = defaultFocusRange(safeIndex);
      if (forceFocus) followRealtime.current = false;
    } else if (restoreDrawings) {
      initialRange = restoreViewportRange;
      followRealtime.current = false;
    }
    if (initialRange) pendingFocusRange.current = initialRange;
    applyReplayIndex(safeIndex, liveCandles, initialRange, restoreDrawings);
    // Переприменяем окно кадром позже при любом initialRange, а не только при
    // timeframeChanged: на свежем монтаже графика (переключение ТФ вверх)
    // setVisibleLogicalRange до раскладки layout не приживается, график
    // остаётся прижатым к правому краю, и следующий прогон это закрепляет.
    if (initialRange) {
      deferredTimeRangeFrame = requestAnimationFrame(() => {
        chart.timeScale().setVisibleLogicalRange(initialRange!);
        // Считаем ценовой диапазон по самим свечам, а не через
        // primePriceScaleInteraction: тот берёт текущий видимый диапазон, а после
        // прыжка автомасштаб пересчитаться ещё не успел — защёлкивался диапазон
        // от прошлой позиции, и график оказывался пустым в чужих ценах.
        fitPriceScaleToVisible(true);
        // Рамка применена на разложенном графике. Сохраняем именно её, а не
        // прочитанное значение, и снимаем флаг — дальше syncViewportState снова
        // следит за реальным диапазоном.
        savedLogicalRange.current = initialRange;
        pendingFocusRange.current = null;
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
    });
    if (ref.current) layoutObserver.observe(ref.current);
    const timeScaleHeight = Math.max(28, chart.timeScale().height());
    let chartAlive = true;
    // chartAlive обязателен: обработчик может пережить график, а обращение к
    // серии уничтоженного графика падает внутри библиотеки ("Value is null" из
    // getPane). Причём падало уже ПОСЛЕ выключения autoScale — шкала оставалась
    // запертой без диапазона. У zoomPriceScale такая защита была, у этих двух нет.
    const markManualScale = (event: PointerEvent) => {
      if (!chartAlive) return;
      const element = ref.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      if (event.clientX - bounds.left >= bounds.width - priceScaleWidth - 4) {
        primePriceScaleInteraction();
      }
    };
    const resetManualScale = (event: MouseEvent) => {
      if (!chartAlive) return;
      const element = ref.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      if (event.clientX - bounds.left >= bounds.width - priceScaleWidth - 4) {
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
      const onPriceScale = x >= plotRight;
      const withCtrl = event.ctrlKey || event.metaKey;
      if (!onPriceScale && !withCtrl) return;
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
      // Пользователь сам подвигал график — намерение по рамке больше не актуально.
      pendingFocusRange.current = null;
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
        const next = [...current.slice(0, -1), candle];
        candleStore.candles = next;
        cs.update(toCandlestickData(candle));
        vs.update(toVolumeData(candle));
        // Незакрытая свеча меняется — CCI последнего бара пересчитываем вместе с ней.
        const lastCci = computeLastCci(next, CCI_DEFAULTS.length);
        if (lastCci) cciSeries?.update(cciPoint(lastCci));
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
      getProfileCandles: () => candleStore.candles,
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
      drawingManager.destroy();
      chart.remove();
      chartRuntimeRef.current = null;
      if (chartViewportRef) chartViewportRef.current = null;
    };
    // showCci пересоздаёт график: панель добавляется и убирается вместе с ним.
    // Вьюпорт при этом сохраняется через savedLogicalRange, как при смене ТФ.
  }, [candleInterval, focusRevision, pricePrecision, datasetId, drawingRestoreRevision, chartViewportRef, showCci]);

  const prevOverlayKeyRef = useRef("");
  useLayoutEffect(() => {
    // Compute a key from display-relevant fields only; ignores barrier.entryTime so
    // that every replay step does not trigger a full rebuild when TP/SL are unchanged.
    const barriersKey = barriers.map((b) => `${b.id}:${b.upper ?? ""}:${b.lower ?? ""}`).join("|");
    const tradesKey = trades.map((t) => `${t.id}:${t.status}:${t.entry}:${t.tp ?? ""}:${t.sl ?? ""}:${t.exitTime ?? ""}:${t.exit ?? ""}`).join("|");
    const key = [barriersKey, tradesKey, entryMarker?.price ?? "", markersEditable, showClosedTradeOverlays, showTradingSessions].join(";");
    if (key === prevOverlayKeyRef.current) return;
    prevOverlayKeyRef.current = key;
    chartRuntimeRef.current?.rebuildTradeOverlays();
  }, [barriers, trades, entryMarker, markersEditable, showClosedTradeOverlays, showTradingSessions]);

  useLayoutEffect(() => {
    chartRuntimeRef.current?.setDrawingsVisible(drawingsVisible);
  }, [drawingsVisible]);

  useLayoutEffect(() => {
    chartRuntimeRef.current?.setDrawingMode(drawingMode);
  }, [drawingMode]);

  // useEffect (not useLayoutEffect): layout-sync on every replay tick blocks paint
  // and pointer events at high speed, making the crosshair feel stuck to candle ticks.
  const prevAppliedCandlesRef = useRef(candles);
  useEffect(() => {
    const indexChanged = prevReplayIndexRef.current !== index;
    const previous = prevAppliedCandlesRef.current;
    prevReplayIndexRef.current = index;
    prevAppliedCandlesRef.current = candles;
    if (indexChanged) {
      chartRuntimeRef.current?.applyReplayIndex(index, candles, null, selectingStartRef.current);
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
  }, [index, candles]);

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
