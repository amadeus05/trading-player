import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchMarketCatalog,
  marketDatasetId,
  marketDatasetName,
  type MarketCatalogItem,
} from "../../shared/api/marketDataApi";
import { formatMarketDate } from "../../shared/lib/market";

export type MarketDatasetOption = {
  id: string;
  symbol: string;
  category: string;
  from: number;
  to: number;
  /** Число базовых 5м-свечей в датасете — из него считается объём любого ТФ. */
  baseCandles: number;
  name: string;
  label: string;
  rangeLabel: string;
};

function buildDatasetOptions(catalog: MarketCatalogItem[]): MarketDatasetOption[] {
  return catalog.map((item) => ({
    id: marketDatasetId(item.category, item.symbol),
    symbol: item.symbol,
    category: item.category,
    from: item.from,
    to: item.to,
    baseCandles: item.candles,
    name: marketDatasetName(item.category, item.symbol),
    rangeLabel: `${formatMarketDate(item.from)} — ${formatMarketDate(item.to - 1)}`,
    label: `${item.symbol} · ${formatMarketDate(item.from)} — ${formatMarketDate(item.to - 1)}`,
  }));
}

export function useMarketCatalog() {
  const [catalog, setCatalog] = useState<MarketCatalogItem[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCatalog(await fetchMarketCatalog());
    } catch {
      setCatalog([]);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const datasetOptions = useMemo(() => buildDatasetOptions(catalog), [catalog]);

  return { catalog, datasetOptions, ready, refresh };
}
