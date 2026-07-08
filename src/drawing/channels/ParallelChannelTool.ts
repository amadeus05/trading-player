/**
 * ParallelChannelTool – параллельный канал как в TradingView:
 * клик 1 → клик 2 (базовая линия) → отвод мыши + клик 3 (ширина).
 */

import type { ParallelChannel } from "../../types";
import { pointToPixel, snapXToNearestCandle, xToSnappedTime } from "../shared/coordinates";
import { DrawingToolbarController } from "../shared/DrawingToolbarController";
import { getDefaultDrawingTemplateState } from "../shared/drawingTemplates";
import { attachManagedDrawingLifecycle, createClipboardBridge, runManagedDragSession } from "../shared/ManagedDrawingTool";
import { createDrawingOverlay } from "../shared/overlay";
import { bindDrawingPointerClick } from "../shared/drawingPointerClick";
import type { DrawingCrudCallbacks, DrawingMode, ManagedDrawingToolOptions, ChartCandleStore } from "../shared/types";
import { hexToRgba } from "../shared/colorUtils";

export type ParallelChannelCallbacks = DrawingCrudCallbacks<ParallelChannel>;

const SVG_NS = "http://www.w3.org/2000/svg";

interface PixelPoint {
  x: number;
  y: number;
}

interface ChannelGeometry {
  edge1: { p1: PixelPoint; p2: PixelPoint };
  edge2: { p1: PixelPoint; p2: PixelPoint };
  mid: { p1: PixelPoint; p2: PixelPoint };
  offset: number;
}

function strokeDashForStyle(style: ParallelChannel["lineStyle"]): string {
  if (style === "dashed") return "8 4";
  if (style === "dotted") return "2 4";
  return "";
}

function pxToPrice(series: any, y: number): number | null {
  return series.coordinateToPrice(y);
}

function channelGeometry(p1: PixelPoint, p2: PixelPoint, widthPt: PixelPoint): ChannelGeometry | null {
  if (p1.x === p2.x && p1.y === p2.y) return null;
  // Keep both rails on the same time anchors so price-scale changes cannot
  // introduce a horizontal shift.
  const offset = widthPt.y - p2.y;
  return {
    offset,
    edge1: { p1, p2 },
    edge2: {
      p1: { x: p1.x, y: p1.y + offset },
      p2: { x: p2.x, y: p2.y + offset },
    },
    mid: {
      p1: { x: p1.x, y: p1.y + offset / 2 },
      p2: { x: p2.x, y: p2.y + offset / 2 },
    },
  };
}

function extendedSegment(
  p1: PixelPoint,
  p2: PixelPoint,
  extendLeft: boolean,
  extendRight: boolean,
  plotW: number,
  plotH: number,
): { ep1: PixelPoint; ep2: PixelPoint } {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let ep1 = { ...p1 };
  let ep2 = { ...p2 };

  if ((extendLeft || extendRight) && (dx !== 0 || dy !== 0)) {
    const tVals: number[] = [];
    if (dx !== 0) {
      tVals.push(-p1.x / dx);
      tVals.push((plotW - p1.x) / dx);
    }
    if (dy !== 0) {
      tVals.push(-p1.y / dy);
      tVals.push((plotH - p1.y) / dy);
    }
    if (extendLeft) {
      const negT = tVals.filter((t) => t < 0);
      if (negT.length) {
        const t = Math.max(...negT);
        ep1 = { x: p1.x + t * dx, y: p1.y + t * dy };
      }
    }
    if (extendRight) {
      const posT = tVals.filter((t) => t > 1);
      if (posT.length) {
        const t = Math.min(...posT);
        ep2 = { x: p1.x + t * dx, y: p1.y + t * dy };
      }
    }
  }
  return { ep1, ep2 };
}

function applyLineStroke(
  line: SVGLineElement,
  color: string,
  width: number,
  style: ParallelChannel["lineStyle"],
) {
  line.setAttribute("stroke", color);
  line.style.stroke = color;
  line.style.strokeWidth = String(width);
  line.style.strokeDasharray = strokeDashForStyle(style);
}

function applyMidLineStroke(line: SVGLineElement, color: string, width: number) {
  line.setAttribute("stroke", color);
  line.style.stroke = color;
  line.style.strokeWidth = String(width);
  line.style.strokeLinecap = "butt";
  line.style.strokeDasharray = "6 4";
}

function setLineEndpoints(line: SVGLineElement, a: PixelPoint, b: PixelPoint) {
  line.setAttribute("x1", String(a.x));
  line.setAttribute("y1", String(a.y));
  line.setAttribute("x2", String(b.x));
  line.setAttribute("y2", String(b.y));
}

function polygonPoints(...pts: PixelPoint[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}

function pointOnParallel(p1: PixelPoint, p2: PixelPoint, offset: number, t: number): PixelPoint | null {
  if (p1.x === p2.x && p1.y === p2.y) return null;
  const base = {
    x: p1.x + t * (p2.x - p1.x),
    y: p1.y + t * (p2.y - p1.y),
  };
  return { x: base.x, y: base.y + offset };
}

function midpoint(a: PixelPoint, b: PixelPoint): PixelPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

type WidthDragRail = "edge1" | "edge2";
type ChannelCorner = "edge1Start" | "edge1End" | "edge2Start" | "edge2End";

function widthDragGeometry(
  p1: PixelPoint,
  p2: PixelPoint,
  startOffset: number,
  startCursor: PixelPoint,
  cursor: PixelPoint,
  rail: WidthDragRail,
): { p1: PixelPoint; p2: PixelPoint; offset: number } | null {
  if (p1.x === p2.x && p1.y === p2.y) return null;
  const deltaY = cursor.y - startCursor.y;
  if (rail === "edge2") {
    return { p1, p2, offset: startOffset + deltaY };
  }
  return {
    p1: { x: p1.x, y: p1.y + deltaY },
    p2: { x: p2.x, y: p2.y + deltaY },
    offset: startOffset - deltaY,
  };
}

export function attachParallelChannelTool(opts: ManagedDrawingToolOptions & {
  container: HTMLDivElement;
  chart: any;
  series: any;
  candleStore: ChartCandleStore;
  parallelChannels: ParallelChannel[];
  drawingMode: DrawingMode;
  datasetId: string;
  callbacks: ParallelChannelCallbacks;
}): () => void {
  const { container, chart, series, candleStore, datasetId, callbacks, manager } = opts;
  let parallelChannels = [...opts.parallelChannels];

  const overlay = createDrawingOverlay(container, chart, "parallel-channel-overlay");
  const { svg } = overlay;

  let selectedId: string | null = null;
  let drawPoint1: { time: number; price: number } | null = null;
  let drawPoint2: { time: number; price: number } | null = null;
  let dragActive = false;

  let ghostBaseLine: SVGLineElement | null = null;
  let ghostFill: SVGPolygonElement | null = null;
  let ghostEdge2: SVGLineElement | null = null;
  let ghostMid: SVGLineElement | null = null;

  interface ChannelEls {
    group: SVGGElement;
    fill: SVGPolygonElement;
    edge1: SVGLineElement;
    edge2: SVGLineElement;
    midLine: SVGLineElement;
    hitArea: SVGPolygonElement;
    handle1: SVGCircleElement;
    handle2: SVGCircleElement;
    handleEdge2Start: SVGCircleElement;
    handleEdge2End: SVGCircleElement;
    handleMid1: SVGRectElement;
    handleMid2: SVGRectElement;
  }
  const elMap = new Map<string, ChannelEls>();

  let toolbarController: DrawingToolbarController<ParallelChannel>;

  function getPlotSize() {
    const rect = container.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  function toPixel(pt: { time: number; price: number }): PixelPoint | null {
    return pointToPixel(chart, series, pt, candleStore.candles);
  }

  function pixelToDataPoint(px: PixelPoint): { time: number; price: number } | null {
    const time = xToSnappedTime(chart, px.x, candleStore.candles);
    const price = pxToPrice(series, px.y);
    if (time == null || price == null || price <= 0) return null;
    return { time, price };
  }

  /** Width is stored at point2's time; only its price defines the second rail. */
  function widthPointFromPixels(p1: PixelPoint, p2: PixelPoint, cursor: PixelPoint): { time: number; price: number } | null {
    if (p1.x === p2.x && p1.y === p2.y) return null;
    return pixelToDataPoint({ x: p2.x, y: cursor.y });
  }

  function removeToolbar() {
    toolbarController.hide();
  }

  function createToolbar(channel: ParallelChannel) {
    toolbarController.show(channel);
  }

  function cancelDrawingPreview() {
    drawPoint1 = null;
    drawPoint2 = null;
    removeGhost();
  }

  function isChannelHandleTarget(target: EventTarget | null): boolean {
    return target instanceof Element
      && Boolean(target.closest(".pc-mid-handle, .pc-hit-area, .parallel-channel-overlay .rect-handle-el"));
  }

  function removeGhost() {
    ghostBaseLine?.remove();
    ghostFill?.remove();
    ghostEdge2?.remove();
    ghostMid?.remove();
    ghostBaseLine = null;
    ghostFill = null;
    ghostEdge2 = null;
    ghostMid = null;
  }

  function ensureWidthGhost() {
    if (ghostFill) return;
    ghostFill = document.createElementNS(SVG_NS, "polygon");
    ghostFill.setAttribute("class", "pc-ghost-fill");
    ghostEdge2 = document.createElementNS(SVG_NS, "line");
    ghostEdge2.setAttribute("class", "pc-ghost-line");
    ghostMid = document.createElementNS(SVG_NS, "line");
    ghostMid.setAttribute("class", "pc-ghost-mid");
    svg.append(ghostFill, ghostEdge2, ghostMid);
  }

  function renderGhostWidth(p1: PixelPoint, p2: PixelPoint, cursor: PixelPoint) {
    ensureWidthGhost();
    const geom = channelGeometry(p1, p2, cursor);
    if (!geom || !ghostFill || !ghostEdge2 || !ghostMid || !ghostBaseLine) return;
    setLineEndpoints(ghostBaseLine, p1, p2);
    setLineEndpoints(ghostEdge2, geom.edge2.p1, geom.edge2.p2);
    setLineEndpoints(ghostMid, geom.mid.p1, geom.mid.p2);
    ghostFill.setAttribute(
      "points",
      polygonPoints(p1, p2, geom.edge2.p2, geom.edge2.p1),
    );
  }

  function updateLine(channel: ParallelChannel, patch: Partial<ParallelChannel>) {
    const idx = parallelChannels.findIndex((item) => item.id === channel.id);
    if (idx < 0) return;
    parallelChannels[idx] = { ...parallelChannels[idx], ...patch };
    callbacks.onUpdate(parallelChannels[idx]);
    syncAll();
  }

  function deleteChannel(id: string) {
    parallelChannels = parallelChannels.filter((item) => item.id !== id);
    elMap.get(id)?.group.remove();
    elMap.delete(id);
    if (selectedId === id) {
      selectedId = null;
      removeToolbar();
      manager.clearSelection("parallelchannel");
    }
    callbacks.onDelete(id);
  }

  function purgeAllChannels() {
    for (const els of elMap.values()) {
      els.group.remove();
    }
    elMap.clear();
    parallelChannels = [];
    if (selectedId !== null) {
      selectedId = null;
      removeToolbar();
    }
    manager.clearSelection("parallelchannel");
    syncAll();
  }

  toolbarController = new DrawingToolbarController({
    container,
    preset: "channel",
    className: "trend-toolbar",
    templateKind: "parallelchannel",
    persistenceKey: (channel) => `parallel-channel:${channel.id}`,
    getState: (channel) => ({
      lineColor: channel.color,
      fillColor: channel.fillColor,
      fillOpacity: channel.fillOpacity,
      width: channel.width,
      style: channel.lineStyle,
      locked: Boolean(channel.locked),
    }),
    onPatch: (channel, patch) => {
      updateLine(channel, {
        ...(patch.lineColor != null ? { color: patch.lineColor } : {}),
        ...(patch.fillColor != null ? { fillColor: patch.fillColor } : {}),
        ...(patch.fillOpacity != null ? { fillOpacity: patch.fillOpacity } : {}),
        ...(patch.width != null ? { width: patch.width } : {}),
        ...(patch.style ? { lineStyle: patch.style } : {}),
        ...(patch.locked != null ? { locked: patch.locked } : {}),
      });
    },
    onDelete: (channel) => deleteChannel(channel.id),
    onSync: () => syncAll(),
  });

  const unregisterLifecycle = attachManagedDrawingLifecycle({
    manager,
    kind: "parallelchannel",
    bridge: createClipboardBridge({
      kind: "parallelchannel",
      datasetId,
      candleStore,
      getSelectedId: () => selectedId,
      findById: (id) => parallelChannels.find((item) => item.id === id),
      append: (channel) => { parallelChannels.push(channel); },
      onCreate: callbacks.onCreate,
      select: (id) => selectChannel(id),
      deleteSelected: () => { if (selectedId) deleteChannel(selectedId); },
      createFromClipboard: (data) => ({ ...data, id: crypto.randomUUID(), datasetId }),
      syncAll,
      cancelDrawing: (silent?: boolean) => {
        if (!drawPoint1) return false;
        drawPoint1 = null;
        drawPoint2 = null;
        removeGhost();
        if (!silent) callbacks.onDrawingComplete();
        return true;
      },
    }),
    syncAll,
    isDragActive: () => dragActive,
    onDeselect: () => {
      if (selectedId === null) return;
      selectedId = null;
      removeToolbar();
      syncAll();
    },
    purgeAll: purgeAllChannels,
  });

  function selectChannel(id: string | null) {
    if (!id) {
      if (selectedId !== null) {
        selectedId = null;
        removeToolbar();
        syncAll();
      }
      manager.clearSelection("parallelchannel");
      return;
    }
    selectedId = id;
    const channel = parallelChannels.find((item) => item.id === id);
    if (channel) createToolbar(channel);
    manager.activateSelection("parallelchannel", elMap.get(id)?.group ?? null, id);
    syncAll();
  }

  function buildEls(channel: ParallelChannel): ChannelEls {
    const group = overlay.createClippedGroup();
    group.dataset.channelId = channel.id;

    const fill = document.createElementNS(SVG_NS, "polygon");
    fill.setAttribute("class", "pc-fill");

    const edge1 = document.createElementNS(SVG_NS, "line");
    edge1.setAttribute("class", "pc-edge-line");

    const edge2 = document.createElementNS(SVG_NS, "line");
    edge2.setAttribute("class", "pc-edge-line");

    const midLine = document.createElementNS(SVG_NS, "line");
    midLine.setAttribute("class", "pc-mid-line");

    const hitArea = document.createElementNS(SVG_NS, "polygon");
    hitArea.setAttribute("class", "pc-hit-area");

    const handle1 = document.createElementNS(SVG_NS, "circle");
    handle1.setAttribute("class", "rect-handle-el");
    handle1.setAttribute("r", "5");
    handle1.style.cursor = "grab";

    const handle2 = document.createElementNS(SVG_NS, "circle");
    handle2.setAttribute("class", "rect-handle-el");
    handle2.setAttribute("r", "5");
    handle2.style.cursor = "grab";

    const handleEdge2Start = document.createElementNS(SVG_NS, "circle");
    handleEdge2Start.setAttribute("class", "rect-handle-el");
    handleEdge2Start.setAttribute("r", "5");
    handleEdge2Start.style.cursor = "grab";

    const handleEdge2End = document.createElementNS(SVG_NS, "circle");
    handleEdge2End.setAttribute("class", "rect-handle-el");
    handleEdge2End.setAttribute("r", "5");
    handleEdge2End.style.cursor = "grab";

    const handleMid1 = document.createElementNS(SVG_NS, "rect");
    handleMid1.setAttribute("class", "pc-mid-handle");
    handleMid1.setAttribute("width", "8");
    handleMid1.setAttribute("height", "8");
    handleMid1.setAttribute("x", "-4");
    handleMid1.setAttribute("y", "-4");
    handleMid1.style.cursor = "grab";

    const handleMid2 = document.createElementNS(SVG_NS, "rect");
    handleMid2.setAttribute("class", "pc-mid-handle");
    handleMid2.setAttribute("width", "8");
    handleMid2.setAttribute("height", "8");
    handleMid2.setAttribute("x", "-4");
    handleMid2.setAttribute("y", "-4");
    handleMid2.style.cursor = "grab";

    group.append(fill, edge1, edge2, midLine, hitArea, handle1, handle2, handleEdge2Start, handleEdge2End, handleMid1, handleMid2);

    hitArea.addEventListener("pointerdown", (event) => {
      if (!manager.canEditExistingDrawings()) return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
      cancelDrawingPreview();
      selectChannel(channel.id);
      const current = parallelChannels.find((item) => item.id === channel.id);
      if (current?.locked) return;
      startDragBody(channel.id, event);
    });

    const bindCornerDrag = (corner: ChannelCorner) => (event: PointerEvent) => {
      if (!manager.canEditExistingDrawings()) return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
      cancelDrawingPreview();
      selectChannel(channel.id);
      const current = parallelChannels.find((item) => item.id === channel.id);
      if (current?.locked) return;
      startDragCorner(channel.id, corner, event);
    };

    handle1.addEventListener("pointerdown", bindCornerDrag("edge1Start"));
    handle2.addEventListener("pointerdown", bindCornerDrag("edge1End"));

    const bindWidthDrag = (rail: WidthDragRail) => (event: PointerEvent) => {
      if (!manager.canEditExistingDrawings()) return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
      cancelDrawingPreview();
      selectChannel(channel.id);
      const current = parallelChannels.find((item) => item.id === channel.id);
      if (current?.locked) return;
      startDragWidth(channel.id, event, rail);
    };
    handleEdge2Start.addEventListener("pointerdown", bindCornerDrag("edge2Start"));
    handleEdge2End.addEventListener("pointerdown", bindCornerDrag("edge2End"));
    handleMid1.addEventListener("pointerdown", bindWidthDrag("edge1"));
    handleMid2.addEventListener("pointerdown", bindWidthDrag("edge2"));

    return { group, fill, edge1, edge2, midLine, hitArea, handle1, handle2, handleEdge2Start, handleEdge2End, handleMid1, handleMid2 };
  }

  function setHandlePosition(handle: SVGCircleElement, pt: PixelPoint) {
    handle.setAttribute("cx", String(pt.x));
    handle.setAttribute("cy", String(pt.y));
  }

  function setMidHandlePosition(handle: SVGRectElement, pt: PixelPoint) {
    handle.setAttribute("transform", `translate(${pt.x}, ${pt.y})`);
  }

  function renderChannelGeometry(
    channel: ParallelChannel,
    els: ChannelEls,
    p1: PixelPoint,
    p2: PixelPoint,
    widthPx: PixelPoint,
    isSelected: boolean,
  ) {
    const geom = channelGeometry(p1, p2, widthPx);
    if (!geom) {
      els.group.setAttribute("visibility", "hidden");
      return;
    }

    const { w, h } = getPlotSize();
    const ext1 = extendedSegment(p1, p2, channel.extendLeft, channel.extendRight, w, h);
    const offset = geom.offset;
    let fillPts = [p1, p2, geom.edge2.p2, geom.edge2.p1];
    let line1A = p1;
    let line1B = p2;
    let line2A = geom.edge2.p1;
    let line2B = geom.edge2.p2;
    let midA = geom.mid.p1;
    let midB = geom.mid.p2;

    if (channel.extendLeft || channel.extendRight) {
      const ext2p1 = { x: ext1.ep1.x, y: ext1.ep1.y + offset };
      const ext2p2 = { x: ext1.ep2.x, y: ext1.ep2.y + offset };
      fillPts = [ext1.ep1, ext1.ep2, ext2p2, ext2p1];
      line1A = ext1.ep1;
      line1B = ext1.ep2;
      line2A = ext2p1;
      line2B = ext2p2;
      midA = { x: ext1.ep1.x, y: ext1.ep1.y + offset / 2 };
      midB = { x: ext1.ep2.x, y: ext1.ep2.y + offset / 2 };
    }

    els.fill.setAttribute("fill", hexToRgba(channel.fillColor, channel.fillOpacity));
    els.fill.setAttribute("points", polygonPoints(...fillPts));
    els.hitArea.setAttribute("points", polygonPoints(...fillPts));

    setLineEndpoints(els.edge1, line1A, line1B);
    applyLineStroke(els.edge1, channel.color, channel.width, channel.lineStyle);

    setLineEndpoints(els.edge2, line2A, line2B);
    applyLineStroke(els.edge2, channel.color, channel.width, channel.lineStyle);

    setLineEndpoints(els.midLine, midA, midB);
    applyMidLineStroke(els.midLine, channel.color, channel.width);

    setHandlePosition(els.handle1, p1);
    setHandlePosition(els.handle2, p2);
    setHandlePosition(els.handleEdge2Start, geom.edge2.p1);
    setHandlePosition(els.handleEdge2End, geom.edge2.p2);
    setMidHandlePosition(els.handleMid1, midpoint(p1, p2));
    setMidHandlePosition(els.handleMid2, midpoint(geom.edge2.p1, geom.edge2.p2));

    const showHandles = isSelected && !channel.locked;
    for (const handle of [els.handle1, els.handle2, els.handleEdge2Start, els.handleEdge2End, els.handleMid1, els.handleMid2]) {
      handle.style.display = showHandles ? "" : "none";
    }
    els.group.classList.toggle("selected", isSelected);
  }

  function syncOne(channel: ParallelChannel) {
    let els = elMap.get(channel.id);
    if (!els) {
      els = buildEls(channel);
      elMap.set(channel.id, els);
    }
    const p1 = toPixel(channel.point1);
    const p2 = toPixel(channel.point2);
    const wp = toPixel(channel.widthPoint);
    if (!p1 || !p2 || !wp) {
      els.group.setAttribute("visibility", "hidden");
      return;
    }
    const widthPx = { x: p2.x, y: wp.y };
    els.group.setAttribute("visibility", "visible");
    renderChannelGeometry(channel, els, p1, p2, widthPx, selectedId === channel.id);
  }

  function syncAll() {
    if (dragActive) return;
    overlay.sync();
    parallelChannels.forEach(syncOne);
  }

  function previewAtPixels(
    channel: ParallelChannel,
    p1: PixelPoint,
    p2: PixelPoint,
    wp: PixelPoint,
  ) {
    const els = elMap.get(channel.id);
    if (!els) return;
    renderChannelGeometry(channel, els, p1, p2, wp, selectedId === channel.id);
  }

  function previewWidthDrag(
    channel: ParallelChannel,
    p1: PixelPoint,
    p2: PixelPoint,
    startOffset: number,
    startCursor: PixelPoint,
    cursor: PixelPoint,
    rail: WidthDragRail,
  ) {
    const next = widthDragGeometry(p1, p2, startOffset, startCursor, cursor, rail);
    if (!next) return;
    const wp = pointOnParallel(next.p1, next.p2, next.offset, 1);
    if (!wp) return;
    previewAtPixels(channel, next.p1, next.p2, wp);
  }

  function startDragWidth(id: string, startEvent: PointerEvent, rail: WidthDragRail) {
    const channel = parallelChannels.find((item) => item.id === id);
    if (!channel) return;
    const rect = container.getBoundingClientRect();
    const originalP1 = toPixel(channel.point1);
    const originalP2 = toPixel(channel.point2);
    const originalWp = toPixel(channel.widthPoint);
    if (!originalP1 || !originalP2 || !originalWp) return;
    const startOffset = originalWp.y - originalP2.y;
    const startCursor = {
      x: startEvent.clientX - rect.left,
      y: startEvent.clientY - rect.top,
    };
    let latestEvent: PointerEvent | null = null;
    runManagedDragSession(startEvent, (active) => { dragActive = active; }, {
      target: startEvent.target as Element,
      onMove: (event) => {
        latestEvent = event;
        const cursor = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
        previewWidthDrag(channel, originalP1, originalP2, startOffset, startCursor, cursor, rail);
      },
      onEnd: (_event, moved) => {
        const current = parallelChannels.find((item) => item.id === id);
        if (current && moved && latestEvent) {
          const cursor = {
            x: latestEvent.clientX - rect.left,
            y: latestEvent.clientY - rect.top,
          };
          const next = widthDragGeometry(originalP1, originalP2, startOffset, startCursor, cursor, rail);
          if (next) {
            const wp = pointOnParallel(next.p1, next.p2, next.offset, 1);
            const p1Data = pixelToDataPoint(next.p1);
            const p2Data = pixelToDataPoint(next.p2);
            const wpData = wp ? pixelToDataPoint(wp) : null;
            if (p1Data && p2Data && wpData) {
              current.point1 = p1Data;
              current.point2 = p2Data;
              current.widthPoint = wpData;
              callbacks.onUpdate(current);
            }
          }
        }
        syncAll();
      },
    });
  }

  function startDragCorner(
    id: string,
    corner: ChannelCorner,
    startEvent: PointerEvent,
  ) {
    const channel = parallelChannels.find((item) => item.id === id);
    if (!channel) return;
    const rect = container.getBoundingClientRect();
    const originalP1 = toPixel(channel.point1);
    const originalP2 = toPixel(channel.point2);
    const originalWp = toPixel(channel.widthPoint);
    if (!originalP1 || !originalP2 || !originalWp) return;
    const offset = originalWp.y - originalP2.y;
    let latestEvent: PointerEvent | null = null;
    runManagedDragSession(startEvent, (active) => { dragActive = active; }, {
      target: startEvent.currentTarget as Element,
      onMove: (event) => {
        latestEvent = event;
        const x = snapXToNearestCandle(chart, event.clientX - rect.left);
        const y = event.clientY - rect.top;
        const cursor = { x, y };
        const baseCursor = corner.startsWith("edge2")
          ? { x: cursor.x, y: cursor.y - offset }
          : cursor;
        const movesPoint1 = corner.endsWith("Start");
        const nextP1 = movesPoint1 ? baseCursor : originalP1;
        const nextP2 = movesPoint1 ? originalP2 : baseCursor;
        const nextWp = pointOnParallel(nextP1, nextP2, offset, 1) ?? originalWp;
        previewAtPixels(channel, nextP1, nextP2, nextWp);
      },
      onEnd: (_event, moved) => {
        const current = parallelChannels.find((item) => item.id === id);
        if (current && moved && latestEvent) {
          const x = snapXToNearestCandle(chart, latestEvent.clientX - rect.left);
          const y = latestEvent.clientY - rect.top;
          const cursor = { x, y };
          const baseCursor = corner.startsWith("edge2")
            ? { x: cursor.x, y: cursor.y - offset }
            : cursor;
          const movesPoint1 = corner.endsWith("Start");
          const nextP1 = movesPoint1 ? baseCursor : originalP1;
          const nextP2 = movesPoint1 ? originalP2 : baseCursor;
          const p1Data = movesPoint1 ? pixelToDataPoint(baseCursor) : current.point1;
          const p2Data = movesPoint1 ? current.point2 : pixelToDataPoint(baseCursor);
          const nextWp = pointOnParallel(nextP1, nextP2, offset, 1);
          const wpData = nextWp ? pixelToDataPoint(nextWp) : null;
          if (p1Data && p2Data && wpData) {
            current.point1 = p1Data;
            current.point2 = p2Data;
            current.widthPoint = wpData;
            callbacks.onUpdate(current);
          }
        }
        syncAll();
      },
    });
  }

  function startDragBody(id: string, startEvent: PointerEvent) {
    const channel = parallelChannels.find((item) => item.id === id);
    if (!channel) return;
    const rect = container.getBoundingClientRect();
    const startX = startEvent.clientX - rect.left;
    const startY = startEvent.clientY - rect.top;
    const origP1 = { ...channel.point1 };
    const origP2 = { ...channel.point2 };
    const p1Px = toPixel(origP1);
    const p2Px = toPixel(origP2);
    const wpPx = toPixel(channel.widthPoint);
    if (!p1Px || !p2Px || !wpPx) return;
    const offset = wpPx.y - p2Px.y;
    let finalDx = 0;
    let finalDy = 0;
    runManagedDragSession(startEvent, (active) => { dragActive = active; }, {
      target: startEvent.target as Element,
      moveThreshold: 3,
      onMove: (event) => {
        finalDx = snapXToNearestCandle(chart, p1Px.x + (event.clientX - rect.left) - startX) - p1Px.x;
        finalDy = (event.clientY - rect.top) - startY;
        previewAtPixels(
          channel,
          { x: p1Px.x + finalDx, y: p1Px.y + finalDy },
          { x: p2Px.x + finalDx, y: p2Px.y + finalDy },
          pointOnParallel(
            { x: p1Px.x + finalDx, y: p1Px.y + finalDy },
            { x: p2Px.x + finalDx, y: p2Px.y + finalDy },
            offset,
            1,
          ) ?? { x: wpPx.x + finalDx, y: wpPx.y + finalDy },
        );
      },
      onEnd: (_event, moved) => {
        const current = parallelChannels.find((item) => item.id === id);
        if (current && moved) {
          const nextP1 = { x: p1Px.x + finalDx, y: p1Px.y + finalDy };
          const nextP2 = { x: p2Px.x + finalDx, y: p2Px.y + finalDy };
          const p1Data = pixelToDataPoint(nextP1);
          const p2Data = pixelToDataPoint(nextP2);
          const nextWp = pointOnParallel(nextP1, nextP2, offset, 1);
          const wpData = nextWp ? pixelToDataPoint(nextWp) : null;
          if (p1Data && p2Data && wpData) {
            current.point1 = p1Data;
            current.point2 = p2Data;
            current.widthPoint = wpData;
            callbacks.onUpdate(current);
          }
        }
        syncAll();
      },
    });
  }

  function clickToPoint(event: any): { time: number; price: number } | null {
    const rect = container.getBoundingClientRect();
    const sourceEvent = event.sourceEvent as PointerEvent | undefined;
    const x = sourceEvent ? sourceEvent.clientX - rect.left : null;
    const y = sourceEvent ? sourceEvent.clientY - rect.top : null;
    const time = x != null ? xToSnappedTime(chart, x, candleStore.candles) : (event.time as number | undefined);
    const price = y != null ? pxToPrice(series, y) : (event.seriesData?.get(series)?.close as number | undefined);
    if (time == null || price == null || price <= 0) return null;
    return { time, price };
  }

  function handleDrawClick(event: any) {
    if (manager.getMode() !== "parallelchannel") return;
    if (isChannelHandleTarget(event.sourceEvent?.target ?? null)) return;
    const point = clickToPoint(event);
    if (!point) return;

    if (!drawPoint1) {
      drawPoint1 = point;
      ghostBaseLine = document.createElementNS(SVG_NS, "line");
      ghostBaseLine.setAttribute("class", "pc-ghost-line");
      svg.appendChild(ghostBaseLine);
      const px = toPixel(drawPoint1);
      if (px) {
        setLineEndpoints(ghostBaseLine, px, px);
      }
      return;
    }

    if (!drawPoint2) {
      drawPoint2 = point;
      return;
    }

    const p1px = toPixel(drawPoint1);
    const p2px = toPixel(drawPoint2);
    const rect = container.getBoundingClientRect();
    const sourceEvent = event.sourceEvent as PointerEvent | undefined;
    const cursor = sourceEvent
      ? { x: sourceEvent.clientX - rect.left, y: sourceEvent.clientY - rect.top }
      : null;
    const widthPoint = p1px && p2px && cursor
      ? widthPointFromPixels(p1px, p2px, cursor)
      : point;

    const tpl = getDefaultDrawingTemplateState("parallelchannel");
    const newChannel: ParallelChannel = {
      id: crypto.randomUUID(),
      datasetId,
      point1: drawPoint1,
      point2: drawPoint2,
      widthPoint: widthPoint ?? point,
      color: tpl.lineColor,
      fillColor: tpl.fillColor ?? "#787b86",
      fillOpacity: tpl.fillOpacity ?? 20,
      width: tpl.width,
      lineStyle: tpl.style,
      extendLeft: false,
      extendRight: false,
      locked: false,
    };
    parallelChannels.push(newChannel);
    callbacks.onCreate(newChannel);
    drawPoint1 = null;
    drawPoint2 = null;
    removeGhost();
    selectChannel(newChannel.id);
    syncAll();
    callbacks.onDrawingComplete();
  }

  function handleMouseMove(event: MouseEvent) {
    if (dragActive) return;
    const rect = container.getBoundingClientRect();
    const x = snapXToNearestCandle(chart, event.clientX - rect.left);
    const y = event.clientY - rect.top;
    const cursor = { x, y };

    if (drawPoint1 && !drawPoint2 && ghostBaseLine) {
      const p1 = toPixel(drawPoint1);
      if (p1) setLineEndpoints(ghostBaseLine, p1, cursor);
      return;
    }

    if (drawPoint1 && drawPoint2) {
      const p1 = toPixel(drawPoint1);
      const p2 = toPixel(drawPoint2);
      if (p1 && p2) renderGhostWidth(p1, p2, cursor);
    }
  }

  function handleBackgroundClick(event: PointerEvent) {
    if (manager.getMode() !== "none") return;
    const target = event.target as Element;
    if (target.closest(".trend-toolbar") || target.closest(".pc-hit-area") || target.closest(".rect-handle-el") || target.closest(".pc-mid-handle")) return;
    if (selectedId) selectChannel(null);
  }

  const cleanupDrawingClick = bindDrawingPointerClick({
    container,
    chart,
    manager,
    mode: "parallelchannel",
    onClick: handleDrawClick,
  });
  container.addEventListener("mousemove", handleMouseMove);
  container.addEventListener("pointerdown", handleBackgroundClick);

  return () => {
    unregisterLifecycle();
    cleanupDrawingClick();
    container.removeEventListener("mousemove", handleMouseMove);
    container.removeEventListener("pointerdown", handleBackgroundClick);
    overlay.remove();
    toolbarController.destroy();
    removeToolbar();
    removeGhost();
  };
}
