import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Popconfirm } from "antd";
import { Redo2, Undo2 } from "lucide-react";
import { DrawingToolIcon } from "../drawing/icons/DrawingToolIcon";
import showDrawingsIcon from "../drawing/icons/ui/hide-all-drawings.svg?raw";
import hideDrawingsIcon from "../drawing/icons/ui/hide-all-drawings-off.svg?raw";
import removeDrawingIcon from "../drawing/icons/ui/remove-drawing.svg?raw";
import type { DrawingMode } from "../drawing";

type ToolMode = Exclude<DrawingMode, "none">;

interface ToolShortcut {
  /** Physical key code, e.g. "KeyT" — layout independent. */
  code: string;
  /** Human-readable hint shown in the flyout, e.g. "Alt + T". */
  label: string;
}

interface ToolDef {
  mode: ToolMode;
  label: string;
  shortcut?: ToolShortcut;
}

interface ToolGroup {
  id: string;
  label: string;
  tools: ToolDef[];
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    id: "lines",
    label: "Линии",
    tools: [
      { mode: "trendline", label: "Трендовая линия", shortcut: { code: "KeyT", label: "Alt + T" } },
      { mode: "horizontalline", label: "Горизонтальная линия", shortcut: { code: "KeyH", label: "Alt + H" } },
    ],
  },
  {
    id: "channels",
    label: "Каналы",
    tools: [{ mode: "parallelchannel", label: "Параллельный канал", shortcut: { code: "KeyP", label: "Alt + P" } }],
  },
  {
    id: "fibonacci",
    label: "Фибоначчи",
    tools: [
      { mode: "fibonacci", label: "Фибоначчи Retracement", shortcut: { code: "KeyF", label: "Alt + F" } },
      { mode: "fibtrendext", label: "Фибоначчи Trend-Based Extension", shortcut: { code: "KeyE", label: "Alt + E" } },
    ],
  },
  {
    id: "shapes",
    label: "Фигуры",
    tools: [{ mode: "rectangle", label: "Прямоугольник", shortcut: { code: "KeyR", label: "Alt + R" } }],
  },
  {
    id: "measure",
    label: "Измерение",
    tools: [
      { mode: "measure", label: "Линейка", shortcut: { code: "KeyM", label: "Alt + M" } },
      { mode: "volumeprofile", label: "Volume Profile (диапазон по двум кликам)", shortcut: { code: "KeyB", label: "Alt + B" } },
    ],
  },
];

/** Flat Alt-shortcut map (single source of truth for the keyboard handler). */
export const DRAWING_TOOL_SHORTCUTS: Array<{ mode: ToolMode; code: string }> = TOOL_GROUPS.flatMap(
  (group) => group.tools,
)
  .filter((tool): tool is ToolDef & { shortcut: ToolShortcut } => tool.shortcut != null)
  .map((tool) => ({ mode: tool.mode, code: tool.shortcut.code }));

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

interface ToolGroupButtonProps {
  group: ToolGroup;
  drawingMode: DrawingMode;
  activeTool: ToolMode;
  onSelect: (mode: ToolMode) => void;
}

function ToolGroupButton({ group, drawingMode, activeTool, onSelect }: ToolGroupButtonProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flyout, setFlyout] = useState<{ top: number; left: number } | null>(null);

  const groupActive = group.tools.some((tool) => tool.mode === drawingMode);
  const displayTool = groupActive
    ? (drawingMode as ToolMode)
    : activeTool;

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openFlyout = () => {
    clearCloseTimer();
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setFlyout({ top: rect.top, left: rect.right + 6 });
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setFlyout(null), 120);
  };

  useEffect(() => () => clearCloseTimer(), []);

  const toggleDisplayTool = () => {
    onSelect(displayTool);
  };

  return (
    <div
      ref={anchorRef}
      className="drawing-tool-group"
      onMouseEnter={openFlyout}
      onMouseLeave={scheduleClose}
    >
      <Button
        type="text"
        className={`drawing-tool-btn ${groupActive ? "is-active" : ""}`}
        onClick={toggleDisplayTool}
        title={group.label}
      >
        <DrawingToolIcon mode={displayTool} />
        <span className="drawing-tool-caret" aria-hidden="true" />
      </Button>
      {flyout &&
        createPortal(
          <div
            className="drawing-tool-flyout"
            style={{ top: flyout.top, left: flyout.left }}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
          >
            <div className="drawing-tool-flyout__title">{group.label}</div>
            {group.tools.map((tool) => (
              <button
                key={tool.mode}
                type="button"
                className={`drawing-tool-flyout__item ${
                  drawingMode === tool.mode ? "is-active" : ""
                }`}
                onClick={() => {
                  onSelect(tool.mode);
                  setFlyout(null);
                }}
              >
                <DrawingToolIcon mode={tool.mode} />
                <span className="drawing-tool-flyout__label">{tool.label}</span>
                {tool.shortcut && (
                  <span className="drawing-tool-flyout__shortcut">{tool.shortcut.label}</span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
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

  // Remember the last-used tool per multi-tool group so the rail button reflects it.
  const [lastUsed, setLastUsed] = useState<Record<string, ToolMode>>(() =>
    Object.fromEntries(TOOL_GROUPS.map((group) => [group.id, group.tools[0].mode])),
  );

  useEffect(() => {
    if (drawingMode === "none") return;
    const group = TOOL_GROUPS.find((g) => g.tools.some((t) => t.mode === drawingMode));
    if (group) setLastUsed((prev) => ({ ...prev, [group.id]: drawingMode as ToolMode }));
  }, [drawingMode]);

  return (
    <div className="drawing-rail">
      {TOOL_GROUPS.map((group) =>
        group.tools.length === 1 ? (
          <Button
            key={group.id}
            type="text"
            className={`drawing-tool-btn ${drawingMode === group.tools[0].mode ? "is-active" : ""}`}
            onClick={() => toggleDrawingMode(group.tools[0].mode)}
            title={group.tools[0].label}
          >
            <DrawingToolIcon mode={group.tools[0].mode} />
          </Button>
        ) : (
          <ToolGroupButton
            key={group.id}
            group={group}
            drawingMode={drawingMode}
            activeTool={lastUsed[group.id]}
            onSelect={toggleDrawingMode}
          />
        ),
      )}
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
        <span
          className="drawing-tool-icon"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: drawingsVisible ? showDrawingsIcon : hideDrawingsIcon }}
        />
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
          <span
            className="drawing-tool-icon"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: removeDrawingIcon }}
          />
        </Button>
      </Popconfirm>
    </div>
  );
}
