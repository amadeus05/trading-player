import { Button, Popconfirm } from "antd";
import { Redo2, Undo2 } from "lucide-react";
import { DrawingToolIcon } from "../drawing/icons/DrawingToolIcon";
import type { DrawingMode } from "../drawing";

interface DrawingToolsRailProps {
  drawingMode: DrawingMode;
  drawingsVisible: boolean;
  drawingCount: number;
  canUndoDrawings: boolean;
  canRedoDrawings: boolean;
  onDrawingModeChange: (mode: DrawingMode) => void;
  onDrawingsVisibleChange: (visible: boolean) => void;
  onUndoDrawings: () => void;
  onRedoDrawings: () => void;
  onDeleteAllDrawings: () => void;
}

export function DrawingToolsRail({
  drawingMode,
  drawingsVisible,
  drawingCount,
  canUndoDrawings,
  canRedoDrawings,
  onDrawingModeChange,
  onDrawingsVisibleChange,
  onUndoDrawings,
  onRedoDrawings,
  onDeleteAllDrawings,
}: DrawingToolsRailProps) {
  const toggleDrawingMode = (mode: DrawingMode) => {
    onDrawingModeChange(drawingMode === mode ? "none" : mode);
  };

  return (
    <div className="drawing-rail">
      <Button type="text" className={`drawing-tool-btn ${drawingMode === "trendline" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("trendline")} title="Трендовая линия">
        <DrawingToolIcon mode="trendline" />
      </Button>
      <Button type="text" className={`drawing-tool-btn ${drawingMode === "horizontalline" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("horizontalline")} title="Горизонтальная линия">
        <DrawingToolIcon mode="horizontalline" />
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
      <Button type="text" className={`drawing-tool-btn ${drawingMode === "volumeprofile" ? "is-active" : ""}`} onClick={() => toggleDrawingMode("volumeprofile")} title="Volume Profile (диапазон по двум кликам)">
        <DrawingToolIcon mode="volumeprofile" />
      </Button>
      <div className="drawing-rail-sep" />
      <Button
        type="text"
        className="drawing-tool-btn"
        disabled={!canUndoDrawings}
        icon={<Undo2 size={18} />}
        title="Undo drawing · Ctrl+Z"
        onClick={onUndoDrawings}
      />
      <Button
        type="text"
        className="drawing-tool-btn"
        disabled={!canRedoDrawings}
        icon={<Redo2 size={18} />}
        title="Redo drawing · Ctrl+Y / Ctrl+Shift+Z"
        onClick={onRedoDrawings}
      />
      <div className="drawing-rail-sep" />
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
      <Popconfirm
        title="Удалить все рисунки на графике?"
        okText="Удалить"
        cancelText="Отмена"
        okButtonProps={{ danger: true }}
        disabled={drawingCount === 0}
        onConfirm={onDeleteAllDrawings}
      >
        <Button
          type="text"
          className="drawing-tool-btn"
          disabled={drawingCount === 0}
          title={`Удалить все рисунки (${drawingCount}) · Ctrl+Shift+Delete`}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M4.5 5.5h9M7 5.5V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M6.5 5.5l.5 9a1 1 0 0 0 1 .9h2a1 1 0 0 0 1-.9l.5-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Button>
      </Popconfirm>
    </div>
  );
}
