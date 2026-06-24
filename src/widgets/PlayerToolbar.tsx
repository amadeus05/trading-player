import { Button, Select } from "antd";
import { RectangleHorizontal, Ruler, TrendingUp } from "lucide-react";
import type { DrawingMode } from "../drawing";
import type { Dataset } from "../types";
import { formatTimeframe } from "../shared/lib/market";

const TIMEFRAMES = [5, 15, 30, 60, 180, 240, 1_440];

interface PlayerToolbarProps {
  datasets: Dataset[];
  datasetId: string;
  timeframe: number;
  drawingMode: DrawingMode;
  onDatasetChange: (datasetId: string) => void;
  onTimeframeChange: (timeframe: number) => void;
  onDrawingModeChange: (mode: DrawingMode) => void;
}

export function PlayerToolbar({
  datasets,
  datasetId,
  timeframe,
  drawingMode,
  onDatasetChange,
  onTimeframeChange,
  onDrawingModeChange,
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
          <TrendingUp size={15} />
        </Button>
        <Button type="text" className={`drawing-tool-btn ${drawingMode === "rectangle" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("rectangle")} title="Прямоугольник">
          <RectangleHorizontal size={15} />
        </Button>
        <Button type="text" className={`drawing-tool-btn ${drawingMode === "measure" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("measure")} title="Линейка">
          <Ruler size={15} />
        </Button>
        <Button type="text" className={`drawing-tool-btn ${drawingMode === "fibonacci" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("fibonacci")} title="Фибоначчи Retracement">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <line x1="1" y1="13" x2="14" y2="13" stroke="currentColor" strokeWidth="1.2" />
            <line x1="1" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.7" />
            <line x1="1" y1="7" x2="14" y2="7" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.5" />
            <line x1="1" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.35" />
            <line x1="1" y1="1" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
          </svg>
        </Button>
        <Button type="text" className={`drawing-tool-btn ${drawingMode === "fibtrendext" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("fibtrendext")} title="Фибоначчи Trend-Based Extension">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <line x1="1" y1="13" x2="14" y2="13" stroke="currentColor" strokeWidth="1.2" />
            <line x1="1" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.7" />
            <line x1="1" y1="7" x2="14" y2="7" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.5" />
            <line x1="1" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.35" />
            <path d="M1 1 L5 7 L9 13" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" fill="none" />
          </svg>
        </Button>
        <Button type="text" className={`drawing-tool-btn ${drawingMode === "parallelchannel" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("parallelchannel")} title="Параллельный канал">
          <svg width="15" height="15" viewBox="0 0 28 28" fill="currentColor" aria-hidden="true">
            <path d="M8.354 18.354l10-10-.707-.707-10 10zM12.354 25.354l5-5-.707-.707-5 5z" />
            <path d="M20.354 17.354l5-5-.707-.707-5 5z" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
