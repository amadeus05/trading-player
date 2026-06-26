import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { Candle } from "../../types";
import {
  fetchMarketCandles,
  parseMarketDatasetId,
  type MarketCatalogItem,
} from "../../shared/api/marketDataApi";
import {
  buildInitialMarketCandleRange,
  buildNextMarketCandleRange,
} from "./marketCandleRanges";

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
) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const parsedDataset = useMemo(() => parseMarketDatasetId(datasetId), [datasetId]);
  const catalogItem = useMemo(() => {
    if (!parsedDataset) return null;
    return catalog.find(
      (entry) => entry.category === parsedDataset.category && entry.symbol === parsedDataset.symbol,
    ) ?? null;
  }, [catalog, parsedDataset]);
  const hasMore = useMemo(() => {
    if (!catalogItem || !candles.length) return false;
    return (candles.at(-1)!.time * 1_000) + 5 * 60 * 1_000 < catalogItem.to;
  }, [candles, catalogItem]);

  useEffect(() => {
    if (!datasetId) {
      setLoading(false);
      setLoadingMore(false);
      setCandles([]);
      return;
    }

    const cached = cacheRef.current?.get(datasetId);
    if (cached) {
      setLoading(false);
      setLoadingMore(false);
      setCandles(cached);
      return;
    }

    if (!parsedDataset) {
      setLoading(false);
      setLoadingMore(false);
      setCandles([]);
      return;
    }

    if (!catalogItem) {
      setLoading(false);
      setLoadingMore(false);
      setCandles([]);
      return;
    }

    const range = buildInitialMarketCandleRange(catalogItem);
    if (!range) {
      setLoading(false);
      setLoadingMore(false);
      setCandles([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadingMore(false);
    void fetchMarketCandles(parsedDataset.category, parsedDataset.symbol, range.from, range.to)
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
  }, [cacheRef, catalogItem, datasetId, parsedDataset]);

  const loadMore = useCallback(async () => {
    if (!datasetId || !parsedDataset || !catalogItem || loading || loadingMore) return;
    const range = buildNextMarketCandleRange(catalogItem, candles);
    if (!range) return;
    setLoadingMore(true);
    try {
      const rows = await fetchMarketCandles(parsedDataset.category, parsedDataset.symbol, range.from, range.to);
      setCandles((current) => {
        const merged = mergeCandles(current, rows);
        cacheRef.current?.set(datasetId, merged);
        return merged;
      });
    } catch {
      // Keep the currently loaded window usable; the next prefetch can retry.
    } finally {
      setLoadingMore(false);
    }
  }, [cacheRef, candles, catalogItem, datasetId, loading, loadingMore, parsedDataset]);

  return { candles, loading, loadingMore, hasMore, loadMore };
}
