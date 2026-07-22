import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Candle } from "../../types";
import { DEFAULT_TIMEFRAME_MINUTES } from "../../shared/config/simulation";
import { aggregateCandles, inferCandleTimeframeMinutes } from "../../shared/lib/market";

interface UseReplayControllerOptions {
  rawCandles: Candle[];
  interactionActiveRef: RefObject<boolean>;
  initialTimeframe?: number;
}

interface AggregationCache {
  rawCandles: Candle[];
  candlesByTimeframe: Map<number, Candle[]>;
}

export function useReplayController({
  rawCandles,
  interactionActiveRef,
  initialTimeframe = DEFAULT_TIMEFRAME_MINUTES,
}: UseReplayControllerOptions) {
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [index, setIndex] = useState(120);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectingStart, setSelectingStart] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [focusRevision, setFocusRevision] = useState(0);
  const aggregationCacheRef = useRef<AggregationCache | null>(null);

  useEffect(() => {
    setTimeframe(initialTimeframe);
  }, [initialTimeframe]);

  const getAggregatedCandles = useCallback((targetTimeframe: number): Candle[] => {
    let cache = aggregationCacheRef.current;
    if (!cache || cache.rawCandles !== rawCandles) {
      const sourceTimeframe = inferCandleTimeframeMinutes(rawCandles);
      cache = {
        rawCandles,
        candlesByTimeframe: new Map([[sourceTimeframe, rawCandles]]),
      };
      aggregationCacheRef.current = cache;
    }

    const cached = cache.candlesByTimeframe.get(targetTimeframe);
    if (cached) return cached;

    const aggregated = aggregateCandles(rawCandles, targetTimeframe);
    cache.candlesByTimeframe.set(targetTimeframe, aggregated);
    return aggregated;
  }, [rawCandles]);

  const candles = useMemo(
    () => getAggregatedCandles(timeframe),
    [getAggregatedCandles, timeframe],
  );
  const lastIndex = Math.max(0, candles.length - 1);
  const replayIndex = Math.max(0, Math.min(Number.isFinite(index) ? index : 0, lastIndex));
  const currentCandle = candles[replayIndex];

  useEffect(() => {
    setIndex((current) => Math.max(0, Math.min(current, candles.length - 1)));
  }, [candles.length]);

  useEffect(() => {
    if (!playing) return;
    const intervalMs = Math.max(80, 800 / speed);
    let cancelled = false;
    let rafId = 0;
    let lastTickAt = performance.now();

    const loop = (now: number) => {
      if (cancelled) return;
      rafId = window.requestAnimationFrame(loop);
      if (now - lastTickAt < intervalMs) return;
      // Drop backlog instead of stacking setState — keeps the main thread responsive
      // when a previous candle render/overlays still occupy the frame budget.
      lastTickAt = now;
      if (interactionActiveRef.current) return;
      // Low-priority update so pointer/crosshair input wins over candle ticks.
      startTransition(() => {
        setIndex((current) => {
          if (current >= lastIndex) {
            setPlaying(false);
            return lastIndex;
          }
          return current + 1;
        });
      });
    };

    rafId = window.requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [interactionActiveRef, lastIndex, playing, speed]);

  const changeTimeframe = (nextTimeframe: number, anchorTime = currentCandle?.time) => {
    const nextCandles = getAggregatedCandles(nextTimeframe);
    let nextIndex = 0;
    if (anchorTime != null) {
      for (let candidate = 0; candidate < nextCandles.length; candidate += 1) {
        if (nextCandles[candidate].time > anchorTime) break;
        nextIndex = candidate;
      }
    }
    setTimeframe(nextTimeframe);
    setIndex(nextIndex);
    setFocusRevision((current) => current + 1);
  };

  const selectIndex = (nextIndex: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(nextIndex, lastIndex)));
    setSelectingStart(false);
    setFocusRevision((current) => current + 1);
  };

  const selectTime = (time: number) => {
    const foundIndex = candles.findIndex((candle) => candle.time >= time);
    selectIndex(foundIndex === -1 ? lastIndex : foundIndex);
  };

  const handleStartAction = (key: string) => {
    setPlaying(false);
    if (key === "bar") setSelectingStart(true);
    if (key === "date") setDatePickerOpen(true);
    if (key === "first") selectIndex(0);
    if (key === "random") selectIndex(Math.floor(Math.random() * Math.max(1, lastIndex)));
  };

  const step = () => setIndex((current) => Math.min(current + 1, lastIndex));
  const reset = () => {
    setPlaying(false);
    setIndex(Math.min(120, lastIndex));
  };

  return {
    candles,
    currentCandle,
    datePickerOpen,
    focusRevision,
    lastIndex,
    playing,
    replayIndex,
    selectingStart,
    speed,
    timeframe,
    changeTimeframe,
    handleStartAction,
    reset,
    selectTime,
    setDatePickerOpen,
    setIndex,
    setPlaying,
    setSpeed,
    step,
  };
}
