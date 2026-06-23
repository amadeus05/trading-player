import { useMemo, useState } from "react";
import { Input } from "antd";
import { Pin, Search, Star } from "lucide-react";
import type { Candle } from "../../types";

type DatasetItem = { id: string; name: string; candles?: Candle[] };

const MAIN_TABS = ["Favorites", "Spot", "Alpha", "Perpetual", "Futures", "Options", "TradFi", "Pre-Market"];
const QUOTE_FILTERS = ["USDC", "USDT", "Inverse Perpetual"];

const COIN_COLORS = ["#3b82f6", "#8b5cf6", "#14b8a6", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899"];

function symbolFromName(name: string) {
  return name.split(/[·\s]/)[0].toUpperCase();
}

function formatPrice(value: number) {
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(5);
}

function formatVolume(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(0);
}

export function SymbolMarketPanel({
  datasets,
  value,
  search,
  onSearchChange,
  onSelect,
  autoFocus,
}: {
  datasets: DatasetItem[];
  value?: string;
  search: string;
  onSearchChange: (next: string) => void;
  onSelect: (id: string) => void;
  autoFocus?: boolean;
}) {
  const [mainTab, setMainTab] = useState("Perpetual");
  const [quoteFilter, setQuoteFilter] = useState("USDT");

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return datasets
      .map((item, index) => {
        const symbol = symbolFromName(item.name);
        const candles = item.candles ?? [];
        const last = candles[candles.length - 1];
        const prev = candles[Math.max(0, candles.length - 2)];
        const changePct = last && prev ? ((last.close - prev.close) / prev.close) * 100 : null;
        const volume = candles.slice(-24).reduce((sum, candle) => sum + (candle.volume ?? 0), 0);
        return {
          id: item.id,
          symbol,
          price: last?.close ?? null,
          changePct,
          volume: volume || null,
          color: COIN_COLORS[index % COIN_COLORS.length],
        };
      })
      .filter((row) => !query || row.symbol.toLowerCase().includes(query));
  }, [datasets, search]);

  return (
    <div className="symbolMarketPanel" onMouseDown={(event) => event.stopPropagation()}>
      <div className="symbolDropdownSearch">
        <div className="symbolDropdownSearchField">
          <Search size={14} strokeWidth={1.75} />
          <Input
            autoFocus={autoFocus}
            variant="borderless"
            value={search}
            placeholder=""
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
        <button type="button" className="symbolDropdownPin" aria-label="Pin">
          <Pin size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className="symbolMarketTabs">
        {MAIN_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={mainTab === tab ? "active" : undefined}
            onClick={() => setMainTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="symbolMarketFilters">
        {QUOTE_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className={quoteFilter === filter ? "active" : undefined}
            onClick={() => setQuoteFilter(filter)}
          >
            {filter}
          </button>
        ))}
      </div>

      <div className="symbolMarketHead">
        <span>Name</span>
        <span>Price</span>
        <span>24H %</span>
        <span>Volume</span>
      </div>

      <div className="symbolMarketList">
        {rows.length ? rows.map((row) => {
          const selected = row.id === value;
          const positive = row.changePct != null && row.changePct >= 0;
          return (
            <button
              key={row.id}
              type="button"
              className={`symbolMarketRow${selected ? " is-selected" : ""}`}
              onClick={() => onSelect(row.id)}
            >
              <span className="symbolMarketName">
                <Star size={13} strokeWidth={1.75} />
                <span className="symbolMarketCoin" style={{ background: row.color }}>
                  {row.symbol.slice(0, 1)}
                </span>
                <span className={`symbolMarketPair${selected ? " is-selected" : ""}`}>{row.symbol}</span>
                <span className="symbolMarketBadge">50%</span>
              </span>
              <span className="symbolMarketPrice">{row.price != null ? formatPrice(row.price) : "—"}</span>
              <span className={`symbolMarketChange${row.changePct == null ? "" : positive ? " up" : " down"}`}>
                {row.changePct == null ? "—" : `${positive ? "+" : ""}${row.changePct.toFixed(2)}%`}
              </span>
              <span className="symbolMarketVolume">{row.volume != null ? formatVolume(row.volume) : "—"}</span>
            </button>
          );
        }) : <div className="symbolMarketEmpty">Nothing found</div>}
      </div>
    </div>
  );
}
