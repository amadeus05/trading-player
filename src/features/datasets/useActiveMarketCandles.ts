import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Candle } from "../../types";
import {
  fetchMarketCandles,
  parseMarketDatasetId,
  type MarketCatalogItem,
} from "../../shared/api/marketDataApi";
import {
  BASE_TIMEFRAME_MINUTES,
  buildInitialMarketCandleRange,
  buildIntrabarWindow,
  buildReplayStartMarketCandleRange,
  hasLoadedMarketCandleRange,
  initialMarketCandleLimitForTimeframe,
  MARKET_CANDLE_INTERVAL_MS,
} from "./marketCandleRanges";

/** Таймфрейм загруженного окна (мин) — определяем по интервалу свечей. */
const inferLoadedTimeframe = (candles: Candle[], fallback: number): number =>
  candles.length > 1 ? Math.max(1, Math.round((candles[1].time - candles[0].time) / 60)) : fallback;

const timeframeToMs = (timeframeMinutes: number) => Math.max(1, Math.round(timeframeMinutes)) * 60 * 1_000;

/** Перезапросить базовое окно, когда голова подошла к его правому краю. */
const INTRABAR_REFETCH_MARGIN_MS = 300 * MARKET_CANDLE_INTERVAL_MS;

const mergeCandles = (current: Candle[], incoming: Candle[]): Candle[] => {
  if (!current.length) return incoming;
  const byTime = new Map<number, Candle>();
  current.forEach((candle) => byTime.set(candle.time, candle));
  incoming.forEach((candle) => byTime.set(candle.time, candle));
  return [...byTime.values()].sort((left, right) => left.time - right.time);
};

export function useActiveMarketCandles(
  datasetId: string,
  catalog: MarketCatalogItem[],
  cacheRef: RefObject<Map<string, Candle[]>>,
  initialTimeframeMinutes = BASE_TIMEFRAME_MINUTES,
) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [intrabarCandles, setIntrabarCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const candlesRef = useRef<Candle[]>([]);
  const loadingMoreRef = useRef(false);
  const loadingEarlierRef = useRef(false);
  const intrabarLoadingRef = useRef(false);
  /** Диапазон, покрытый текущим базовым окном (мс). */
  const intrabarCoveredRef = useRef<{ datasetId: string; from: number; to: number } | null>(null);
  const parsedDataset = useMemo(() => parseMarketDatasetId(datasetId), [datasetId]);
  const catalogItem = useMemo(() => {
    if (!parsedDataset) return null;
    return catalog.find(
      (entry) => entry.category === parsedDataset.category && entry.symbol === parsedDataset.symbol,
    ) ?? null;
  }, [catalog, parsedDataset]);
  const hasMore = useMemo(() => {
    if (!catalogItem || !candles.length) return false;
    return (candles.at(-1)!.time * 1_000) + timeframeToMs(inferLoadedTimeframe(candles, initialTimeframeMinutes)) < catalogItem.to;
  }, [candles, catalogItem, initialTimeframeMinutes]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  useEffect(() => {
    if (!datasetId) {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      setCandles([]);
      return;
    }

    const cached = cacheRef.current?.get(datasetId);
    if (cached) {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      setCandles(cached);
      return;
    }

    if (!parsedDataset) {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      setCandles([]);
      return;
    }

    if (!catalogItem) {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      setCandles([]);
      return;
    }

    const range = buildInitialMarketCandleRange(
      catalogItem,
      initialMarketCandleLimitForTimeframe(initialTimeframeMinutes),
    );
    if (!range) {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      setCandles([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    intrabarCoveredRef.current = null;
    setIntrabarCandles([]);
    void fetchMarketCandles(parsedDataset.category, parsedDataset.symbol, range.from, range.to, initialTimeframeMinutes)
      .then((rows) => {
        if (cancelled) return;
        cacheRef.current?.set(datasetId, rows);
        setCandles(rows);
      })
      .catch(() => {
        if (!cancelled) setCandles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheRef, catalogItem, datasetId, initialTimeframeMinutes, parsedDataset]);

  const loadMore = useCallback(async () => {
    if (!datasetId || !parsedDataset || !catalogItem || loading || loadingMoreRef.current) return;
    const last = candlesRef.current.at(-1);
    if (!last) return;
    const tf = inferLoadedTimeframe(candlesRef.current, initialTimeframeMinutes);
    const tfMs = timeframeToMs(tf);
    const fromMs = last.time * 1_000 + tfMs;
    const toMs = Math.min(catalogItem.to, fromMs + 1_000 * tfMs);
    if (toMs <= fromMs) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const rows = await fetchMarketCandles(parsedDataset.category, parsedDataset.symbol, fromMs, toMs, tf);
      setCandles((current) => {
        const merged = mergeCandles(current, rows);
        cacheRef.current?.set(datasetId, merged);
        return merged;
      });
    } catch {
      // Keep the currently loaded window usable; the next prefetch can retry.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [cacheRef, catalogItem, datasetId, initialTimeframeMinutes, loading, parsedDataset]);

  /**
   * Ленивая догрузка влево — строго из того, что уже скачано.
   *
   * Раньше уход за левый край сам дозаказывал недостающее у биржи. Из-за этого
   * первая свеча не была первой: протянул график — история молча выросла влево,
   * и «начало» уезжало при каждом движении. Пока датасет качали с даты листинга,
   * это не всплывало (слева физически ничего не было), но на любом куске
   * истории граница поехала.
   *
   * Теперь левый край датасета — это то, что скачано, и сам он не двигается.
   * Нужна история глубже — она заказывается явно, через управление историей.
   *
   * Возвращает количество добавленных слева свечей.
   */
  const loadEarlier = useCallback(async (displayBarsCount: number): Promise<number> => {
    if (!datasetId || !parsedDataset || !catalogItem) return 0;
    if (loading || loadingMoreRef.current || loadingEarlierRef.current) return 0;
    const first = candlesRef.current[0];
    if (!first || displayBarsCount <= 0) return 0;

    const tf = inferLoadedTimeframe(candlesRef.current, initialTimeframeMinutes);
    const tfMs = timeframeToMs(tf);
    const toMs = first.time * 1_000; // эксклюзивно: первая уже загруженная свеча
    const fromMs = Math.max(catalogItem.from, toMs - displayBarsCount * tfMs);
    if (fromMs >= toMs) return 0;

    loadingEarlierRef.current = true;
    setLoadingEarlier(true);
    try {
      const rows = await fetchMarketCandles(parsedDataset.category, parsedDataset.symbol, fromMs, toMs, tf);
      const older = rows.filter((row) => row.time < first.time);
      if (!older.length) return 0;
      setCandles((current) => {
        const merged = mergeCandles(current, rows);
        cacheRef.current?.set(datasetId, merged);
        return merged;
      });
      return older.length;
    } catch {
      return 0;
    } finally {
      loadingEarlierRef.current = false;
      setLoadingEarlier(false);
    }
  }, [cacheRef, catalogItem, datasetId, initialTimeframeMinutes, loading, parsedDataset]);

  const loadAroundTime = useCallback(async (time: number, timeframeMinutes = BASE_TIMEFRAME_MINUTES): Promise<boolean> => {
    if (!datasetId || !parsedDataset || !catalogItem || loading) return false;
    const range = buildReplayStartMarketCandleRange(catalogItem, time * 1_000, timeframeMinutes);
    if (!range) return false;
    // Пропускаем перезагрузку, только если диапазон покрыт И текущее окно уже в
    // нужном разрешении: смена ТФ при том же времени всё равно требует рефетча.
    const loadedTf = inferLoadedTimeframe(candles, timeframeMinutes);
    if (loadedTf === timeframeMinutes && hasLoadedMarketCandleRange(candles, range)) return true;
    setLoading(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    intrabarCoveredRef.current = null;
    setIntrabarCandles([]);
    try {
      const rows = await fetchMarketCandles(parsedDataset.category, parsedDataset.symbol, range.from, range.to, timeframeMinutes);
      cacheRef.current?.set(datasetId, rows);
      setCandles(rows);
      return rows.length > 0;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, [cacheRef, candles, catalogItem, datasetId, loading, parsedDataset]);

  /**
   * Держит базовое окно вокруг времени воспроизведения — для intrabar-резолвера SL/TP.
   * Перезапрашивает, только когда голова подошла к правому краю загруженного окна.
   */
  const ensureIntrabarAround = useCallback(async (timeSeconds: number) => {
    if (!datasetId || !parsedDataset || !catalogItem || intrabarLoadingRef.current) return;
    const targetMs = timeSeconds * 1_000;
    const covered = intrabarCoveredRef.current;
    if (
      covered
      && covered.datasetId === datasetId
      && targetMs >= covered.from
      && targetMs < covered.to - INTRABAR_REFETCH_MARGIN_MS
    ) {
      return;
    }
    const tf = inferLoadedTimeframe(candlesRef.current, initialTimeframeMinutes);
    const range = buildIntrabarWindow(catalogItem, targetMs, tf);
    if (!range) return;
    intrabarLoadingRef.current = true;
    try {
      const rows = await fetchMarketCandles(parsedDataset.category, parsedDataset.symbol, range.from, range.to, BASE_TIMEFRAME_MINUTES);
      if (rows.length) {
        setIntrabarCandles(rows);
        intrabarCoveredRef.current = { datasetId, from: range.from, to: range.to };
      }
    } catch {
      // Резолвер уйдёт в fallback до следующей попытки.
    } finally {
      intrabarLoadingRef.current = false;
    }
  }, [catalogItem, datasetId, initialTimeframeMinutes, parsedDataset]);

  return { candles, intrabarCandles, loading, loadingMore, loadingEarlier, hasMore, loadMore, loadEarlier, loadAroundTime, ensureIntrabarAround };
}
