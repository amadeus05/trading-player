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
      </div>
    </div>
  );
}
