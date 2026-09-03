/**
 * TrendLineTool – renders, draws, edits and manages trend lines on the
 * lightweight-charts SVG overlay.  Designed to be called inside the Chart
 * component's useEffect so it can access chart / series APIs directly.
 */

import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { TrendLine } from "../../types";
import { logicalToCoordinateFloat, pointToPixel, snapXToNearestCandle, timeToLogical, xToSnappedTime } from "../shared/coordinates";
import { magnetPlotHeight, snapPixelsWithMagnet } from "../shared/magnet";
import { DrawingToolbarController } from "../shared/DrawingToolbarController";
import { getNewDrawingStyle } from "../shared/drawingTemplates";
import { lineLabelLayout } from "../shared/lineLabelLayout";
import { createTrendLineExtendSlots } from "./trendLineToolbarSlots";
import { arrowHeadGeometry, arrowHeadPointsAttr } from "./arrowHead";
import { createDrawingOverlay } from "../shared/overlay";
import { attachManagedDrawingLifecycle, createClipboardBridge, runManagedDragSession } from "../shared/ManagedDrawingTool";
import { createDrawingSession, drawingPointFromClick } from "../shared/drawingSession";
import { createEditableLabelStore } from "../shared/editableLabel";
import { createSelectionController } from "../shared/selection";
import type { DrawingCrudCallbacks, DrawingMode, ManagedDrawingToolOptions, ChartCandleStore, SeriesApiLike } from "../shared/types";
export type { DrawingMode } from "../shared/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type TrendLineCallbacks = DrawingCrudCallbacks<TrendLine>;

interface PixelPoint {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Примагничивание к горизонтали: если конец линии подведён к уровню другого
 * конца ближе этого расстояния по вертикали (в пикселях), цена приравнивается
 * к нему точно.
 *
 * Порог в пикселях, а не в цене: подводит его глаз, и на любом инструменте и
 * зуме «почти горизонтально» выглядит одинаково. А закрепляется именно ценой —
 * тогда линия остаётся ровной при любом последующем масштабировании, тогда как
 * равенство пикселей развалилось бы на первом же зуме.
 *
 * Нужно для разметки BOS и CHoCH: там уровень берут от экстремума свинга и
 * тянут вправо до пробоя, и он обязан быть ровным. Отдельный инструмент для
 * этого не нужен — горизонтальная линия у нас бесконечная, а здесь важен
 * именно отрезок с началом и концом.
 */
const HORIZONTAL_SNAP_PX = 6;

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function strokeDashForStyle(style: TrendLine["lineStyle"]): string {
  if (style === "dashed") return "8 4";
  if (style === "dotted") return "2 4";
  return "";
}

function trendLineTextColor(tl: TrendLine): string {
  return tl.textColor ?? tl.color;
}

function applyArrowHead(
  el: SVGPolylineElement,
  from: PixelPoint,
  to: PixelPoint,
  color: string,
  width: number,
  visible: boolean,
  dash = "",
): PixelPoint {
  if (!visible) {
    el.setAttribute("visibility", "hidden");
    return to;
  }
  const head = arrowHeadGeometry(from, to, width);
  if (!head) {
    el.setAttribute("visibility", "hidden");
    return to;
  }
  el.setAttribute("points", arrowHeadPointsAttr(head));
  el.setAttribute("stroke", color);
  el.setAttribute("stroke-width", String(width));
  el.setAttribute("stroke-dasharray", dash);
  el.setAttribute("visibility", "visible");
  return head.shaftEnd;
}

/* ------------------------------------------------------------------ */
/*  Coordinate conversions                                             */
/* ------------------------------------------------------------------ */

function pxToPrice(series: SeriesApiLike, y: number): number | null {
  return series.coordinateToPrice(y);
}

/* ------------------------------------------------------------------ */
/*  Main attach function                                               */
/* ------------------------------------------------------------------ */

/**
 * Call once inside the Chart useEffect.  Returns a cleanup function.
 */
export function attachTrendLineTool(opts: ManagedDrawingToolOptions & {
  container: HTMLDivElement;
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  candleStore: ChartCandleStore;
  trendLines: TrendLine[];
  drawingMode: DrawingMode;
  datasetId: string;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  callbacks: TrendLineCallbacks;
}): () => void {
  const { container, chart, series, candleStore, datasetId, callbacks, onSelect, manager } = opts;
  let trendLines = [...opts.trendLines];

  /* ---- SVG overlay ---- */
  const overlay = createDrawingOverlay(container, chart, "trend-line-overlay");
  const { svg } = overlay;

  /* ---- Selection state ---- */
  let ghostLine: SVGLineElement | null = null;
  let ghostArrow: SVGPolylineElement | null = null;
  let dragActive = false;

  /* ---- Elements per line ---- */
  interface LineEls {
    group: SVGGElement;
    line: SVGLineElement;
    extLine: SVGLineElement;
    hitArea: SVGLineElement;
    handle1: SVGCircleElement;
    handle2: SVGCircleElement;
    arrowHead: SVGPolylineElement;
  }
  const lineElements = new Map<string, LineEls>();

  /* ---- Toolbar ---- */
  let toolbarController: DrawingToolbarController<TrendLine>;

  const selection = createSelectionController<TrendLine>({
    kind: "trendline",
    manager,
    container,
    findById: (id) => trendLines.find((item) => item.id === id),
    getSelectionElement: (id) => lineElements.get(id)?.group ?? null,
    onShow: (tl) => createToolbar(tl),
    onHide: () => removeToolbar(),
    onChange: (id) => onSelect?.(id),
    syncAll,
    ignoreSelector: ".trend-hit-area, .rect-handle-el, .trend-line-label",
    initialSelectedId: opts.selectedId ?? null,
  });
  const selectLine = selection.select;

  const labelStore = createEditableLabelStore({
    container,
    className: "trend-line-label",
    canEdit: (id) => {
      if (!manager.canEditExistingDrawings()) return false;
      const line = trendLines.find((item) => item.id === id);
      return Boolean(line && !line.locked);
    },
    getText: (id) => trendLines.find((item) => item.id === id)?.label ?? "",
    getTextColor: (id) => {
      const line = trendLines.find((item) => item.id === id);
      return line ? trendLineTextColor(line) : "#d1d4dc";
    },
    onBeforeEdit: (id) => {
      if (!selection.isSelected(id)) selectLine(id);
      // Пересинхронизируем перед открытием редактора: выделение меняет вид
      // лейбла, и без этого он открывался по устаревшей позиции.
      const line = trendLines.find((item) => item.id === id);
      if (line) syncOne(line);
    },
    onCommit: (id, value) => {
      updateLine(id, { label: value, showLabel: Boolean(value) });
    },
    onCancel: (id) => {
      const line = trendLines.find((item) => item.id === id);
      if (line) syncOne(line);
    },
  });

  /** Короткая линия не должна зажимать текст в пару пикселей. */
  const LABEL_MIN_WIDTH = 90;

  /**
   * Лейбл получает постоянную ширину — по длине самой линии, как у
   * прямоугольника, где она берётся от фигуры.
   *
   * Без этого коробка растягивалась по тексту, а transform центрирует её по
   * собственному размеру: любая смена содержимого — клик по placeholder, ввод
   * буквы — сдвигала лейбл, и это читалось как «текст меняет размер и прыгает».
   * Теперь коробка зависит только от геометрии линии, а текст ездит внутри неё.
   */
  function applyLabelPosition(el: HTMLElement, p1: PixelPoint, p2: PixelPoint) {
    const layout = lineLabelLayout(p1, p2);
    el.style.left = `${layout.x}px`;
    el.style.top = `${layout.y}px`;
    el.style.width = `${Math.max(LABEL_MIN_WIDTH, layout.length)}px`;
    el.style.transform = `translate(-50%, -50%) rotate(${layout.angle}deg)`;
  }

  function removeToolbar() {
    labelStore.commitActive();
    toolbarController.hide();
  }

  function createToolbar(tl: TrendLine) {
    toolbarController.show(tl);
  }

  /* ---- Helpers ---- */

  function toPixel(pt: { time: number; price: number }): PixelPoint | null {
    return pointToPixel(chart, series, pt, candleStore.candles);
  }

  function extendedPoints(tl: TrendLine, p1: PixelPoint, p2: PixelPoint): { ep1: PixelPoint; ep2: PixelPoint } {
    const rect = container.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    let ep1 = { ...p1 }, ep2 = { ...p2 };

    if (tl.extendLeft && (dx !== 0 || dy !== 0)) {
      // extend p1 backwards to edge
      const tVals: number[] = [];
      if (dx !== 0) { tVals.push(-p1.x / dx); tVals.push((w - p1.x) / dx); }
      if (dy !== 0) { tVals.push(-p1.y / dy); tVals.push((h - p1.y) / dy); }
      const negT = tVals.filter((t) => t < 0);
      if (negT.length) {
        const t = Math.max(...negT);
        ep1 = { x: p1.x + t * dx, y: p1.y + t * dy };
      }
    }

    if (tl.extendRight && (dx !== 0 || dy !== 0)) {
      const tVals: number[] = [];
      if (dx !== 0) { tVals.push(-p1.x / dx); tVals.push((w - p1.x) / dx); }
      if (dy !== 0) { tVals.push(-p1.y / dy); tVals.push((h - p1.y) / dy); }
      // t for p2 is 1, we want t > 1
      const posT = tVals.filter((t) => t > 1);
      if (posT.length) {
        const t = Math.min(...posT);
        ep2 = { x: p1.x + t * dx, y: p1.y + t * dy };
      }
    }
    return { ep1, ep2 };
  }

  /* ---- CRUD ---- */

  function updateLine(id: string, patch: Partial<TrendLine>) {
    const idx = trendLines.findIndex((l) => l.id === id);
    if (idx < 0) return;
    trendLines[idx] = { ...trendLines[idx], ...patch };
    callbacks.onUpdate(trendLines[idx]);
    syncAll();
  }

  function deleteLine(id: string) {
    trendLines = trendLines.filter((l) => l.id !== id);
    const els = lineElements.get(id);
    if (els) { els.group.remove(); lineElements.delete(id); }
    labelStore.remove(id);
    selection.handleDeleted(id);
    callbacks.onDelete(id);
  }

  function purgeAllLines() {
    for (const els of lineElements.values()) {
      els.group.remove();
    }
    lineElements.clear();
    labelStore.destroy();
    trendLines = [];
    selection.reset();
    syncAll();
  }

  toolbarController = new DrawingToolbarController({
    container,
    preset: "full",
    className: "trend-toolbar",
    templateKind: "trendline",
    persistenceKey: (tl) => `trend-line:${tl.id}`,
    getState: (tl) => ({
      lineColor: tl.color,
      textColor: trendLineTextColor(tl),
      text: tl.label,
      showLabel: tl.showLabel,
      width: tl.width,
      style: tl.lineStyle,
      locked: Boolean(tl.locked),
    }),
    onPatch: (tl, patch) => {
      updateLine(tl.id, {
        ...(patch.lineColor != null ? { color: patch.lineColor } : {}),
        ...(patch.textColor != null ? { textColor: patch.textColor } : {}),
        ...(patch.width != null ? { width: patch.width } : {}),
        ...(patch.style ? { lineStyle: patch.style } : {}),
        ...(patch.text != null ? { label: patch.text, showLabel: patch.showLabel ?? Boolean(patch.text.trim()) } : {}),
        ...(patch.showLabel != null && patch.text == null ? { showLabel: patch.showLabel } : {}),
        ...(patch.locked != null ? { locked: patch.locked } : {}),
      });
    },
    onDelete: (tl) => deleteLine(tl.id),
    onSync: () => syncAll(),
    slots: createTrendLineExtendSlots(
      (drawing) => trendLines.find((item) => item.id === drawing.id),
      (drawing, direction, enabled) => {
        updateLine(drawing.id, direction === "left" ? { extendLeft: enabled } : { extendRight: enabled });
      },
    ),
  });

  const unregisterLifecycle = attachManagedDrawingLifecycle({
    manager,
    kind: "trendline",
    bridge: createClipboardBridge({
      kind: "trendline",
      datasetId,
      candleStore,
      getSelectedId: () => selection.getSelectedId(),
      findById: (id) => trendLines.find((item) => item.id === id),
      append: (line) => { trendLines.push(line); },
      onCreate: callbacks.onCreate,
      select: (id) => selectLine(id),
      deleteSelected: () => {
        const id = selection.getSelectedId();
        if (id) deleteLine(id);
      },
      createFromClipboard: (data) => ({ ...data, id: crypto.randomUUID(), datasetId }),
      syncAll,
      cancelDrawing: (silent?: boolean) => drawingSession.cancel(silent),
    }),
    syncAll,
    isDragActive: () => dragActive,
    // Отмена и повтор подменяют коллекцию снаружи. Сбрасываем своё и заливаем
    // новое — график при этом не пересоздаётся и положение не теряется.
    replaceAll: (items) => {
      purgeAllLines();
      trendLines = (items as TrendLine[]).map((item) => ({ ...item }));
      syncAll();
    },
    onDeselect: () => selection.handleManagerDeselect(),
    purgeAll: purgeAllLines,
  });

  /* ---- Build SVG elements for one line ---- */

  function buildLineEls(tl: TrendLine): LineEls {
    const group = overlay.createClippedGroup();
    group.dataset.trendId = tl.id;

    const extLine = document.createElementNS(SVG_NS, "line");
    extLine.setAttribute("class", "trend-ext-line");

    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "trend-main-line");
    line.setAttribute("stroke-linecap", "round");

    const arrowHead = document.createElementNS(SVG_NS, "polyline");
    arrowHead.setAttribute("class", "trend-arrow-head");
    arrowHead.setAttribute("fill", "none");
    arrowHead.setAttribute("stroke-linecap", "round");
    arrowHead.setAttribute("stroke-linejoin", "round");

    const hitArea = document.createElementNS(SVG_NS, "line");
    hitArea.setAttribute("class", "trend-hit-area");

    const handle1 = document.createElementNS(SVG_NS, "circle");
    handle1.setAttribute("class", "rect-handle-el");
    handle1.setAttribute("r", "5");
    handle1.style.cursor = "grab";

    const handle2 = document.createElementNS(SVG_NS, "circle");
    handle2.setAttribute("class", "rect-handle-el");
    handle2.setAttribute("r", "5");
    handle2.style.cursor = "grab";

    group.append(extLine, line, arrowHead, hitArea, handle1, handle2);

    // Пустая подсказка проявляется по наведению на саму линию, а не на неё же:
    // невидимую надпись искать мышью бессмысленно. Класс снимаем при уходе, но
    // если курсор переехал на подсказку — её собственный :hover держит её на
    // экране, так что дотянуться и кликнуть можно.
    hitArea.addEventListener("pointerenter", () => {
      labelStore.get(tl.id)?.classList.add("is-line-hovered");
    });
    hitArea.addEventListener("pointerleave", () => {
      labelStore.get(tl.id)?.classList.remove("is-line-hovered");
    });

    // Interaction: select on click
    hitArea.addEventListener("pointerdown", (e) => {
      if (!manager.canEditExistingDrawings()) return;
      e.stopPropagation();
      e.preventDefault();
      selectLine(tl.id);
      const current = trendLines.find((item) => item.id === tl.id);
      if (current?.locked) return;
      startDragBody(tl.id, e);
    });

    handle1.addEventListener("pointerdown", (e) => {
      if (!manager.canEditExistingDrawings()) return;
      e.stopPropagation();
      e.preventDefault();
      selectLine(tl.id);
      const current = trendLines.find((item) => item.id === tl.id);
      if (current?.locked) return;
      startDragHandle(tl.id, "point1", e);
    });

    handle2.addEventListener("pointerdown", (e) => {
      if (!manager.canEditExistingDrawings()) return;
      e.stopPropagation();
      e.preventDefault();
      selectLine(tl.id);
      const current = trendLines.find((item) => item.id === tl.id);
      if (current?.locked) return;
      startDragHandle(tl.id, "point2", e);
    });

    return { group, line, extLine, hitArea, handle1, handle2, arrowHead };
  }

  function syncLabelOverlay(tl: TrendLine, p1: PixelPoint, p2: PixelPoint, isSelected: boolean) {
    const el = labelStore.ensure(tl.id);
    applyLabelPosition(el, p1, p2);
    const state = labelStore.syncContent(tl.id, isSelected);
    if (state === "editing") return;
    el.style.display = state === "hidden" ? "none" : "";
  }

  /* ---- Sync visual positions ---- */

  function syncOne(tl: TrendLine) {
    let els = lineElements.get(tl.id);
    if (!els) {
      els = buildLineEls(tl);
      lineElements.set(tl.id, els);
    }

    const p1 = toPixel(tl.point1);
    const p2 = toPixel(tl.point2);

    if (!p1 || !p2) {
      els.group.setAttribute("visibility", "hidden");
      return;
    }
    els.group.setAttribute("visibility", "visible");

    // Вертикальную линию сажаем на свечу текущего ТФ, внутри которой лежит её
    // время. Хранится центр свечи с ТФ рисования: на другом ТФ это время попадает
    // в середину бакета, и timeToX поставил бы линию между свечами. Берём именно
    // «содержащую» свечу (floor), а не ближайшую: округление вперёд уводило линию
    // за последнюю раскрытую свечу — на 3ч она повисала в пустоте справа.
    if (tl.point1.time === tl.point2.time && candleStore.candles.length) {
      const logical = timeToLogical(tl.point1.time, candleStore.candles);
      const barIndex = logical == null ? null : Math.floor(logical);
      // Только если время попадает в реально загруженную свечу. Зажимать нельзя:
      // линии из-за пределов окна прилипали бы к краю графика вместо того, чтобы
      // оставаться за экраном.
      if (barIndex != null && barIndex >= 0 && barIndex < candleStore.candles.length) {
        const snappedX = logicalToCoordinateFloat(chart, barIndex);
        if (snappedX != null) {
          p1.x = snappedX;
          p2.x = snappedX;
        }
      }
    }

    const isSelected = selection.isSelected(tl.id);
    const dash = strokeDashForStyle(tl.lineStyle);
    const shaftEnd = applyArrowHead(
      els.arrowHead,
      p1,
      p2,
      tl.color,
      tl.width,
      Boolean(tl.endArrow),
      dash,
    );

    // Main line
    els.line.setAttribute("x1", String(p1.x));
    els.line.setAttribute("y1", String(p1.y));
    els.line.setAttribute("x2", String(shaftEnd.x));
    els.line.setAttribute("y2", String(shaftEnd.y));
    els.line.setAttribute("stroke", tl.color);
    els.line.setAttribute("stroke-width", String(tl.width));
    els.line.setAttribute("stroke-dasharray", dash);

    // Extended line
    if (tl.extendLeft || tl.extendRight) {
      const { ep1, ep2 } = extendedPoints(tl, p1, p2);
      els.extLine.setAttribute("x1", String(ep1.x));
      els.extLine.setAttribute("y1", String(ep1.y));
      els.extLine.setAttribute("x2", String(ep2.x));
      els.extLine.setAttribute("y2", String(ep2.y));
      els.extLine.setAttribute("stroke", tl.color);
      els.extLine.setAttribute("stroke-width", String(tl.width));
      els.extLine.setAttribute("stroke-dasharray", strokeDashForStyle(tl.lineStyle));
      els.extLine.setAttribute("stroke-opacity", "0.4");
      els.extLine.setAttribute("visibility", "visible");
    } else {
      els.extLine.setAttribute("visibility", "hidden");
    }

    // Hit area (invisible thick line for easy clicking)
    els.hitArea.setAttribute("x1", String(p1.x));
    els.hitArea.setAttribute("y1", String(p1.y));
    els.hitArea.setAttribute("x2", String(p2.x));
    els.hitArea.setAttribute("y2", String(p2.y));

    // Handles
    els.handle1.setAttribute("cx", String(p1.x));
    els.handle1.setAttribute("cy", String(p1.y));
    els.handle1.style.display = isSelected && !tl.locked ? "" : "none";

    els.handle2.setAttribute("cx", String(p2.x));
    els.handle2.setAttribute("cy", String(p2.y));
    els.handle2.style.display = isSelected && !tl.locked ? "" : "none";

    // Label
    syncLabelOverlay(tl, p1, p2, isSelected);

    // Selection glow
    els.group.classList.toggle("selected", isSelected);
  }

  function syncAll() {
    overlay.sync();
    trendLines.forEach(syncOne);
  }

  /** Подтянут ли конец к уровню опоры — решается по вертикали в пикселях. */
  function snapsToHorizontal(anchorY: number, movingY: number): boolean {
    return Math.abs(movingY - anchorY) <= HORIZONTAL_SNAP_PX;
  }

  function previewAtPixels(tl: TrendLine, p1: PixelPoint, p2: PixelPoint) {
    const els = lineElements.get(tl.id);
    if (!els) return;
    const shaftEnd = applyArrowHead(
      els.arrowHead,
      p1,
      p2,
      tl.color,
      tl.width,
      Boolean(tl.endArrow),
      strokeDashForStyle(tl.lineStyle),
    );
    els.line.setAttribute("x1", String(p1.x)); els.line.setAttribute("y1", String(p1.y));
    els.line.setAttribute("x2", String(shaftEnd.x)); els.line.setAttribute("y2", String(shaftEnd.y));
    els.hitArea.setAttribute("x1", String(p1.x)); els.hitArea.setAttribute("y1", String(p1.y));
    els.hitArea.setAttribute("x2", String(p2.x)); els.hitArea.setAttribute("y2", String(p2.y));
    els.handle1.setAttribute("cx", String(p1.x)); els.handle1.setAttribute("cy", String(p1.y));
    els.handle2.setAttribute("cx", String(p2.x)); els.handle2.setAttribute("cy", String(p2.y));
    if (tl.extendLeft || tl.extendRight) {
      const { ep1, ep2 } = extendedPoints(tl, p1, p2);
      els.extLine.setAttribute("x1", String(ep1.x)); els.extLine.setAttribute("y1", String(ep1.y));
      els.extLine.setAttribute("x2", String(ep2.x)); els.extLine.setAttribute("y2", String(ep2.y));
    }
    syncLabelOverlay(tl, p1, p2, selection.isSelected(tl.id));
  }

  /* ---- Drag handlers ---- */

  function startDragHandle(id: string, which: "point1" | "point2", startEvent: PointerEvent) {
    const tl = trendLines.find((l) => l.id === id);
    if (!tl) return;

    const rect = container.getBoundingClientRect();
    const originalP1 = toPixel(tl.point1);
    const originalP2 = toPixel(tl.point2);
    if (!originalP1 || !originalP2) return;

    let latestEvent: PointerEvent | null = null;
    runManagedDragSession(startEvent, (active) => { dragActive = active; }, {
      target: startEvent.target as Element,
      onMove: (event) => {
        latestEvent = event;
        const snap = snapPixelsWithMagnet(
          manager, chart, series, candleStore.candles,
          event.clientX - rect.left, event.clientY - rect.top, magnetPlotHeight(container, chart),
        );
        const anchor = which === "point1" ? originalP2 : originalP1;
        const y = snapsToHorizontal(anchor.y, snap.y) ? anchor.y : snap.y;
        previewAtPixels(tl, which === "point1" ? { x: snap.x, y } : originalP1, which === "point2" ? { x: snap.x, y } : originalP2);
      },
      onEnd: (_event, moved) => {
        if (!moved || !latestEvent) return;
        const snap = snapPixelsWithMagnet(
          manager, chart, series, candleStore.candles,
          latestEvent.clientX - rect.left, latestEvent.clientY - rect.top, magnetPlotHeight(container, chart),
        );
        const anchor = which === "point1" ? originalP2 : originalP1;
        const anchorPrice = which === "point1" ? tl.point2.price : tl.point1.price;
        const y = snapsToHorizontal(anchor.y, snap.y) ? anchor.y : snap.y;
        const time = snap.time;
        const price = snapsToHorizontal(anchor.y, snap.y) ? anchorPrice : (snap.price ?? pxToPrice(series, y));
        if (time != null && price != null && price > 0) {
          updateLine(id, which === "point1" ? { point1: { time, price } } : { point2: { time, price } });
        } else {
          syncAll();
        }
      },
    });
  }

  function startDragBody(id: string, startEvent: PointerEvent) {
    const tl = trendLines.find((l) => l.id === id);
    if (!tl) return;

    const rect = container.getBoundingClientRect();
    const startX = startEvent.clientX - rect.left;
    const startY = startEvent.clientY - rect.top;
    const origP1 = { ...tl.point1 };
    const origP2 = { ...tl.point2 };
    const p1Px = toPixel(origP1);
    const p2Px = toPixel(origP2);
    if (!p1Px || !p2Px) return;

    let finalDx = 0;
    let finalDy = 0;
    runManagedDragSession(startEvent, (active) => { dragActive = active; }, {
      target: startEvent.target as Element,
      moveThreshold: 3,
      onMove: (event) => {
        finalDx = snapXToNearestCandle(chart, p1Px.x + (event.clientX - rect.left) - startX) - p1Px.x;
        finalDy = (event.clientY - rect.top) - startY;
        previewAtPixels(
          tl,
          { x: p1Px.x + finalDx, y: p1Px.y + finalDy },
          { x: p2Px.x + finalDx, y: p2Px.y + finalDy },
        );
      },
      onEnd: (_event, moved) => {
        if (!moved) return;
        const newP1Time = xToSnappedTime(chart, p1Px.x + finalDx, candleStore.candles);
        const newP1Price = pxToPrice(series, p1Px.y + finalDy);
        const newP2Time = xToSnappedTime(chart, p2Px.x + finalDx, candleStore.candles);
        const newP2Price = pxToPrice(series, p2Px.y + finalDy);
        if (newP1Time != null && newP1Price != null && newP2Time != null && newP2Price != null && newP1Price > 0 && newP2Price > 0) {
          updateLine(id, {
            point1: { time: newP1Time, price: newP1Price },
            point2: { time: newP2Time, price: newP2Price },
          });
        } else {
          syncAll();
        }
      },
    });
  }

  /* ---- Drawing mode ---- */

  const drawingSession = createDrawingSession<{ time: number; price: number }>({
    mode: ["trendline", "arrow"],
    manager,
    container,
    chart,
    series,
    candleStore,
    pointCount: 2,
    pointFromClick: (event) => drawingPointFromClick(event, { container, chart, series, candleStore, manager }),
    ghostUpdate: (points, cursor) => {
      const drawingArrow = manager.getMode() === "arrow";
      if (!ghostLine) {
        ghostLine = document.createElementNS(SVG_NS, "line");
        ghostLine.setAttribute("class", "trend-ghost-line");
        ghostLine.setAttribute("stroke-linecap", "round");
        // Цвет и толщина — от того оформления, которое получит готовая линия.
        // В классе лежат заводские, и при протяжке ты видел не свой стиль.
        // Пунктир призрака оставляем: он отличает «ещё рисую» от готовой фигуры.
        const tpl = getNewDrawingStyle("trendline");
        ghostLine.setAttribute("stroke", tpl.lineColor);
        ghostLine.setAttribute("stroke-width", String(tpl.width));
        svg.appendChild(ghostLine);
      }
      if (!ghostArrow) {
        ghostArrow = document.createElementNS(SVG_NS, "polyline");
        ghostArrow.setAttribute("class", "trend-ghost-arrow");
        ghostArrow.setAttribute("fill", "none");
        ghostArrow.setAttribute("stroke-linecap", "round");
        ghostArrow.setAttribute("stroke-linejoin", "round");
        svg.appendChild(ghostArrow);
      }
      const color = ghostLine.getAttribute("stroke") ?? "#ff4976";
      const width = Number(ghostLine.getAttribute("stroke-width") ?? 2);
      const anchor = points.length ? toPixel(points[0]) : null;
      const p1 = anchor ?? cursor;
      // Призрак обязан показывать уже примагниченное положение, иначе линия
      // прыгнет в момент отпускания и разметка окажется не там, где целились.
      const y2 = anchor && snapsToHorizontal(anchor.y, cursor.y) ? anchor.y : cursor.y;
      const p2 = { x: cursor.x, y: y2 };
      const shaftEnd = applyArrowHead(ghostArrow, p1, p2, color, width, drawingArrow);
      ghostLine.setAttribute("x1", String(p1.x));
      ghostLine.setAttribute("y1", String(p1.y));
      ghostLine.setAttribute("x2", String(shaftEnd.x));
      ghostLine.setAttribute("y2", String(shaftEnd.y));
    },
    ghostRemove: () => {
      ghostLine?.remove();
      ghostLine = null;
      ghostArrow?.remove();
      ghostArrow = null;
    },
    commit: ([point1, point2]) => {
      const tpl = getNewDrawingStyle("trendline");
      const anchorPx = toPixel(point1);
      const endPx = toPixel(point2);
      const end = anchorPx && endPx && snapsToHorizontal(anchorPx.y, endPx.y)
        ? { ...point2, price: point1.price }
        : point2;
      const newLine: TrendLine = {
        id: crypto.randomUUID(),
        datasetId,
        point1,
        point2: end,
        color: tpl.lineColor,
        textColor: tpl.textColor ?? tpl.lineColor,
        width: tpl.width,
        lineStyle: tpl.style,
        extendLeft: false,
        extendRight: false,
        showLabel: false,
        label: "",
        locked: false,
        endArrow: manager.getMode() === "arrow",
      };
      trendLines.push(newLine);
      callbacks.onCreate(newLine);
      selectLine(newLine.id);
      syncAll();
    },
    onComplete: () => callbacks.onDrawingComplete(),
  });

  /* ---- Cleanup ---- */
  return () => {
    unregisterLifecycle();
    drawingSession.destroy();
    selection.destroy();
    overlay.remove();
    labelStore.destroy();
    toolbarController.destroy();
    removeToolbar();
    if (ghostLine) ghostLine.remove();
    if (ghostArrow) ghostArrow.remove();
  };
}
