import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { HorizontalLine } from "../../types";
import { DrawingToolbarController, type DrawingToolbarPatch } from "../shared/DrawingToolbarController";
import { bindDrawingPointerClick } from "../shared/drawingPointerClick";
import { getDefaultDrawingTemplateState } from "../shared/drawingTemplates";
import {
  attachManagedDrawingLifecycle,
  createClipboardBridge,
  getPlotWidth,
  runManagedDragSession,
} from "../shared/ManagedDrawingTool";
import type { ChartCandleStore, DrawingCrudCallbacks, DrawingMode, ManagedDrawingToolOptions } from "../shared/types";

export type HorizontalLineCallbacks = DrawingCrudCallbacks<HorizontalLine>;

interface HorizontalLineEls {
  line: HTMLDivElement;
  hit: HTMLDivElement;
  marker: HTMLButtonElement;
  priceLabel: HTMLButtonElement;
}

function applyLineStyle(
  element: HTMLDivElement,
  color: string,
  width: number,
  style: HorizontalLine["lineStyle"],
) {
  element.style.borderTopColor = color;
  element.style.borderTopWidth = `${width}px`;
  element.style.borderTopStyle = style === "dotted" ? "dotted" : style === "dashed" ? "dashed" : "solid";
}

export function attachHorizontalLineTool(opts: ManagedDrawingToolOptions & {
  container: HTMLDivElement;
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  candleStore: ChartCandleStore;
  horizontalLines: HorizontalLine[];
  drawingMode: DrawingMode;
  datasetId: string;
  pricePrecision: number;
  callbacks: HorizontalLineCallbacks;
}): () => void {
  const { container, chart, series, candleStore, datasetId, pricePrecision, callbacks, manager } = opts;
  let lines = [...opts.horizontalLines];
  let selectedId: string | null = null;
  let dragActive = false;
  const elementsById = new Map<string, HorizontalLineEls>();

  function syncOne(line: HorizontalLine) {
    let els = elementsById.get(line.id);
    if (!els) {
      els = buildElements(line);
      elementsById.set(line.id, els);
    }

    const y = series.priceToCoordinate(line.price);
    if (y == null) {
      els.line.style.display = "none";
      els.hit.style.display = "none";
      els.marker.style.display = "none";
      els.priceLabel.style.display = "none";
      return;
    }

    const plotWidth = getPlotWidth(chart);
    els.line.style.display = "";
    els.line.style.top = `${y}px`;
    els.line.style.width = `${plotWidth}px`;
    applyLineStyle(els.line, line.color, line.width, line.lineStyle);
    els.line.classList.toggle("selected", selectedId === line.id);

    els.hit.style.display = "";
    els.hit.style.top = `${y - 5}px`;
    els.hit.style.width = `${plotWidth}px`;
    els.hit.style.cursor = line.locked ? "default" : dragActive ? "grabbing" : "grab";

    const isSelected = selectedId === line.id;
    els.marker.style.display = isSelected ? "" : "none";
    els.marker.style.top = `${y}px`;
    els.marker.style.left = `${Math.max(8, plotWidth - 132)}px`;
    els.marker.style.cursor = line.locked ? "default" : "ns-resize";

    els.priceLabel.style.display = "";
    els.priceLabel.style.top = `${y}px`;
    els.priceLabel.style.left = `${plotWidth + 4}px`;
    els.priceLabel.style.borderColor = line.color;
    els.priceLabel.style.color = line.color;
    els.priceLabel.textContent = line.price.toFixed(pricePrecision);
    els.priceLabel.classList.toggle("selected", isSelected);
    els.priceLabel.style.cursor = line.locked ? "default" : "grab";
  }

  function syncAll() {
    lines.forEach(syncOne);
  }

  function patchLine(id: string, patch: Partial<HorizontalLine>) {
    const index = lines.findIndex((item) => item.id === id);
    if (index < 0) return;
    lines[index] = { ...lines[index], ...patch };
    callbacks.onUpdate(lines[index]);
    syncAll();
    if (selectedId === id) toolbarController.refresh();
  }

  function patchLineFromToolbar(line: HorizontalLine, patch: DrawingToolbarPatch) {
    patchLine(line.id, {
      ...(patch.lineColor != null ? { color: patch.lineColor } : {}),
      ...(patch.width != null ? { width: patch.width } : {}),
      ...(patch.style != null ? { lineStyle: patch.style } : {}),
      ...(patch.locked != null ? { locked: patch.locked } : {}),
    });
  }

  function deleteLine(id: string) {
    lines = lines.filter((item) => item.id !== id);
    const els = elementsById.get(id);
    if (els) {
      els.line.remove();
      els.hit.remove();
      els.marker.remove();
      els.priceLabel.remove();
      elementsById.delete(id);
    }
    if (selectedId === id) {
      selectedId = null;
      toolbarController.hide();
      manager.clearSelection("horizontalline");
    }
    callbacks.onDelete(id);
  }

  function purgeAll() {
    for (const els of elementsById.values()) {
      els.line.remove();
      els.hit.remove();
      els.marker.remove();
      els.priceLabel.remove();
    }
    elementsById.clear();
    lines = [];
    selectedId = null;
    toolbarController.hide();
    manager.clearSelection("horizontalline");
  }

  function selectLine(id: string | null) {
    if (!id) {
      if (selectedId !== null) {
        selectedId = null;
        toolbarController.hide();
        syncAll();
      }
      manager.clearSelection("horizontalline");
      return;
    }

    selectedId = id;
    const line = lines.find((item) => item.id === id);
    if (line) toolbarController.show(line);
    manager.activateSelection("horizontalline", null, id);
    syncAll();
  }

  function buildElements(line: HorizontalLine): HorizontalLineEls {
    const lineEl = document.createElement("div");
    lineEl.className = "hline-line";

    const hit = document.createElement("div");
    hit.className = "hline-hit";

    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "hline-marker";
    marker.setAttribute("aria-label", "Переместить горизонтальную линию");

    const priceLabel = document.createElement("button");
    priceLabel.type = "button";
    priceLabel.className = "hline-price-label";

    container.append(lineEl, hit, marker, priceLabel);

    const startDrag = (event: PointerEvent) => {
      if (!manager.canEditExistingDrawings()) return;
      event.preventDefault();
      event.stopPropagation();
      const current = lines.find((item) => item.id === line.id);
      if (!current) return;
      selectLine(line.id);
      if (current.locked) return;

      let draft = { ...current };
      runManagedDragSession(event, (active) => { dragActive = active; }, {
        target: event.currentTarget as Element,
        onMove: (moveEvent) => {
          const bounds = container.getBoundingClientRect();
          const price = series.coordinateToPrice(moveEvent.clientY - bounds.top);
          if (price == null || price <= 0) return;
          draft = { ...draft, price };
          syncOne(draft);
        },
        onEnd: (_event, moved) => {
          if (!moved) return;
          const index = lines.findIndex((item) => item.id === line.id);
          if (index < 0) return;
          lines[index] = draft;
          callbacks.onUpdate(draft);
          syncAll();
        },
      });
    };

    hit.addEventListener("pointerdown", startDrag);
    marker.addEventListener("pointerdown", startDrag);
    priceLabel.addEventListener("pointerdown", startDrag);

    return { line: lineEl, hit, marker, priceLabel };
  }

  const toolbarController = new DrawingToolbarController<HorizontalLine>({
    container,
    preset: "stroke",
    className: "hline-toolbar",
    templateKind: "horizontalline",
    persistenceKey: (line) => `horizontal-line:${line.id}`,
    getState: (line) => ({
      lineColor: line.color,
      width: line.width,
      style: line.lineStyle,
      locked: Boolean(line.locked),
    }),
    onPatch: patchLineFromToolbar,
    onDelete: (line) => deleteLine(line.id),
    onSync: syncAll,
  });

  const unregisterLifecycle = attachManagedDrawingLifecycle({
    manager,
    kind: "horizontalline",
    bridge: createClipboardBridge({
      kind: "horizontalline",
      datasetId,
      candleStore,
      getSelectedId: () => selectedId,
      findById: (id) => lines.find((item) => item.id === id),
      append: (line) => { lines.push(line); },
      onCreate: callbacks.onCreate,
      select: (id) => selectLine(id),
      deleteSelected: () => { if (selectedId) deleteLine(selectedId); },
      createFromClipboard: (data) => ({ ...data, id: crypto.randomUUID(), datasetId }),
      syncAll,
    }),
    syncAll,
    isDragActive: () => dragActive,
    onDeselect: () => {
      if (selectedId === null) return;
      selectedId = null;
      toolbarController.hide();
      syncAll();
    },
    purgeAll,
  });

  const unbindCreateClick = bindDrawingPointerClick({
    container,
    chart,
    manager,
    mode: "horizontalline",
    onClick: ({ sourceEvent }) => {
      const bounds = container.getBoundingClientRect();
      const price = series.coordinateToPrice(sourceEvent.clientY - bounds.top);
      if (price == null || price <= 0) return;
      const template = getDefaultDrawingTemplateState("horizontalline");
      const created: HorizontalLine = {
        id: crypto.randomUUID(),
        datasetId,
        price,
        color: template.lineColor,
        width: template.width,
        lineStyle: template.style,
      };
      lines.push(created);
      callbacks.onCreate(created);
      syncAll();
      selectLine(created.id);
      callbacks.onDrawingComplete();
    },
  });

  const onContainerPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".hline-toolbar, .hline-hit, .hline-marker, .hline-price-label")) return;
    if (selectedId) selectLine(null);
  };
  container.addEventListener("pointerdown", onContainerPointerDown);

  syncAll();

  return () => {
    unregisterLifecycle();
    unbindCreateClick();
    container.removeEventListener("pointerdown", onContainerPointerDown);
    toolbarController.destroy();
    for (const els of elementsById.values()) {
      els.line.remove();
      els.hit.remove();
      els.marker.remove();
      els.priceLabel.remove();
    }
    elementsById.clear();
  };
}
