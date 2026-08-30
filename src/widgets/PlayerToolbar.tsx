import { Button, Select } from "antd";
import { BetweenHorizontalStart, Globe2 } from "lucide-react";
import { ChartFocusIcon } from "./ChartFocusIcon";
import { TimeframePicker } from "./TimeframePicker";
import { TimezonePicker } from "./TimezonePicker";
import type { MarketDatasetOption } from "../features/datasets/useMarketCatalog";
import type { TradingSessionsVariant } from "../types";

interface PlayerToolbarProps {
  datasetOptions: MarketDatasetOption[];
  datasetId: string;
  datasetsLoading?: boolean;
  timeframe: number;
  onDatasetChange: (datasetId: string) => void;
  onTimeframeChange: (timeframe: number) => void;
  chartTimeZone: string;
  onChartTimeZoneChange: (id: string) => void;
  chartTimeZoneCategory?: string;
  chartFullscreenActive?: boolean;
  onToggleChartFullscreen?: () => void;
  tradingSessionsVariant?: TradingSessionsVariant;
  onCycleTradingSessions?: () => void;
  fairValueGapsActive?: boolean;
  onToggleFairValueGaps?: () => void;
}

export function PlayerToolbar({
  datasetOptions,
  datasetId,
  datasetsLoading = false,
  timeframe,
  onDatasetChange,
  onTimeframeChange,
  chartTimeZone,
  onChartTimeZoneChange,
  chartTimeZoneCategory,
  chartFullscreenActive = false,
  onToggleChartFullscreen,
  tradingSessionsVariant = "off",
  onCycleTradingSessions,
  fairValueGapsActive = false,
  onToggleFairValueGaps,
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
      <TimezonePicker
        value={chartTimeZone}
        category={chartTimeZoneCategory}
        onChange={onChartTimeZoneChange}
      />
      {onCycleTradingSessions ? (
        <Button
          type="text"
          className={`drawing-tool-btn ${tradingSessionsVariant !== "off" ? "is-active" : ""}`}
          aria-label="Торговые сессии"
          aria-pressed={tradingSessionsVariant !== "off"}
          title={
            tradingSessionsVariant === "off"
              ? "Торговые сессии: выкл · клик — лента"
              : tradingSessionsVariant === "ribbon"
                ? "Сессии: лента · клик — коробки Tokyo / pre-London / London / NY"
                : "Сессии: коробки · клик — скрыть"
          }
          onClick={onCycleTradingSessions}
        >
          <Globe2 size={18} />
        </Button>
      ) : null}
      {onToggleFairValueGaps ? (
        <Button
          type="text"
          className={`drawing-tool-btn ${fairValueGapsActive ? "is-active" : ""}`}
          aria-label="Fair Value Gap"
          aria-pressed={fairValueGapsActive}
          title={fairValueGapsActive ? "Скрыть Fair Value Gap" : "Показать Fair Value Gap (до полного поглощения)"}
          onClick={onToggleFairValueGaps}
        >
          <BetweenHorizontalStart size={18} />
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
