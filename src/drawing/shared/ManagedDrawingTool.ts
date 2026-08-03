import type { DrawingSelectionBridge, DrawingSelectionKind } from "../DrawingManager";
import type { DrawingManager } from "../DrawingManager";
import {
  getDefaultPasteOffset,
  offsetClipboardItem,
  type DrawingClipboardItem,
} from "./clipboard";
import type { ChartCandleStore } from "./types";

export function getPlotWidth(chart: { timeScale: () => { width: () => number } }): number {
  return Math.max(0, Number(chart.timeScale().width()) || 0);
}

export function clampPlotX(x: number, plotWidth: number): number {
  return Math.max(0, Math.min(x, plotWidth));
}

type ClipboardKind = DrawingClipboardItem["kind"];

type ClipboardData<K extends ClipboardKind> = Extract<DrawingClipboardItem, { kind: K }>["data"];

export interface ClipboardBridgeOptions<T extends { id: string; datasetId: string }, K extends ClipboardKind> {
  kind: K;
  datasetId: string;
  candleStore: ChartCandleStore;
  getSelectedId: () => string | null;
  findById: (id: string) => T | undefined;
  append: (item: T) => void;
  onCreate: (item: T) => void;
  select: (id: string) => void;
  deleteSelected: () => void;
  createFromClipboard: (data: ClipboardData<K>) => T;
  syncAll: () => void;
  cancelDrawing?: (silent?: boolean) => boolean;
}

export function createClipboardBridge<T extends { id: string; datasetId: string }, K extends ClipboardKind>(
  options: ClipboardBridgeOptions<T, K>,
): DrawingSelectionBridge {
  return {
    getSelected: () => {
      const id = options.getSelectedId();
      if (!id) return null;
      const item = options.findById(id);
      if (!item) return null;
      const { id: _id, datasetId: _datasetId, ...data } = item;
      return { kind: options.kind, data: data as unknown as ClipboardData<K> } as DrawingClipboardItem;
    },
    deleteSelected: options.deleteSelected,
    paste: (item) => {
      if (item.kind !== options.kind) return;
      const offset = getDefaultPasteOffset(options.candleStore.candles);
      const data = offsetClipboardItem(item as Extract<DrawingClipboardItem, { kind: K }>, offset).data as ClipboardData<K>;
      const created = options.createFromClipboard(data);
      options.append(created);
      options.onCreate(created);
      options.syncAll();
      options.select(created.id);
    },
    cancelDrawing: options.cancelDrawing,
  };
}

export interface ManagedDrawingLifecycleOptions {
  manager: DrawingManager;
  kind: DrawingSelectionKind;
  bridge: DrawingSelectionBridge;
  syncAll: () => void;
  isDragActive: () => boolean;
  onDeselect: () => void;
  purgeAll?: () => void;
  /** Принять коллекцию, подменённую снаружи (отмена/повтор), без переподключения. */
  replaceAll?: (items: unknown[]) => void;
}

/** Registers selection bridge, deselect handler and overlay sync with DrawingManager. */
export function attachManagedDrawingLifecycle(options: ManagedDrawingLifecycleOptions): () => void {
  const unregisterBridge = options.manager.registerSelectionBridge(options.kind, options.bridge);
  const unregisterDeselect = options.manager.registerDeselect(options.kind, options.onDeselect);
  const unregisterPurge = options.purgeAll
    ? options.manager.registerPurge(options.kind, options.purgeAll)
    : () => {};
  const unregisterReplace = options.replaceAll
    ? options.manager.registerReplaceAll(options.kind, options.replaceAll)
    : () => {};
  const unregisterOverlaySync = options.manager.registerOverlaySync(() => {
    if (!options.isDragActive()) options.syncAll();
  });
  options.manager.scheduleOverlaySync();
  return () => {
    unregisterBridge();
    unregisterDeselect();
    unregisterPurge();
    unregisterReplace();
    unregisterOverlaySync();
  };
}

export interface PointerDragSessionOptions {
  target: Element;
  onMove: (event: PointerEvent) => void;
  onEnd: (event: PointerEvent, moved: boolean) => void;
  moveThreshold?: number;
}

/** rAF-throttled pointer drag with optional move threshold before onMove fires. */
export function startPointerDragSession(
  startEvent: PointerEvent,
  options: PointerDragSessionOptions,
): () => void {
  const threshold = options.moveThreshold ?? 0;
  const target = options.target;
  if (target.setPointerCapture) {
    try { target.setPointerCapture(startEvent.pointerId); } catch { /* noop */ }
  }

  let dragRaf = 0;
  let latestEvent: PointerEvent | null = null;
  let moved = false;
  const startX = startEvent.clientX;
  const startY = startEvent.clientY;

  const renderMove = () => {
    dragRaf = 0;
    const event = latestEvent;
    if (!event) return;
    if (!moved) {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      moved = true;
    }
    options.onMove(event);
  };

  const onMove = (event: PointerEvent) => {
    latestEvent = event;
    if (!dragRaf) dragRaf = requestAnimationFrame(renderMove);
  };

  const onEnd = (event: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointercancel", onEnd);
    if (dragRaf) {
      cancelAnimationFrame(dragRaf);
      dragRaf = 0;
      renderMove();
    }
    if (target.releasePointerCapture) {
      try { target.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    }
    options.onEnd(event, moved);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd, { once: true });
  window.addEventListener("pointercancel", onEnd, { once: true });

  return () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointercancel", onEnd);
    if (dragRaf) cancelAnimationFrame(dragRaf);
  };
}

export function runManagedDragSession(
  startEvent: PointerEvent,
  onDragActiveChange: (active: boolean) => void,
  options: PointerDragSessionOptions,
): () => void {
  onDragActiveChange(true);
  return startPointerDragSession(startEvent, {
    ...options,
    onEnd: (event, moved) => {
      onDragActiveChange(false);
      options.onEnd(event, moved);
    },
  });
}

export interface ScaleInteractionSyncOptions {
  isDragActive: () => boolean;
  syncAll: () => void;
  shouldIgnorePointerDown?: (target: Element) => boolean;
  wheelDebounceMs?: number;
}

export interface ScaleInteractionSyncHandle {
  handleScaleWheel: () => void;
  handlePointerDown: (event: PointerEvent) => void;
  handlePointerUp: () => void;
  destroy: () => void;
}

/** Keeps fibonacci-style overlays in sync while the price/time scale animates. */
export function attachScaleInteractionSync(options: ScaleInteractionSyncOptions): ScaleInteractionSyncHandle {
  let interactionSyncRaf = 0;
  let finalSyncRaf = 0;
  let wheelSyncTimer = 0;

  const runInteractionSync = () => {
    if (options.isDragActive()) {
      interactionSyncRaf = 0;
      return;
    }
    options.syncAll();
    interactionSyncRaf = requestAnimationFrame(runInteractionSync);
  };

  const startInteractionSync = () => {
    if (!interactionSyncRaf) interactionSyncRaf = requestAnimationFrame(runInteractionSync);
  };

  const stopInteractionSync = () => {
    if (interactionSyncRaf) cancelAnimationFrame(interactionSyncRaf);
    interactionSyncRaf = 0;
    if (finalSyncRaf) cancelAnimationFrame(finalSyncRaf);
    finalSyncRaf = requestAnimationFrame(() => {
      finalSyncRaf = 0;
      if (!options.isDragActive()) options.syncAll();
    });
  };

  return {
    handleScaleWheel: () => {
      options.syncAll();
      startInteractionSync();
      window.clearTimeout(wheelSyncTimer);
      wheelSyncTimer = window.setTimeout(stopInteractionSync, options.wheelDebounceMs ?? 150);
    },
    handlePointerDown: (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (options.shouldIgnorePointerDown?.(target)) return;
      startInteractionSync();
    },
    handlePointerUp: () => {
      if (options.isDragActive()) return;
      stopInteractionSync();
    },
    destroy: () => {
      window.clearTimeout(wheelSyncTimer);
      if (interactionSyncRaf) cancelAnimationFrame(interactionSyncRaf);
      if (finalSyncRaf) cancelAnimationFrame(finalSyncRaf);
      interactionSyncRaf = 0;
      finalSyncRaf = 0;
    },
  };
}
