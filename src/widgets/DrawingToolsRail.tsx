import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "antd";
import { Redo2, Undo2 } from "lucide-react";
import { DrawingToolIcon } from "../drawing/icons/DrawingToolIcon";
import { useConfirmDelete } from "../shared/ui/useConfirmDelete";
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
  const [flyout, setFlyout] = useState<{ top: number; left: number } | null>(null);
  /** Кнопка «в фокусе» — уже выбрана кликом; со второго клика начинает открывать меню. */
  const [focused, setFocused] = useState(false);

  const groupActive = group.tools.some((tool) => tool.mode === drawingMode);
  const displayTool = groupActive
    ? (drawingMode as ToolMode)
    : activeTool;
  // Как в TradingView: у иконки тултип конкретного инструмента, у стрелки — группы.
  const displayToolLabel = group.tools.find((tool) => tool.mode === displayTool)?.label ?? group.label;

  const openFlyout = () => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Отступ считаем от правого края рейла, а не кнопки: стрелка вынесена за
    // границы группы (absolute left:100%), и меню налезало бы на неё.
    const railRight = el.closest(".drawing-rail")?.getBoundingClientRect().right ?? rect.right;
    setFlyout({ top: rect.top, left: railRight + 8 });
  };

  /**
   * Как в TradingView: первый клик по иконке просто выбирает текущий инструмент
   * группы, а каждый следующий открывает/закрывает выпадающее меню — пока фокус
   * с кнопки не снят кликом мимо.
   */
  const handleClick = () => {
    if (!focused) {
      setFocused(true);
      setFlyout(null);
      onSelect(displayTool);
      return;
    }
    if (flyout) setFlyout(null);
    else openFlyout();
  };

  // Клик мимо группы и её меню снимает фокус: следующий клик снова выбирает.
  useEffect(() => {
    if (!focused && !flyout) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const insideGroup = target != null && anchorRef.current?.contains(target);
      const insideFlyout = target instanceof Element && target.closest(".drawing-tool-flyout") != null;
      if (insideGroup || insideFlyout) return;
      setFlyout(null);
      setFocused(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [focused, flyout]);

  // Выбрали инструмент из другой группы — фокус с этой снят.
  useEffect(() => {
    if (groupActive) return;
    setFocused(false);
    setFlyout(null);
  }, [groupActive]);

  /** Стрелка — отдельная зона: открывает/закрывает список сразу, как в TradingView. */
  const toggleFlyout = () => {
    setFocused(true);
    if (flyout) setFlyout(null);
    else openFlyout();
  };

  return (
    <div ref={anchorRef} className={`drawing-tool-group ${flyout ? "is-open" : ""}`}>
      <Button
        type="text"
        className={`drawing-tool-btn ${groupActive ? "is-active" : ""} ${flyout ? "is-open" : ""}`}
        onClick={handleClick}
        title={displayToolLabel}
      >
        <DrawingToolIcon mode={displayTool} />
      </Button>
      <button
        type="button"
        className="drawing-tool-caret"
        title={group.label}
        aria-label={`${group.label}: открыть список`}
        aria-expanded={flyout != null}
        onClick={toggleFlyout}
      >
        <span role="img" className="drawing-tool-caret__icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 16" width="5" height="8">
            <path d="M.6 1.4l1.4-1.4 8 8-8 8-1.4-1.4 6.389-6.532-6.389-6.668z" fill="currentColor" />
          </svg>
        </span>
      </button>
      {flyout &&
        createPortal(
          <div className="drawing-tool-flyout" style={{ top: flyout.top, left: flyout.left }}>
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
  const confirmDelete = useConfirmDelete();
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
            // Группа выбирает инструмент напрямую (без toggle): повторный клик по
            // иконке открывает меню, а не снимает выбор — как в TradingView.
            onSelect={onDrawingModeChange}
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
      <Button
        type="text"
        className="drawing-tool-btn"
        disabled={drawingCount === 0}
        title={`Удалить все рисунки (${drawingCount}) · Ctrl+Shift+Delete`}
        onClick={() => confirmDelete({
          title: "Удалить все рисунки на графике?",
          content: `Объектов на графике: ${drawingCount}. Отменить нельзя.`,
          onConfirm: onDeleteAllDrawings,
        })}
      >
        <span
          className="drawing-tool-icon"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: removeDrawingIcon }}
        />
      </Button>
    </div>
  );
}
