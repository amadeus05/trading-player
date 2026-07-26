import { Button, Select } from "antd";
import { Activity, Globe2 } from "lucide-react";
import { ChartFocusIcon } from "./ChartFocusIcon";
import type { MarketDatasetOption } from "../features/datasets/useMarketCatalog";
import { formatTimeframe } from "../shared/lib/market";
import { TIMEFRAME_OPTIONS } from "../shared/config/simulation";

interface PlayerToolbarProps {
  datasetOptions: MarketDatasetOption[];
  datasetId: string;
  datasetsLoading?: boolean;
  timeframe: number;
  onDatasetChange: (datasetId: string) => void;
  onTimeframeChange: (timeframe: number) => void;
  chartFullscreenActive?: boolean;
  onToggleChartFullscreen?: () => void;
  tradingSessionsActive?: boolean;
  onToggleTradingSessions?: () => void;
  cciActive?: boolean;
  onToggleCci?: () => void;
}

export function PlayerToolbar({
  datasetOptions,
  datasetId,
  datasetsLoading = false,
  timeframe,
  onDatasetChange,
  onTimeframeChange,
  chartFullscreenActive = false,
  onToggleChartFullscreen,
  tradingSessionsActive = false,
  onToggleTradingSessions,
  cciActive = false,
  onToggleCci,
}: PlayerToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbarMain">
      <Select
        value={datasetId || undefined}
        placeholder="Выберите историю"
        loading={datasetsLoading}
        onChange={onDatasetChange}
        options={datasetOptions.map((option) => ({ value: option.id, label: option.label }))}
        style={{ width: 280 }}
      />
      <div className="tf">
        {TIMEFRAME_OPTIONS.map((value) => (
          <Button
            key={value}
            type="text"
            className={timeframe === value ? "is-active" : undefined}
            onClick={() => onTimeframeChange(value)}
          >
            {formatTimeframe(value)}
          </Button>
        ))}
      </div>
      {onToggleTradingSessions ? (
        <Button
          type="text"
          className={`drawing-tool-btn ${tradingSessionsActive ? "is-active" : ""}`}
          aria-label="Торговые сессии"
          aria-pressed={tradingSessionsActive}
          title={tradingSessionsActive ? "Скрыть торговые сессии" : "Показать торговые сессии (Сидней, Токио, Лондон, Нью-Йорк)"}
          onClick={onToggleTradingSessions}
        >
          <Globe2 size={18} />
        </Button>
      ) : null}
      {onToggleCci ? (
        <Button
          type="text"
          className={`drawing-tool-btn ${cciActive ? "is-active" : ""}`}
          aria-label="Индикатор CCI"
          aria-pressed={cciActive}
          title={cciActive ? "Скрыть CCI" : "Показать CCI (7) в отдельной панели"}
          onClick={onToggleCci}
        >
          <Activity size={18} />
        </Button>
      ) : null}
      </div>
      <div className="toolbarPriceScaleSlot">
        {onToggleChartFullscreen ? (
          <Button
            type="text"
            className={`drawing-tool-btn ${chartFullscreenActive ? "is-active" : ""}`}
            aria-label={chartFullscreenActive ? "Выйти из полноэкранного режима" : "График на весь экран"}
            title={chartFullscreenActive ? "Выйти из полноэкранного режима · F11 / Esc" : "График на весь экран · F11"}
            aria-pressed={chartFullscreenActive}
            onClick={onToggleChartFullscreen}
          >
            <ChartFocusIcon />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
