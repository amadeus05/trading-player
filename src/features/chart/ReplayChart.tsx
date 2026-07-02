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
  attachMeasureTool,
  attachParallelChannelTool,
  attachRectangleTool,
  attachTrendLineTool,
  attachVolumeProfileTool,
  DrawingManager,
  type DrawingMode,
} from "../../drawing";
import { attachClosedTradeOverlay } from "./closedTradeOverlay";
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

interface PriceRange {
  from: number;
  to: number;
}

export type ChartViewportRef = {
  getVisiblePriceRange: () => PriceRange | null;
};

interface ReplayChartProps {
  candles: Candle[];
  rawCandles: Candle[];
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
  deleteAllDrawingsRef?: MutableRefObject<(() => void) | null>;
}

export function ReplayChart({
  candles,
  rawCandles,
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
  deleteAllDrawingsRef,
}: ReplayChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const rawCandlesRef = useRef(rawCandles);
  rawCandlesRef.current = rawCandles;
  const followCandleRef = useRef(followCandle);
  followCandleRef.current = followCandle;
  const selectedTrendLineId = useRef<string | null>(null);
  const savedLogicalRange = useRef<LogicalRange | null>(null);
  const savedPriceRange = useRef<PriceRange | null>(null);
  const savedCandleInterval = useRef<number | null>(null);
  const renderedIndex = useRef<number | null>(null);
  const followRealtime = useRef(true);
  const appliedFocusRevision = useRef(focusRevision);
  const appliedDrawingRestoreRevision = useRef(drawingRestoreRevision);
  const chartRuntimeRef = useRef<{
    applyReplayIndex: (nextIndex: number, allCandles: Candle[]) => void;
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
  });
  overlayPropsRef.current = {
    barriers,
    trades,
    entryMarker,
    markersEditable,
    showClosedTradeOverlays,
  };
  const prevReplayIndexRef = useRef(index);
  const callbacksRef = useRef({
    onBarrierChange,
    onStartSelected,
    onEntryMarkerChange,
    drawingActions,
    onDrawingComplete,
  });
  callbacksRef.current = {
    onBarrierChange,
    onStartSelected,
    onEntryMarkerChange,
    drawingActions,
    onDrawingComplete,
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
    let replayUpdateInProgress = false;
    const primePriceScaleInteraction = () => {
      const range = cs.priceScale().getVisibleRange();
      if (!range) return;
      cs.priceScale().applyOptions({ autoScale: false });
      cs.priceScale().setVisibleRange(range);
    };
    // Fits the price scale to whatever candles are on screen, like autoScale would,
    // but keeps autoScale itself off — lightweight-charts refuses to start a vertical
    // price-axis drag while autoScale is on, so toggling it on/off for follow mode
    // left dragging permanently stuck once follow mode was turned off.
    const fitPriceScaleToVisible = () => {
      const all = candleStore.candles;
      if (!all.length) return;
      const logicalRange = chart.timeScale().getVisibleLogicalRange();
      let candlesInView = all;
      if (logicalRange) {
        const from = Math.max(0, Math.floor(logicalRange.from));
        const to = Math.min(all.length - 1, Math.ceil(logicalRange.to));
        if (to >= from) candlesInView = all.slice(from, to + 1);
      }
      if (!candlesInView.length) return;
      const low = Math.min(...candlesInView.map((c) => c.low));
      const high = Math.max(...candlesInView.map((c) => c.high));
      if (!Number.isFinite(low) || !Number.isFinite(high)) return;
      const span = high - low;
      const padding = span > 0 ? span * 0.08 : Math.max(Math.abs(high) * 0.01, 1);
      cs.priceScale().applyOptions({ autoScale: false });
      cs.priceScale().setVisibleRange({ from: low - padding, to: high + padding });
    };
    const applyReplayIndex = (
      nextIndex: number,
      allCandles: Candle[],
      forcedRange: LogicalRange | null = null,
      preserveViewport = false,
    ) => {
      if (!allCandles.length) return;
      const nextSafeIndex = Math.max(0, Math.min(nextIndex, allCandles.length - 1));
      const nextVisible = allCandles.slice(0, nextSafeIndex + 1);
      const shouldFollowRealtime = followCandleRef.current || followRealtime.current;
      const previousVisible = candleStore.candles;
      const delta = renderedIndex.current == null ? 0 : nextSafeIndex - renderedIndex.current;
      const preservedRange = forcedRange
        ?? (preserveViewport
          ? savedLogicalRange.current ?? chart.timeScale().getVisibleLogicalRange()
          : shouldFollowRealtime
            ? null
            : savedLogicalRange.current ?? chart.timeScale().getVisibleLogicalRange());
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
        } else {
          cs.setData(nextVisible.map(toCandlestickData));
          vs.setData(nextVisible.map(toVolumeData));
        }

        if (preservedRange) {
          chart.timeScale().setVisibleLogicalRange(preservedRange);
        } else if (!preserveViewport && shouldFollowRealtime && nextVisible.length > 1) {
          // scrollToRealTime() is always animated, which keeps firing visible-range
          // change events for ~1s and starves the overlay sync (each event reschedules
          // it 2 frames out). scrollToPosition(0, false) reaches the same edge instantly.
          chart.timeScale().scrollToPosition(0, false);
        } else if (!preserveViewport) {
          chart.timeScale().setVisibleLogicalRange(defaultFocusRange(nextSafeIndex));
        }

        savedLogicalRange.current = chart.timeScale().getVisibleLogicalRange() ?? preservedRange;
        savedPriceRange.current = cs.priceScale().getVisibleRange();
        followRealtime.current = shouldFollowRealtime;
        renderedIndex.current = nextIndex;
        if (followCandleRef.current) {
          fitPriceScaleToVisible();
        } else if (!canAppendOneBar && !forcedRange) {
          primePriceScaleInteraction();
        }
        drawingManager.scheduleOverlaySync();
      } finally {
        replayUpdateInProgress = false;
      }
    };
    const syncViewportState = () => {
      if (replayUpdateInProgress) return;
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      savedLogicalRange.current = range;
      savedPriceRange.current = cs.priceScale().getVisibleRange();
      followRealtime.current = Math.abs(range.to - (candleStore.candles.length - 1)) < 0.75;
    };
    const onVisibleRangeChange = () => {
      syncViewportState();
      if (!replayUpdateInProgress) drawingManager.scheduleOverlaySync();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);
    if (!restoreDrawings) syncViewportState();
    let closedTradeOverlay: ReturnType<typeof attachClosedTradeOverlay> | null = null;
    let priceMarkers: ReturnType<typeof attachPriceMarkers> | null = null;
    let unregisterClosedTradeSync = () => {};
    let unregisterPriceMarkerSync = () => {};
    const destroyTradeOverlays = () => {
      unregisterClosedTradeSync();
      unregisterPriceMarkerSync();
      priceMarkers?.cleanup();
      closedTradeOverlay?.destroy();
      priceMarkers = null;
      closedTradeOverlay = null;
      unregisterClosedTradeSync = () => {};
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
        onFrame: closedTradeOverlay.sync,
      });
      unregisterClosedTradeSync = drawingManager.registerOverlaySync(closedTradeOverlay.sync);
      unregisterPriceMarkerSync = drawingManager.registerOverlaySync(priceMarkers.sync);
      // Sync both overlays immediately so they are positioned/hidden before the
      // browser paints, preventing a flash to the wrong position on rebuild.
      closedTradeOverlay.sync();
      priceMarkers.sync();
      drawingManager.scheduleOverlaySync();
    };
    rebuildTradeOverlays();
    const selectStart = (event: MouseEventParams<Time>) => {
      if (selectingStart && typeof event.time === "number") callbacksRef.current.onStartSelected(Number(event.time));
    };
    if (selectingStart) chart.subscribeClick(selectStart);
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
    applyReplayIndex(safeIndex, liveCandles, initialRange, restoreDrawings);
    if (timeframeChanged && initialRange) {
      deferredTimeRangeFrame = requestAnimationFrame(() => {
        chart.timeScale().setVisibleLogicalRange(initialRange!);
        primePriceScaleInteraction();
      });
    } else if (forceFocus) {
      deferredTimeRangeFrame = requestAnimationFrame(() => {
        primePriceScaleInteraction();
      });
    }
    appliedFocusRevision.current = focusRevision;
    appliedDrawingRestoreRevision.current = drawingRestoreRevision;
    const priceScaleWidth = Math.max(70, chart.priceScale("right").width());
    const timeScaleHeight = Math.max(28, chart.timeScale().height());
    let chartAlive = true;
    const markManualScale = (event: PointerEvent) => {
      const element = ref.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      if (event.clientX - bounds.left >= bounds.width - priceScaleWidth - 4) {
        primePriceScaleInteraction();
      }
    };
    const resetManualScale = (event: MouseEvent) => {
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
      trendLines: drawings.trendLines.filter((line) => line.datasetId === datasetId),
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
      rectangles: drawings.rectangles.filter((rectangle) => rectangle.datasetId === datasetId),
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
      fibonacciRetracements: drawings.fibonacciRetracements.filter((fibonacci) => fibonacci.datasetId === datasetId),
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
      fibonacciTrendExtensions: drawings.fibonacciTrendExtensions.filter((extension) => extension.datasetId === datasetId),
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
      parallelChannels: drawings.parallelChannels.filter((channel) => channel.datasetId === datasetId),
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
      getRawCandles: () => rawCandlesRef.current,
      getReplayEndTime: () => {
        const lastVisibleCandle = candleStore.candles.at(-1);
        if (!lastVisibleCandle) return null;
        if (candleInterval == null || candleInterval <= 0) return lastVisibleCandle.time;
        return lastVisibleCandle.time + candleInterval - 1;
      },
      volumeProfiles: drawings.volumeProfiles.filter((vp) => vp.datasetId === datasetId),
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
      if (deleteAllDrawingsRef) deleteAllDrawingsRef.current = null;
      chartAlive = false;
      const range = chart.timeScale().getVisibleLogicalRange();
      savedLogicalRange.current = range;
      savedPriceRange.current = cs.priceScale().getVisibleRange();
      savedCandleInterval.current = candleInterval;
      if (range) followRealtime.current = Math.abs(range.to - (candleStore.candles.length - 1)) < 0.75;
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
      if (selectingStart) chart.unsubscribeClick(selectStart);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange); } catch { }
      syncViewportState();
      cleanupTrendLines();
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
  }, [candleInterval, selectingStart, focusRevision, pricePrecision, datasetId, drawingRestoreRevision, chartViewportRef]);

  const prevOverlayKeyRef = useRef("");
  useLayoutEffect(() => {
    // Compute a key from display-relevant fields only; ignores barrier.entryTime so
    // that every replay step does not trigger a full rebuild when TP/SL are unchanged.
    const barriersKey = barriers.map((b) => `${b.id}:${b.upper ?? ""}:${b.lower ?? ""}`).join("|");
    const tradesKey = trades.map((t) => `${t.id}:${t.status}:${t.entry}:${t.tp ?? ""}:${t.sl ?? ""}:${t.exitTime ?? ""}:${t.exit ?? ""}`).join("|");
    const key = [barriersKey, tradesKey, entryMarker?.price ?? "", markersEditable, showClosedTradeOverlays].join(";");
    if (key === prevOverlayKeyRef.current) return;
    prevOverlayKeyRef.current = key;
    chartRuntimeRef.current?.rebuildTradeOverlays();
  }, [barriers, trades, entryMarker, markersEditable, showClosedTradeOverlays]);

  useLayoutEffect(() => {
    chartRuntimeRef.current?.setDrawingsVisible(drawingsVisible);
  }, [drawingsVisible]);

  useLayoutEffect(() => {
    chartRuntimeRef.current?.setDrawingMode(drawingMode);
  }, [drawingMode]);

  useLayoutEffect(() => {
    if (prevReplayIndexRef.current === index) return;
    prevReplayIndexRef.current = index;
    chartRuntimeRef.current?.applyReplayIndex(index, candles);
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
