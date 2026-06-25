import { useEffect, useState, type RefObject } from "react";
import type { Candle } from "../../types";
import {
  fetchMarketCandles,
  parseMarketDatasetId,
  type MarketCatalogItem,
} from "../../shared/api/marketDataApi";

export function useActiveMarketCandles(
  datasetId: string,
  catalog: MarketCatalogItem[],
  cacheRef: RefObject<Map<string, Candle[]>>,
) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!datasetId) {
      setCandles([]);
      return;
    }

    const cached = cacheRef.current?.get(datasetId);
    if (cached) {
      setCandles(cached);
      return;
    }

    const parsed = parseMarketDatasetId(datasetId);
    if (!parsed) {
      setCandles([]);
      return;
    }

    const item = catalog.find(
      (entry) => entry.category === parsed.category && entry.symbol === parsed.symbol,
    );
    if (!item) {
      setCandles([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void fetchMarketCandles(parsed.category, parsed.symbol, item.from, item.to)
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
  }, [cacheRef, catalog, datasetId]);

  return { candles, loading };
}
