import { Button, Select } from "antd";
import { Globe2 } from "lucide-react";
import { ChartFocusIcon } from "./ChartFocusIcon";
import { TimeframePicker } from "./TimeframePicker";
import type { MarketDatasetOption } from "../features/datasets/useMarketCatalog";

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
}: PlayerToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbarMain">
      <Select
        value={datasetId || undefined}
        placeholder="Выберите историю"
        loading={datasetsLoading}
        onChange={onDatasetChange}
        labelRender={({ value }) => (
          datasetOptions.find((option) => option.id === value)?.symbol ?? String(value ?? "")
        )}
        optionRender={(option) => {
          const item = datasetOptions.find((entry) => entry.id === option.value);
          return (
            <span className="marketOption">
              <b>{item?.symbol ?? option.label}</b>
              {item?.rangeLabel ? <i>{item.rangeLabel}</i> : null}
            </span>
          );
        }}
        options={datasetOptions.map((option) => ({ value: option.id, label: option.label }))}
        popupClassName="marketSelectDropdown"
        popupMatchSelectWidth={false}
        style={{ minWidth: 128 }}
      />
      <TimeframePicker timeframe={timeframe} onTimeframeChange={onTimeframeChange} />
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
      </div>
      <div className="toolbarPriceScaleSlot">
        {onToggleChartFullscreen ? (
          <Button
            type="text"
            className={`drawing-tool-btn ${chartFullscreenActive ? "is-active" : ""}`}
            aria-label={chartFullscreenActive ? "Выйти из полноэкранного режима" : "На весь экран"}
            title={chartFullscreenActive ? "Выйти из полноэкранного режима · F11 / Esc" : "На весь экран · F11"}
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
