import { useEffect, useLayoutEffect, useRef } from "react";
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
  DrawingManager,
  type DrawingMode,
} from "../../drawing";
import { logicalToTime } from "../../drawing/shared/coordinates";
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
  markersEditable: boolean;
  drawings: DrawingCollections;
  drawingActions: DrawingActions;
  drawingMode: DrawingMode;
  datasetId: string;
  onDrawingComplete: () => void;
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
  markersEditable,
  drawings,
  drawingActions,
  drawingMode,
  datasetId,
  onDrawingComplete,
}: ReplayChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const selectedTrendLineId = useRef<string | null>(null);
  const savedLogicalRange = useRef<LogicalRange | null>(null);
  const savedTimeRange = useRef<{ from: number; to: number } | null>(null);
  const savedCandleInterval = useRef<number | null>(null);
  const renderedIndex = useRef<number | null>(null);
  const followRealtime = useRef(true);
  const savedPriceRange = useRef<{ from: number; to: number } | null>(null);
  const manualPriceScale = useRef(false);
  const appliedFocusRevision = useRef(focusRevision);
  const chartRuntimeRef = useRef<{
    applyReplayIndex: (nextIndex: number, allCandles: Candle[]) => void;
    syncOverlays: () => void;
  } | null>(null);
  const prevReplayIndexRef = useRef(index);
  const previousDrawingModeRef = useRef(drawingMode);
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
  useEffect(() => {
    if (!ref.current || !candles.length) return;
    const safeIndex = Math.max(0, Math.min(index, candles.length - 1));
    const visible = candles.slice(0, safeIndex + 1);
    const candleInterval = candles.length > 1 ? candles[1].time - candles[0].time : null;
    const timeframeChanged = savedCandleInterval.current != null
      && candleInterval != null
      && savedCandleInterval.current !== candleInterval;
    const drawingModeChanged = previousDrawingModeRef.current !== drawingMode;
    const viewportBeforeModeChange = drawingModeChanged ? savedLogicalRange.current : null;
    const forceFocus = appliedFocusRevision.current !== focusRevision;
    if (forceFocus) {
      manualPriceScale.current = false;
      savedPriceRange.current = null;
    }
    if (!visible.length) return;
    const candleStore = { candles: visible as Candle[] };
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
    const drawingManager = new DrawingManager(ref.current);
    drawingManager.setMode(drawingMode);
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: "#2bd9a8",
      downColor: "#ff5c73",
      wickUpColor: "#2bd9a8",
      wickDownColor: "#ff5c73",
      borderVisible: false,
      priceFormat: { type: "price", precision: pricePrecision, minMove: 10 ** -pricePrecision },
    });
    cs.setData(candleStore.candles.map(toCandlestickData));
    if (manualPriceScale.current && savedPriceRange.current) {
      cs.priceScale().setVisibleRange(savedPriceRange.current);
    }
    const vs = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    vs.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vs.setData(candleStore.candles.map(toVolumeData));
    let replayUpdateInProgress = false;
    const applyReplayIndex = (
      nextIndex: number,
      allCandles: Candle[],
      forcedRange: LogicalRange | null = null,
    ) => {
      if (!allCandles.length) return;
      const nextSafeIndex = Math.max(0, Math.min(nextIndex, allCandles.length - 1));
      const nextVisible = allCandles.slice(0, nextSafeIndex + 1);
      const shouldFollowRealtime = followRealtime.current;
      const preservedRange = forcedRange ?? (shouldFollowRealtime
        ? null
        : savedLogicalRange.current ?? chart.timeScale().getVisibleLogicalRange());
      const previousVisible = candleStore.candles;
      const delta = renderedIndex.current == null ? 0 : nextSafeIndex - renderedIndex.current;
      const canAppendOneBar = delta === 1
        && nextVisible.length === previousVisible.length + 1
        && previousVisible.length > 0
        && nextVisible[previousVisible.length - 1].time === previousVisible[previousVisible.length - 1].time;

      replayUpdateInProgress = true;
      try {
        candleStore.candles = nextVisible;
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
        } else if (shouldFollowRealtime) {
          chart.timeScale().scrollToRealTime();
        }

        savedLogicalRange.current = chart.timeScale().getVisibleLogicalRange() ?? preservedRange;
        followRealtime.current = shouldFollowRealtime;
        renderedIndex.current = nextIndex;
        drawingManager.syncOverlays();
      } finally {
        replayUpdateInProgress = false;
      }
    };
    const syncViewportState = () => {
      if (replayUpdateInProgress) return;
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      savedLogicalRange.current = range;
      followRealtime.current = Math.abs(range.to - (candleStore.candles.length - 1)) < 0.75;
    };
    const onVisibleRangeChange = () => {
      syncViewportState();
      if (!replayUpdateInProgress) drawingManager.scheduleOverlaySync();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);
    syncViewportState();
    const closedTradeOverlay = attachClosedTradeOverlay({
      container: ref.current,
      chart,
      series: cs,
      candleStore,
      trades,
      visible: showClosedTradeOverlays,
    });
    const priceMarkers = attachPriceMarkers({
      container: ref.current,
      series: cs,
      barriers,
      trades,
      entryMarker,
      editable: markersEditable,
      pricePrecision,
      onBarrierChange: (id, kind, price) =>
        callbacksRef.current.onBarrierChange(id, kind, price),
      onEntryMarkerChange: (id, price) =>
        callbacksRef.current.onEntryMarkerChange(id, price),
      onFrame: closedTradeOverlay.sync,
    });
    const unregisterClosedTradeSync = drawingManager.registerOverlaySync(closedTradeOverlay.sync);
    const unregisterPriceMarkerSync = drawingManager.registerOverlaySync(priceMarkers.sync);
    const selectStart = (event: MouseEventParams<Time>) => {
      if (selectingStart && typeof event.time === "number") callbacksRef.current.onStartSelected(Number(event.time));
    };
    if (selectingStart) chart.subscribeClick(selectStart);
    let deferredTimeRangeFrame = 0;
    if (timeframeChanged) {
      // Keep a stable bar density across timeframes. The replay candle stays
      // near the right side while sparse higher timeframes receive whitespace
      // instead of stretching a handful of candles across the whole chart.
      const nextRange = { from: safeIndex - 80, to: safeIndex + 20 };
      chart.timeScale().setVisibleLogicalRange(nextRange);
      deferredTimeRangeFrame = requestAnimationFrame(() => {
        chart.timeScale().setVisibleLogicalRange(nextRange);
      });
    } else if (forceFocus) {
      const timeSpan = savedTimeRange.current
        ? Math.max(60, savedTimeRange.current.to - savedTimeRange.current.from)
        : Math.max(60, candleStore.candles[Math.max(0, safeIndex - 100)]
          ? candleStore.candles[safeIndex].time - candleStore.candles[Math.max(0, safeIndex - 100)].time
          : 100 * 60);
      const centerTime = candleStore.candles[safeIndex].time;
      chart.timeScale().setVisibleRange({
        from: (centerTime - timeSpan / 2) as UTCTimestamp,
        to: (centerTime + timeSpan / 2) as UTCTimestamp,
      });
      renderedIndex.current = index;
    } else {
      applyReplayIndex(index, candles, viewportBeforeModeChange);
    }
    appliedFocusRevision.current = focusRevision;
    previousDrawingModeRef.current = drawingMode;
    if (timeframeChanged) renderedIndex.current = index;
    const priceScaleWidth = Math.max(70, chart.priceScale("right").width());
    let chartAlive = true;
    const markManualScale = (event: PointerEvent) => {
      const element = ref.current; if (!element) return;
      const bounds = element.getBoundingClientRect();
      if (event.clientX - bounds.left >= bounds.width - priceScaleWidth - 4) manualPriceScale.current = true;
    };
    const resetManualScale = (event: MouseEvent) => {
      const element = ref.current; if (!element) return;
      const bounds = element.getBoundingClientRect();
      if (event.clientX - bounds.left >= bounds.width - priceScaleWidth - 4) { manualPriceScale.current = false; savedPriceRange.current = null }
    };
    const zoomPriceScale = (event: WheelEvent) => {
      if (!chartAlive) return;
      const element = ref.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      if (event.clientX - bounds.left < bounds.width - priceScaleWidth - 4) return;
      const range = cs.priceScale().getVisibleRange();
      if (!range) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const factor = Math.min(1.35, Math.max(0.74, Math.exp(event.deltaY * 0.0015)));
      const center = (range.from + range.to) / 2;
      const half = ((range.to - range.from) * factor) / 2;
      const nextRange = { from: center - half, to: center + half };
      manualPriceScale.current = true;
      savedPriceRange.current = nextRange;
      cs.priceScale().setVisibleRange(nextRange);
    };
    ref.current.addEventListener("pointerdown", markManualScale);
    ref.current.addEventListener("dblclick", resetManualScale);
    ref.current.addEventListener("wheel", zoomPriceScale, { capture: true, passive: false     });
    chartRuntimeRef.current = {
      applyReplayIndex,
      syncOverlays: () => drawingManager.scheduleOverlaySync(),
    };
    prevReplayIndexRef.current = index;
    const cleanupTrendLines = attachTrendLineTool({
      manager: drawingManager,
      container: ref.current!,
      chart,
      series: cs,
      candleStore,
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
      candleStore,
      active: drawingMode === "measure",
      pricePrecision,
      onComplete: () => callbacksRef.current.onDrawingComplete(),
    });
    const cleanupRectangles = attachRectangleTool({
      manager: drawingManager,
      container: ref.current!,
      chart,
      series: cs,
      candleStore,
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
      candleStore,
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
      candleStore,
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
      candleStore,
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
    drawingManager.syncOverlays();
    return () => {
      chartAlive = false;
      const range = chart.timeScale().getVisibleLogicalRange();
      savedLogicalRange.current = range;
      if (range) {
        const from = logicalToTime(range.from, candleStore.candles);
        const to = logicalToTime(range.to, candleStore.candles);
        if (from != null && to != null) savedTimeRange.current = { from, to };
      }
      savedCandleInterval.current = candleInterval;
      if (range) followRealtime.current = Math.abs(range.to - (candleStore.candles.length - 1)) < 0.75;
      if (manualPriceScale.current) savedPriceRange.current = cs.priceScale().getVisibleRange();
      ref.current?.removeEventListener("pointerdown", markManualScale);
      ref.current?.removeEventListener("dblclick", resetManualScale);
      ref.current?.removeEventListener("wheel", zoomPriceScale, { capture: true });
      closedTradeOverlay.destroy();
      priceMarkers.cleanup();
      unregisterClosedTradeSync();
      unregisterPriceMarkerSync();
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
      drawingManager.destroy();
      chart.remove();
      chartRuntimeRef.current = null;
    };
  }, [candles, barriers, trades, selectingStart, focusRevision, pricePrecision, entryMarker, showClosedTradeOverlays, markersEditable, drawingMode, datasetId]);

  useLayoutEffect(() => {
    if (prevReplayIndexRef.current === index) return;
    prevReplayIndexRef.current = index;
    chartRuntimeRef.current?.applyReplayIndex(index, candles);
  }, [index, candles]);
  return <div
    className={`chart ${selectingStart ? "selecting-replay-start" : ""}`}
    ref={ref}
    onPointerDownCapture={() => onInteractionChange(true)}
    onPointerUpCapture={() => onInteractionChange(false)}
    onPointerCancel={() => onInteractionChange(false)}
    onLostPointerCapture={() => onInteractionChange(false)}
  />;
}
