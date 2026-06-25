import { Button, Select } from "antd";
import { DrawingToolIcon } from "../drawing/icons/DrawingToolIcon";
import type { DrawingMode } from "../drawing";
import type { Dataset } from "../types";
import { formatTimeframe } from "../shared/lib/market";

const TIMEFRAMES = [5, 15, 30, 60, 180, 240, 1_440];

interface PlayerToolbarProps {
  datasets: Dataset[];
  datasetId: string;
  timeframe: number;
  drawingMode: DrawingMode;
  drawingsVisible: boolean;
  onDatasetChange: (datasetId: string) => void;
  onTimeframeChange: (timeframe: number) => void;
  onDrawingModeChange: (mode: DrawingMode) => void;
  onDrawingsVisibleChange: (visible: boolean) => void;
}

export function PlayerToolbar({
  datasets,
  datasetId,
  timeframe,
  drawingMode,
  drawingsVisible,
  onDatasetChange,
  onTimeframeChange,
  onDrawingModeChange,
  onDrawingsVisibleChange,
}: PlayerToolbarProps) {
  const toggleDrawingMode = (mode: DrawingMode) => {
    onDrawingModeChange(drawingMode === mode ? "none" : mode);
  };

  return (
    <div className="toolbar">
      <Select
        value={datasetId || undefined}
        placeholder="Выберите историю"
        onChange={onDatasetChange}
        options={datasets.map((dataset) => ({ value: dataset.id, label: dataset.name }))}
        style={{ width: 190 }}
      />
      <div className="tf">
        {TIMEFRAMES.map((value) => (
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
      <div className="drawing-tools">
        <Button type="text" className={`drawing-tool-btn ${drawingMode === "trendline" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("trendline")} title="Трендовая линия">
          <DrawingToolIcon mode="trendline" />
        </Button>
        <Button type="text" className={`drawing-tool-btn ${drawingMode === "fibonacci" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("fibonacci")} title="Фибоначчи Retracement">
          <DrawingToolIcon mode="fibonacci" />
        </Button>
        <Button type="text" className={`drawing-tool-btn ${drawingMode === "fibtrendext" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("fibtrendext")} title="Фибоначчи Trend-Based Extension">
          <DrawingToolIcon mode="fibtrendext" />
        </Button>
        <Button type="text" className={`drawing-tool-btn ${drawingMode === "parallelchannel" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("parallelchannel")} title="Параллельный канал">
          <DrawingToolIcon mode="parallelchannel" />
        </Button>
        <Button type="text" className={`drawing-tool-btn ${drawingMode === "rectangle" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("rectangle")} title="Прямоугольник">
          <DrawingToolIcon mode="rectangle" />
        </Button>
        <Button type="text" className={`drawing-tool-btn ${drawingMode === "measure" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("measure")} title="Линейка">
          <DrawingToolIcon mode="measure" />
        </Button>
        <Button
          type="text"
          className={`drawing-tool-btn ${drawingsVisible ? "" : "is-active"}`}
          onClick={() => onDrawingsVisibleChange(!drawingsVisible)}
          title={drawingsVisible ? "Скрыть рисунки" : "Показать рисунки"}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            {drawingsVisible ? (
              <>
                <path d="M1.5 9s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5S1.5 9 1.5 9z" stroke="currentColor" strokeWidth="1.4"/>
                <circle cx="9" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.4"/>
              </>
            ) : (
              <>
                <path d="M3 3l12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M1.5 9s2.8-5 7.5-5c1.6 0 3 .5 4.1 1.2M16.5 9s-2.8 5-7.5 5c-1.6 0-3-.5-4.1-1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </>
            )}
          </svg>
        </Button>
      </div>
    </div>
  );
}
