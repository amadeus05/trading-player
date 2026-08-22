/**
 * VolumeProfileTool – draws a time-range volume profile (buy/sell histogram per price
 * row, POC and value-area lines) similar to a TradingView "Session Volume Profile".
 */

import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Candle, VolumeProfile } from "../../types";
import { snapXToNearestCandle, timeToX, xToSnappedTime } from "../shared/coordinates";
import { attachManagedDrawingLifecycle, createClipboardBridge, getPlotWidth, runManagedDragSession } from "../shared/ManagedDrawingTool";
import { createDrawingOverlay } from "../shared/overlay";
import { forgetFloatingPanelPosition } from "../shared/floatingPanel";
import { createDrawingSession } from "../shared/drawingSession";
import type { DrawingCrudCallbacks, ManagedDrawingToolOptions, ChartCandleStore, DrawingMode } from "../shared/types";
import { DrawingToolbarController, type DrawingToolbarPatch } from "../shared/DrawingToolbarController";
import { mountDrawingSettingsPanel, type DrawingSettingsPanelController, type DrawingSettingsTabId } from "../shared/DrawingSettingsPanel";
import { computeVolumeProfile, type VolumeProfileResult } from "./computeVolumeProfile";
import { hexToRgba } from "../shared/colorUtils";
import { createSelectionController } from "../shared/selection";

export type VolumeProfileCallbacks = DrawingCrudCallbacks<VolumeProfile>;

const SVG_NS = "http://www.w3.org/2000/svg";
const TV_HANDLE_RADIUS = 5;
const EDGE_HIT_WIDTH = 12;
const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M18 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-1 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"></path><path fill-rule="evenodd" d="M8.5 5h11l5 9-5 9h-11l-5-9 5-9Zm-3.86 9L9.1 6h9.82l4.45 8-4.45 8H9.1l-4.45-8Z"></path></svg>`;

export const VOLUME_PROFILE_DEFAULTS: Omit<VolumeProfile, "id" | "datasetId" | "timeLeft" | "timeRight"> = {
  rows: 60,
  valueAreaPct: 0.70,
  side: "left",
  splitMode: "candle",
  profileWidthPct: 0.25,
  showPoc: true,
  showValueAreaBg: true,
  showValueAreaLines: true,
  buyColor: "#26C6DA",
  sellColor: "#F06292",
  pocColor: "#FFFFFF",
  valueAreaBgColor: "#90CAF9",
  valueAreaLineColor: "#42A5F5",
};

interface BinEls {
  buy: SVGRectElement;
  sell: SVGRectElement;
}

interface VpEdgeEls {
  hit: SVGRectElement;
  line: SVGLineElement;
  grips: SVGCircleElement[];
}

interface VpEls {
  group: SVGGElement;
  binsGroup: SVGGElement;
  bins: BinEls[];
  vaBg: SVGRectElement;
  pocLine: SVGLineElement;
  vaHighLine: SVGLineElement;
  vaLowLine: SVGLineElement;
  bodyHit: SVGRectElement;
  leftEdge: VpEdgeEls;
  rightEdge: VpEdgeEls;
}

interface PixelSpan { left: number; right: number; }

function upperBoundByTime(candles: Candle[], time: number): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (candles[mid].time <= time) low = mid + 1;
    else high = mid;
  }
  return low;
}

function lowerBoundByTime(candles: Candle[], time: number): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (candles[mid].time < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function attachVolumeProfileTool(opts: ManagedDrawingToolOptions & {
  container: HTMLDivElement;
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  candleStore: ChartCandleStore;
  /**
   * Свечи, по которым считается гистограмма, на запрошенном окне (секунды,
   * границы включительно). Отдаёт базовый таймфрейм, если он на это окно
   * загружен, иначе свечи самого графика — тогда профиль просто грубее.
   */
  getProfileCandles: (fromTime: number, toTime: number) => Candle[];
  getReplayEndTime: () => number | null;
  volumeProfiles: VolumeProfile[];
  drawingMode: DrawingMode;
  datasetId: string;
  callbacks: VolumeProfileCallbacks;
}): () => void {
  const { container, chart, series, candleStore, getProfileCandles, getReplayEndTime, datasetId, callbacks, manager } = opts;
  let profiles = [...opts.volumeProfiles];

  const getPlotWidthLocal = () => getPlotWidth(chart);
  const overlay = createDrawingOverlay(container, chart, "vp-overlay");
  const { svg } = overlay;

  let dragActive = false;
  let panelEl: HTMLDivElement | null = null;
  let settingsPanel: DrawingSettingsPanelController | null = null;
  let toolbarController: DrawingToolbarController<VolumeProfile>;

  let ghostEl: SVGRectElement | null = null;

  const elMap = new Map<string, VpEls>();
  const computedCache = new Map<string, { sig: string; result: VolumeProfileResult | null }>();

  function getAvailableWindow(vp: VolumeProfile): { left: number; right: number } | null {
    const left = Math.min(vp.timeLeft, vp.timeRight);
    const selectedRight = Math.max(vp.timeLeft, vp.timeRight);
    const replayEndTime = getReplayEndTime();
    const right = replayEndTime == null ? selectedRight : Math.min(selectedRight, replayEndTime);
    if (right < left) return null;
    return { left, right };
  }

  function getComputed(vp: VolumeProfile): VolumeProfileResult | null {
    const window = getAvailableWindow(vp);
    if (!window) return null;
    const source = getProfileCandles(window.left, window.right);
    const fromIndex = lowerBoundByTime(source, window.left);
    const toIndex = upperBoundByTime(source, window.right);
    const windowCandles = fromIndex < toIndex ? source.slice(fromIndex, toIndex) : [];
    // Число свечей в сигнатуре не только страхует от устаревания: когда базовое
    // окно доезжает, свечей на том же диапазоне становится в разы больше — и
    // кэш сбрасывается сам, без отдельного оповещения от источника.
    const sig = `${window.left}|${window.right}|${vp.rows}|${vp.valueAreaPct}|${vp.splitMode}|${windowCandles.length}|${windowCandles.at(-1)?.time ?? 0}`;
    const cached = computedCache.get(vp.id);
    if (cached && cached.sig === sig) return cached.result;
    const result = computeVolumeProfile(windowCandles, window.left, window.right, vp.rows, vp.valueAreaPct, vp.splitMode);
    computedCache.set(vp.id, { sig, result });
    return result;
  }

  function invalidate(id: string) {
    computedCache.delete(id);
  }

  function getSpan(vp: VolumeProfile): PixelSpan | null {
    const xLeft = timeToX(chart, vp.timeLeft, candleStore.candles);
    const xRight = timeToX(chart, vp.timeRight, candleStore.candles);
    if (xLeft == null || xRight == null) return null;
    return { left: Math.min(xLeft, xRight), right: Math.max(xLeft, xRight) };
  }

  function getAvailableSpan(vp: VolumeProfile): PixelSpan | null {
    const window = getAvailableWindow(vp);
    if (!window) return null;
    const xLeft = timeToX(chart, window.left, candleStore.candles);
    const xRight = timeToX(chart, window.right, candleStore.candles);
    if (xLeft == null || xRight == null) return null;
    return { left: Math.min(xLeft, xRight), right: Math.max(xLeft, xRight) };
  }

  function buildEls(vp: VolumeProfile): VpEls {
    const group = overlay.createClippedGroup();
    group.dataset.vpId = vp.id;
    const binsGroup = document.createElementNS(SVG_NS, "g");
    const vaBg = document.createElementNS(SVG_NS, "rect");
    vaBg.setAttribute("pointer-events", "none");
    const pocLine = document.createElementNS(SVG_NS, "line");
    pocLine.setAttribute("pointer-events", "none");
    const vaHighLine = document.createElementNS(SVG_NS, "line");
    vaHighLine.setAttribute("pointer-events", "none");
    vaHighLine.setAttribute("stroke-dasharray", "4 3");
    const vaLowLine = document.createElementNS(SVG_NS, "line");
    vaLowLine.setAttribute("pointer-events", "none");
    vaLowLine.setAttribute("stroke-dasharray", "4 3");
    const bodyHit = document.createElementNS(SVG_NS, "rect");
    bodyHit.setAttribute("class", "vp-hit-el");
    bodyHit.setAttribute("fill", "transparent");
    const leftEdge = makeEdgeEls();
    const rightEdge = makeEdgeEls();

    group.append(
      vaBg, binsGroup, pocLine, vaHighLine, vaLowLine, bodyHit,
      leftEdge.hit, rightEdge.hit, leftEdge.line, rightEdge.line,
      ...leftEdge.grips, ...rightEdge.grips,
    );

    bodyHit.addEventListener("pointerdown", (e) => {
      if (!manager.canEditExistingDrawings()) return;
      e.stopPropagation(); e.preventDefault();
      const v = profiles.find((item) => item.id === vp.id);
      if (!v) return;
      selectProfile(vp.id);
      if (v.locked) return;
      startBodyDrag(vp.id, e as PointerEvent);
    });
    bindEdgePointer(leftEdge, vp.id, "left");
    bindEdgePointer(rightEdge, vp.id, "right");

    return { group, binsGroup, bins: [], vaBg, pocLine, vaHighLine, vaLowLine, bodyHit, leftEdge, rightEdge };
  }

  /** Как у TV: тонкая граница диапазона и кружки, без залитого столбика. */
  function makeEdgeEls(): VpEdgeEls {
    const hit = document.createElementNS(SVG_NS, "rect");
    hit.setAttribute("class", "vp-handle-el");
    hit.setAttribute("fill", "transparent");
    hit.style.cursor = "ew-resize";
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "vp-edge-line");
    line.setAttribute("pointer-events", "none");
    const grips = [0, 1, 2].map(() => {
      const grip = document.createElementNS(SVG_NS, "circle");
      grip.setAttribute("class", "rect-handle-el vp-handle-el");
      grip.setAttribute("r", String(TV_HANDLE_RADIUS));
      grip.style.cursor = "ew-resize";
      return grip;
    });
    return { hit, line, grips };
  }

  function bindEdgePointer(edgeEls: VpEdgeEls, id: string, edge: "left" | "right") {
    const onDown = (e: Event) => {
      if (!manager.canEditExistingDrawings()) return;
      e.stopPropagation();
      e.preventDefault();
      const v = profiles.find((item) => item.id === id);
      if (!v || v.locked) return;
      selectProfile(id);
      startEdgeDrag(id, edge, e as PointerEvent);
    };
    edgeEls.hit.addEventListener("pointerdown", onDown);
    edgeEls.grips.forEach((grip) => grip.addEventListener("pointerdown", onDown));
  }

  function layoutEdge(edgeEls: VpEdgeEls, x: number, top: number, height: number, visible: boolean) {
    const show = visible ? "" : "none";
    edgeEls.hit.setAttribute("x", String(x - EDGE_HIT_WIDTH / 2));
    edgeEls.hit.setAttribute("y", String(top));
    edgeEls.hit.setAttribute("width", String(EDGE_HIT_WIDTH));
    edgeEls.hit.setAttribute("height", String(Math.max(0, height)));
    edgeEls.hit.style.display = show;
    edgeEls.line.setAttribute("x1", String(x));
    edgeEls.line.setAttribute("x2", String(x));
    edgeEls.line.setAttribute("y1", String(top));
    edgeEls.line.setAttribute("y2", String(top + height));
    edgeEls.line.style.display = show;
    const ys = [top, top + height / 2, top + height];
    edgeEls.grips.forEach((grip, index) => {
      grip.setAttribute("cx", String(x));
      grip.setAttribute("cy", String(ys[index]));
      grip.style.display = show;
    });
  }

  function ensureBinCount(els: VpEls, count: number) {
    if (els.bins.length === count) return;
    els.binsGroup.replaceChildren();
    els.bins = Array.from({ length: count }, () => {
      const buy = document.createElementNS(SVG_NS, "rect");
      buy.setAttribute("pointer-events", "none");
      const sell = document.createElementNS(SVG_NS, "rect");
      sell.setAttribute("pointer-events", "none");
      els.binsGroup.append(buy, sell);
      return { buy, sell };
    });
  }

  function setRect(el: SVGRectElement, x1: number, x2: number, y: number, h: number, color: string, opacityPct: number) {
    el.setAttribute("x", String(Math.min(x1, x2)));
    el.setAttribute("y", String(y));
    el.setAttribute("width", String(Math.max(0, Math.abs(x2 - x1))));
    el.setAttribute("height", String(Math.max(0, h)));
    el.setAttribute("fill", hexToRgba(color, opacityPct));
    el.style.display = "";
  }

  function hideRect(el: SVGRectElement) {
    el.style.display = "none";
  }

  function setLine(el: SVGLineElement, x1: number, x2: number, y: number, color: string, width: number) {
    el.setAttribute("x1", String(x1));
    el.setAttribute("x2", String(x2));
    el.setAttribute("y1", String(y));
    el.setAttribute("y2", String(y));
    el.setAttribute("stroke", color);
    el.setAttribute("stroke-width", String(width));
    el.style.display = "";
  }

  function hideEls(els: VpEls) {
    els.group.setAttribute("visibility", "hidden");
  }

  function syncOne(vp: VolumeProfile) {
    let els = elMap.get(vp.id);
    if (!els) { els = buildEls(vp); elMap.set(vp.id, els); }
    const span = getAvailableSpan(vp);
    if (!span) { hideEls(els); return; }
    const { left, right } = span;
    const computed = getComputed(vp);
    if (!computed) { hideEls(els); return; }
    els.group.setAttribute("visibility", "visible");

    ensureBinCount(els, computed.bins.length);
    const maxProfilePx = Math.max(4, (right - left) * vp.profileWidthPct);
    computed.bins.forEach((bin, i) => {
      const binEls = els!.bins[i];
      const yTop = series.priceToCoordinate(bin.high);
      const yBottom = series.priceToCoordinate(bin.low);
      const tv = bin.buyVolume + bin.sellVolume;
      if (yTop == null || yBottom == null || tv <= 0 || computed.maxVolume <= 0) {
        hideRect(binEls.buy);
        hideRect(binEls.sell);
        return;
      }
      const rowH = Math.abs(yBottom - yTop);
      const inset = rowH * 0.1;
      const y = Math.min(yTop, yBottom) + inset;
      const h = Math.max(1, rowH - inset * 2);
      const twPx = maxProfilePx * (tv / computed.maxVolume);
      const bwPx = twPx * (bin.buyVolume / tv);
      const swPx = twPx - bwPx;
      if (vp.side === "left") {
        setRect(binEls.buy, left, left + bwPx, y, h, vp.buyColor, 70);
        setRect(binEls.sell, left + bwPx, left + bwPx + swPx, y, h, vp.sellColor, 70);
      } else {
        setRect(binEls.sell, right - bwPx - swPx, right - bwPx, y, h, vp.sellColor, 70);
        setRect(binEls.buy, right - bwPx, right, y, h, vp.buyColor, 70);
      }
    });

    if (vp.showValueAreaBg) {
      const yHigh = series.priceToCoordinate(computed.valueAreaHigh);
      const yLow = series.priceToCoordinate(computed.valueAreaLow);
      if (yHigh != null && yLow != null) {
        setRect(els.vaBg, left, right, Math.min(yHigh, yLow), Math.abs(yLow - yHigh), vp.valueAreaBgColor, 14);
      } else hideRect(els.vaBg);
    } else hideRect(els.vaBg);

    if (vp.showPoc) {
      const y = series.priceToCoordinate(computed.pocPrice);
      if (y != null) setLine(els.pocLine, left, right, y, vp.pocColor, 2);
      else els.pocLine.style.display = "none";
    } else els.pocLine.style.display = "none";

    if (vp.showValueAreaLines) {
      const yHigh = series.priceToCoordinate(computed.valueAreaHigh);
      const yLow = series.priceToCoordinate(computed.valueAreaLow);
      if (yHigh != null) setLine(els.vaHighLine, left, right, yHigh, vp.valueAreaLineColor, 1);
      else els.vaHighLine.style.display = "none";
      if (yLow != null) setLine(els.vaLowLine, left, right, yLow, vp.valueAreaLineColor, 1);
      else els.vaLowLine.style.display = "none";
    } else {
      els.vaHighLine.style.display = "none";
      els.vaLowLine.style.display = "none";
    }

    // Keep the hit-box and edge handles within the profile's own price range
    // (like TradingView) instead of the full chart height — otherwise they sit
    // on top of empty space and block dragging/scrolling the chart there.
    const yRangeTop = series.priceToCoordinate(computed.rangeHigh);
    const yRangeBottom = series.priceToCoordinate(computed.rangeLow);
    if (yRangeTop == null || yRangeBottom == null) {
      els.bodyHit.style.display = "none";
      layoutEdge(els.leftEdge, 0, 0, 0, false);
      layoutEdge(els.rightEdge, 0, 0, 0, false);
      els.group.classList.toggle("vp-selected", selection.isSelected(vp.id));
      return;
    }
    const top = Math.min(yRangeTop, yRangeBottom);
    const rangeHeight = Math.abs(yRangeBottom - yRangeTop);

    els.bodyHit.setAttribute("x", String(left));
    els.bodyHit.setAttribute("y", String(top));
    els.bodyHit.setAttribute("width", String(Math.max(0, right - left)));
    els.bodyHit.setAttribute("height", String(rangeHeight));
    els.bodyHit.style.display = "";
    els.bodyHit.style.cursor = vp.locked ? "default" : "move";

    const selected = selection.isSelected(vp.id);
    const showHandles = selected && !vp.locked;
    layoutEdge(els.leftEdge, left, top, rangeHeight, showHandles);
    layoutEdge(els.rightEdge, right, top, rangeHeight, showHandles);
    els.group.classList.toggle("vp-selected", selected);
  }

  function syncAll() {
    overlay.sync();
    profiles.forEach(syncOne);
    const selectedId = selection.getSelectedId();
    if (selectedId) positionPanel(selectedId);
  }

  const selection = createSelectionController<VolumeProfile>({
    kind: "volumeprofile",
    manager,
    container,
    findById: (id) => profiles.find((item) => item.id === id),
    getSelectionElement: (id) => elMap.get(id)?.group ?? null,
    onShow: (vp) => toolbarController.show(vp),
    onHide: () => {
      removePanel();
      toolbarController.hide();
    },
    syncAll,
    ignoreSelector: ".vp-hit-el, .vp-handle-el",
  });
  const selectProfile = selection.select;

  function deleteProfile(id: string) {
    profiles = profiles.filter((p) => p.id !== id);
    forgetFloatingPanelPosition(`volumeprofile:${id}`);
    forgetFloatingPanelPosition(`volumeprofile-toolbar:${id}`);
    invalidate(id);
    const els = elMap.get(id);
    if (els) { els.group.remove(); elMap.delete(id); }
    selection.handleDeleted(id);
    callbacks.onDelete(id);
  }

  function purgeAll() {
    for (const [id, els] of elMap) {
      forgetFloatingPanelPosition(`volumeprofile:${id}`);
      forgetFloatingPanelPosition(`volumeprofile-toolbar:${id}`);
      els.group.remove();
    }
    elMap.clear();
    computedCache.clear();
    profiles = [];
    selection.reset();
    syncAll();
  }

  function patchProfile(vp: VolumeProfile, patch: Partial<VolumeProfile>) {
    const idx = profiles.findIndex((item) => item.id === vp.id);
    if (idx < 0) return;
    profiles[idx] = { ...profiles[idx], ...patch };
    invalidate(vp.id);
    callbacks.onUpdate(profiles[idx]);
    syncAll();
    if (selection.isSelected(vp.id)) refreshPanelValues(profiles[idx]);
    toolbarController.refresh();
  }

  // ---- selection + settings panel ----

  function removePanel() {
    settingsPanel?.destroy();
    settingsPanel = null;
    panelEl = null;
  }

  function toggleSettingsPanel(vp: VolumeProfile) {
    if (panelEl) {
      removePanel();
      return;
    }
    createPanel(vp);
  }

  function patchProfileFromToolbar(vp: VolumeProfile, patch: DrawingToolbarPatch) {
    const nextPatch: Partial<VolumeProfile> = {};
    if (patch.locked != null) nextPatch.locked = patch.locked;
    if (Object.keys(nextPatch).length === 0) return;
    patchProfile(vp, nextPatch);
  }

  function positionPanel(id: string) {
    const span = elMap.has(id) ? getSpan(profiles.find((p) => p.id === id)!) : null;
    if (!panelEl || !span) return;
    // mountFloatingPanel already clamps/remembers position; nothing extra to do here.
  }

  function field(labelText: string): { row: HTMLDivElement; control: HTMLDivElement } {
    const row = document.createElement("div");
    row.className = "vp-panel-row";
    const label = document.createElement("span");
    label.className = "vp-panel-label";
    label.textContent = labelText;
    const control = document.createElement("div");
    control.className = "vp-panel-control";
    row.append(label, control);
    return { row, control };
  }

  function refreshPanelValues(vp: VolumeProfile) {
    if (!panelEl) return;
    const set = (sel: string, value: string | number | boolean) => {
      const el = panelEl!.querySelector<HTMLInputElement | HTMLSelectElement>(sel);
      if (!el) return;
      if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = Boolean(value);
      else el.value = String(value);
    };
    set('[data-f="rows"]', vp.rows);
    set('[data-f="va"]', Math.round(vp.valueAreaPct * 100));
    set('[data-f="side"]', vp.side);
    set('[data-f="split"]', vp.splitMode);
    set('[data-f="width"]', Math.round(vp.profileWidthPct * 100));
    set('[data-f="showPoc"]', vp.showPoc);
    set('[data-f="showVaBg"]', vp.showValueAreaBg);
    set('[data-f="showVaLines"]', vp.showValueAreaLines);
    set('[data-f="buyColor"]', vp.buyColor);
    set('[data-f="sellColor"]', vp.sellColor);
    set('[data-f="pocColor"]', vp.pocColor);
    set('[data-f="vaBgColor"]', vp.valueAreaBgColor);
    set('[data-f="vaLineColor"]', vp.valueAreaLineColor);
  }

  function renderPanelPlaceholder(tabId: DrawingSettingsTabId, body: HTMLDivElement) {
    const placeholder = document.createElement("div");
    placeholder.className = "drawing-settings-placeholder";
    placeholder.textContent = `${tabId[0].toUpperCase()}${tabId.slice(1)} settings will be configured here.`;
    body.appendChild(placeholder);
  }

  function renderStylePanel(vp: VolumeProfile, body: HTMLDivElement) {
    const current = () => profiles.find((p) => p.id === vp.id) ?? vp;

    const rowsField = field("Rows");
    const rowsInput = document.createElement("input");
    rowsInput.type = "number"; rowsInput.min = "10"; rowsInput.max = "200"; rowsInput.dataset.f = "rows";
    rowsInput.value = String(vp.rows);
    rowsInput.addEventListener("change", () => {
      const n = Math.max(10, Math.min(200, Math.round(Number(rowsInput.value) || 10)));
      patchProfile(current(), { rows: n });
    });
    rowsField.control.appendChild(rowsInput);
    body.appendChild(rowsField.row);

    const vaField = field("Value area %");
    const vaInput = document.createElement("input");
    vaInput.type = "number"; vaInput.min = "50"; vaInput.max = "95"; vaInput.step = "5"; vaInput.dataset.f = "va";
    vaInput.value = String(Math.round(vp.valueAreaPct * 100));
    vaInput.addEventListener("change", () => {
      const n = Math.max(50, Math.min(95, Number(vaInput.value) || 70));
      patchProfile(current(), { valueAreaPct: n / 100 });
    });
    vaField.control.appendChild(vaInput);
    body.appendChild(vaField.row);

    const sideField = field("Side");
    const sideSelect = document.createElement("select");
    sideSelect.dataset.f = "side";
    [["left", "Left"], ["right", "Right"]].forEach(([value, label]) => {
      const o = document.createElement("option"); o.value = value; o.textContent = label; sideSelect.appendChild(o);
    });
    sideSelect.value = vp.side;
    sideSelect.addEventListener("change", () => patchProfile(current(), { side: sideSelect.value as VolumeProfile["side"] }));
    sideField.control.appendChild(sideSelect);
    body.appendChild(sideField.row);

    const splitField = field("Split mode");
    const splitSelect = document.createElement("select");
    splitSelect.dataset.f = "split";
    [["candle", "Candle direction"], ["close", "Close location"]].forEach(([value, label]) => {
      const o = document.createElement("option"); o.value = value; o.textContent = label; splitSelect.appendChild(o);
    });
    splitSelect.value = vp.splitMode;
    splitSelect.addEventListener("change", () => patchProfile(current(), { splitMode: splitSelect.value as VolumeProfile["splitMode"] }));
    splitField.control.appendChild(splitSelect);
    body.appendChild(splitField.row);

    const widthField = field("Profile width %");
    const widthInput = document.createElement("input");
    widthInput.type = "number"; widthInput.min = "5"; widthInput.max = "100"; widthInput.step = "5"; widthInput.dataset.f = "width";
    widthInput.value = String(Math.round(vp.profileWidthPct * 100));
    widthInput.addEventListener("change", () => {
      const n = Math.max(5, Math.min(100, Number(widthInput.value) || 25));
      patchProfile(current(), { profileWidthPct: n / 100 });
    });
    widthField.control.appendChild(widthInput);
    body.appendChild(widthField.row);

    const colorField = (labelText: string, dataF: string, onChange: (value: string) => void, initial: string) => {
      const f = field(labelText);
      const input = document.createElement("input");
      input.type = "color"; input.dataset.f = dataF; input.value = initial;
      input.addEventListener("input", () => onChange(input.value));
      f.control.appendChild(input);
      body.appendChild(f.row);
    };
    colorField("Buy color", "buyColor", (v) => patchProfile(current(), { buyColor: v }), vp.buyColor);
    colorField("Sell color", "sellColor", (v) => patchProfile(current(), { sellColor: v }), vp.sellColor);
    colorField("POC color", "pocColor", (v) => patchProfile(current(), { pocColor: v }), vp.pocColor);
    colorField("VA bg color", "vaBgColor", (v) => patchProfile(current(), { valueAreaBgColor: v }), vp.valueAreaBgColor);
    colorField("VA line color", "vaLineColor", (v) => patchProfile(current(), { valueAreaLineColor: v }), vp.valueAreaLineColor);

    const toggleField = (labelText: string, dataF: string, onChange: (value: boolean) => void, initial: boolean) => {
      const f = field(labelText);
      const input = document.createElement("input");
      input.type = "checkbox"; input.dataset.f = dataF; input.checked = initial;
      input.addEventListener("change", () => onChange(input.checked));
      f.control.appendChild(input);
      body.appendChild(f.row);
    };
    toggleField("Show POC", "showPoc", (v) => patchProfile(current(), { showPoc: v }), vp.showPoc);
    toggleField("Show VA background", "showVaBg", (v) => patchProfile(current(), { showValueAreaBg: v }), vp.showValueAreaBg);
    toggleField("Show VA lines", "showVaLines", (v) => patchProfile(current(), { showValueAreaLines: v }), vp.showValueAreaLines);
  }

  function createPanel(vp: VolumeProfile) {
    removePanel();
    settingsPanel = mountDrawingSettingsPanel({
      container,
      persistenceKey: `volumeprofile:${vp.id}`,
      title: "Volume Profile",
      initialTab: "style",
      tabs: [
        { id: "style", label: "Style" },
        { id: "coordinates", label: "Coordinates" },
        { id: "visibility", label: "Visibility" },
      ],
      renderTab: (tabId, body) => {
        if (tabId === "style") {
          renderStylePanel(vp, body);
          return;
        }
        renderPanelPlaceholder(tabId, body);
      },
      onClose: removePanel,
      onCancel: removePanel,
      onOk: removePanel,
    });
    panelEl = settingsPanel.panel;
  }

  toolbarController = new DrawingToolbarController({
    container,
    preset: "actions",
    className: "vp-toolbar",
    templateKind: "trendline",
    persistenceKey: (vp) => `volumeprofile-toolbar:${vp.id}`,
    getState: (vp) => ({
      lineColor: vp.pocColor,
      width: 1,
      style: "solid",
      locked: Boolean(vp.locked),
    }),
    onPatch: patchProfileFromToolbar,
    onDelete: (vp) => deleteProfile(vp.id),
    onSync: syncAll,
    slots: [{
      id: "settings",
      anchor: "before-lock",
      mount: () => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "rect-tb-settings rect-tb-icon-btn";
        button.title = "Настройки";
        button.innerHTML = SETTINGS_ICON;
        return button;
      },
      bind: (element, ctx) => {
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          ctx.closePopups();
          toggleSettingsPanel(ctx.drawing);
        });
      },
    }],
  });

  const unregisterLifecycle = attachManagedDrawingLifecycle({
    manager,
    kind: "volumeprofile",
    bridge: createClipboardBridge({
      kind: "volumeprofile",
      datasetId,
      candleStore,
      getSelectedId: () => selection.getSelectedId(),
      findById: (id) => profiles.find((item) => item.id === id),
      append: (vp) => { profiles.push(vp); },
      onCreate: callbacks.onCreate,
      select: (id) => selectProfile(id),
      deleteSelected: () => {
        const id = selection.getSelectedId();
        if (id) deleteProfile(id);
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
      purgeAll();
      profiles = (items as VolumeProfile[]).map((item) => ({ ...item }));
      syncAll();
    },
    onDeselect: () => selection.handleManagerDeselect(),
    purgeAll,
  });

  // ---- drag: move whole window / resize one edge ----

  function startBodyDrag(id: string, startEv: PointerEvent) {
    const vp = profiles.find((p) => p.id === id);
    if (!vp) return;
    const span = getSpan(vp);
    if (!span) return;
    let draft = { ...vp };
    const cb = container.getBoundingClientRect();
    const sx = startEv.clientX - cb.left;
    runManagedDragSession(startEv, (active) => { dragActive = active; }, {
      target: startEv.target as Element,
      moveThreshold: 2,
      onMove: (event) => {
        const dx = (event.clientX - cb.left) - sx;
        const newLeftX = snapXToNearestCandle(chart, span.left + dx);
        const newRightX = snapXToNearestCandle(chart, span.right + dx);
        const tL = xToSnappedTime(chart, newLeftX, candleStore.candles);
        const tR = xToSnappedTime(chart, newRightX, candleStore.candles);
        if (tL == null || tR == null) return;
        // Recompute and redraw the whole profile (bins/POC/VA) live on every frame
        // instead of only previewing the hit-box — otherwise it jumps on release.
        draft = { ...draft, timeLeft: tL, timeRight: tR };
        invalidate(id);
        syncOne(draft);
      },
      onEnd: (_event, moved) => {
        if (!moved) return;
        const idx = profiles.findIndex((item) => item.id === id);
        if (idx < 0) return;
        const next = { ...draft };
        if (next.timeLeft > next.timeRight) { const tmp = next.timeLeft; next.timeLeft = next.timeRight; next.timeRight = tmp; }
        profiles[idx] = next;
        invalidate(id);
        callbacks.onUpdate(next);
        syncAll();
      },
    });
  }

  function startEdgeDrag(id: string, edge: "left" | "right", startEv: PointerEvent) {
    const vp = profiles.find((p) => p.id === id);
    if (!vp) return;
    let draft = { ...vp };
    runManagedDragSession(startEv, (active) => { dragActive = active; }, {
      target: startEv.target as Element,
      onMove: (event) => {
        const cb = container.getBoundingClientRect();
        const x = snapXToNearestCandle(chart, event.clientX - cb.left);
        const t = xToSnappedTime(chart, x, candleStore.candles);
        if (t == null) return;
        draft = edge === "left" ? { ...draft, timeLeft: t } : { ...draft, timeRight: t };
        invalidate(id);
        syncOne(draft);
      },
      onEnd: (_event, moved) => {
        if (!moved) return;
        const idx = profiles.findIndex((item) => item.id === id);
        if (idx < 0) return;
        const next = { ...draft };
        if (next.timeLeft > next.timeRight) { const tmp = next.timeLeft; next.timeLeft = next.timeRight; next.timeRight = tmp; }
        profiles[idx] = next;
        invalidate(id);
        callbacks.onUpdate(next);
        syncAll();
      },
    });
  }

  // ---- create via two clicks ----

  function clearGhost() {
    ghostEl?.remove();
    ghostEl = null;
  }

  function updateGhost(firstTime: number, x2: number) {
    if (!ghostEl) return;
    const x1 = timeToX(chart, firstTime, candleStore.candles);
    if (x1 == null) return;
    const containerHeight = container.getBoundingClientRect().height;
    ghostEl.setAttribute("x", String(Math.min(x1, x2)));
    ghostEl.setAttribute("y", "0");
    ghostEl.setAttribute("width", String(Math.abs(x2 - x1)));
    ghostEl.setAttribute("height", String(containerHeight));
  }

  const drawingSession = createDrawingSession<number>({
    mode: "volumeprofile",
    manager,
    container,
    chart,
    pointCount: 2,
    clampCursorX: true,
    pointFromClick: (event) => {
      const bounds = container.getBoundingClientRect();
      const x = snapXToNearestCandle(
        chart,
        Math.max(0, Math.min(event.sourceEvent.clientX - bounds.left, getPlotWidthLocal())),
      );
      return xToSnappedTime(chart, x, candleStore.candles);
    },
    ghostUpdate: ([firstTime], cursor) => {
      if (!ghostEl) {
        ghostEl = document.createElementNS(SVG_NS, "rect");
        ghostEl.setAttribute("class", "vp-ghost");
        ghostEl.setAttribute("fill", "rgba(38,198,218,0.12)");
        ghostEl.setAttribute("stroke", "#26C6DA");
        ghostEl.setAttribute("stroke-width", "1");
        ghostEl.setAttribute("stroke-dasharray", "4 3");
        svg.appendChild(ghostEl);
      }
      updateGhost(firstTime, cursor.x);
    },
    ghostRemove: clearGhost,
    shouldCommit: ([time1, time2]) => Math.abs(time2 - time1) >= 1,
    commit: ([time1, time2]) => {
      const newProfile: VolumeProfile = {
        id: crypto.randomUUID(),
        datasetId,
        timeLeft: Math.min(time1, time2),
        timeRight: Math.max(time1, time2),
        ...VOLUME_PROFILE_DEFAULTS,
      };
      profiles.push(newProfile);
      callbacks.onCreate(newProfile);
      selectProfile(newProfile.id);
      syncAll();
    },
    onComplete: () => callbacks.onDrawingComplete(),
  });

  return () => {
    unregisterLifecycle();
    drawingSession.destroy();
    selection.destroy();
    toolbarController.destroy();
    removePanel();
    overlay.remove();
  };
}
