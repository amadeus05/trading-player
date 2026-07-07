import type { DrawingMode } from "./shared/types";
import { cloneClipboardItem, type DrawingClipboardItem } from "./shared/clipboard";

export type DrawingSelectionKind = "trendline" | "horizontalline" | "rectangle" | "fibonacci" | "fibtrendext" | "parallelchannel" | "volumeprofile";

export interface DrawingSelectionBridge {
  getSelected: () => DrawingClipboardItem | null;
  deleteSelected: () => void;
  paste: (item: DrawingClipboardItem) => void;
  /** Aborts an in-progress drawing. `silent` skips the completion callback (used on tool switch). */
  cancelDrawing?: (silent?: boolean) => boolean;
}

const MODE_TO_KIND: Partial<Record<DrawingMode, DrawingSelectionKind>> = {
  trendline: "trendline",
  horizontalline: "horizontalline",
  rectangle: "rectangle",
  fibonacci: "fibonacci",
  fibtrendext: "fibtrendext",
  parallelchannel: "parallelchannel",
  volumeprofile: "volumeprofile",
};

export interface DrawingManagerOptions {
  onDeleteAll?: () => void;
}

/**
 * Owns interaction priority for every drawing tool attached to one chart.
 * Renderers describe geometry; the manager decides whether existing drawings
 * may receive input while a new drawing is being created.
 */
export class DrawingManager {
  private mode: DrawingMode = "none";
  private selectedOverlay: SVGSVGElement | null = null;
  private activeKind: DrawingSelectionKind | null = null;
  private activeId: string | null = null;
  private deselectByKind = new Map<DrawingSelectionKind, () => void>();
  private bridgesByKind = new Map<DrawingSelectionKind, DrawingSelectionBridge>();
  private purgeByKind = new Map<DrawingSelectionKind, () => void>();
  private overlaySyncById = new Map<symbol, () => void>();
  private modeChangeListeners = new Set<(mode: DrawingMode) => void>();
  private overlayLoopTokens = new Set<symbol>();
  private overlayLoopId = 0;
  private pendingOverlaySyncFrame = 0;
  private clipboard: DrawingClipboardItem | null = null;
  private drawingsVisible = true;
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private readonly onContextMenu: (event: MouseEvent) => void;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: DrawingManagerOptions = {},
  ) {
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.onContextMenu = (event) => this.handleContextMenu(event);
    document.addEventListener("keydown", this.onKeyDown);
    this.container.addEventListener("contextmenu", this.onContextMenu);
    this.applyMode();
    this.setDrawingsVisible(true);
  }

  setMode(mode: DrawingMode): void {
    const changed = this.mode !== mode;
    // Abort any half-finished drawing on the current mode before switching away,
    // so a partial drawing can never get stuck on the chart. Base behaviour for
    // every drawing tool — persisted tools cancel via their selection bridge,
    // non-bridge tools (e.g. measure) via a mode-change listener.
    if (changed) this.abortActiveDrawing();
    this.mode = mode;
    this.applyMode();
    if (changed) this.modeChangeListeners.forEach((listener) => listener(mode));
  }

  private abortActiveDrawing(): void {
    const kind = MODE_TO_KIND[this.mode];
    if (kind) this.bridgesByKind.get(kind)?.cancelDrawing?.(true);
  }

  /** Right-click cancels an in-progress drawing (after the first point). */
  private handleContextMenu(event: MouseEvent): void {
    if (!this.isDrawing()) return;
    const kind = MODE_TO_KIND[this.mode];
    if (kind && this.bridgesByKind.get(kind)?.cancelDrawing?.()) {
      event.preventDefault();
    }
  }

  /** Notifies when the active drawing mode changes (used to cancel in-progress drawings). */
  registerModeChange(listener: (mode: DrawingMode) => void): () => void {
    this.modeChangeListeners.add(listener);
    return () => {
      this.modeChangeListeners.delete(listener);
    };
  }

  getMode(): DrawingMode {
    return this.mode;
  }

  isDrawing(): boolean {
    return this.mode !== "none";
  }

  canEditExistingDrawings(): boolean {
    return !this.isDrawing();
  }

  getActiveSelection(): { kind: DrawingSelectionKind; id: string } | null {
    if (!this.activeKind || !this.activeId) return null;
    return { kind: this.activeKind, id: this.activeId };
  }

  registerDeselect(kind: DrawingSelectionKind, deselect: () => void): () => void {
    this.deselectByKind.set(kind, deselect);
    return () => {
      if (this.deselectByKind.get(kind) === deselect) {
        this.deselectByKind.delete(kind);
      }
    };
  }

  registerSelectionBridge(kind: DrawingSelectionKind, bridge: DrawingSelectionBridge): () => void {
    this.bridgesByKind.set(kind, bridge);
    return () => {
      if (this.bridgesByKind.get(kind) === bridge) {
        this.bridgesByKind.delete(kind);
      }
    };
  }

  registerPurge(kind: DrawingSelectionKind, purge: () => void): () => void {
    this.purgeByKind.set(kind, purge);
    return () => {
      if (this.purgeByKind.get(kind) === purge) {
        this.purgeByKind.delete(kind);
      }
    };
  }

  /** Removes every drawing on the chart (local overlay state + persisted collections). */
  deleteAllDrawings(): boolean {
    if (this.isDrawing()) return false;
    this.clearSelection();
    this.purgeByKind.forEach((purge) => purge());
    this.options.onDeleteAll?.();
    this.clipboard = null;
    return true;
  }

  registerOverlaySync(sync: () => void): () => void {
    const id = Symbol("overlay-sync");
    this.overlaySyncById.set(id, sync);
    return () => {
      this.overlaySyncById.delete(id);
    };
  }

  syncOverlays(): void {
    this.overlaySyncById.forEach((sync) => sync());
  }

  /** Starts a shared temporary rAF loop for active chart interactions. */
  ensureOverlayLoop(): () => void {
    const token = Symbol("overlay-loop");
    this.overlayLoopTokens.add(token);
    if (this.overlayLoopId) {
      return () => this.stopOverlayLoop(token);
    }

    const loop = () => {
      if (!this.overlayLoopTokens.size) {
        this.overlayLoopId = 0;
        return;
      }
      this.syncOverlays();
      this.overlayLoopId = requestAnimationFrame(loop);
    };
    this.overlayLoopId = requestAnimationFrame(loop);
    return () => this.stopOverlayLoop(token);
  }

  /**
   * Sync overlays after lightweight-charts has applied data/viewport changes.
   */
  scheduleOverlaySync(): void {
    cancelAnimationFrame(this.pendingOverlaySyncFrame);
    this.pendingOverlaySyncFrame = requestAnimationFrame(() => {
      this.pendingOverlaySyncFrame = requestAnimationFrame(() => {
        this.pendingOverlaySyncFrame = 0;
        this.syncOverlays();
      });
    });
  }

  activateSelection(kind: DrawingSelectionKind, element: SVGElement | null, id?: string | null): void {
    if (this.activeKind && this.activeKind !== kind) {
      this.deselectByKind.get(this.activeKind)?.();
    }
    if (id) {
      this.activeKind = kind;
      this.activeId = id;
    } else {
      this.activeKind = null;
      this.activeId = null;
    }
    this.selectDrawing(element);
  }

  clearSelection(kind?: DrawingSelectionKind): void {
    if (kind && this.activeKind !== kind) return;
    if (this.activeKind) {
      this.deselectByKind.get(this.activeKind)?.();
      this.activeKind = null;
      this.activeId = null;
    }
    this.selectDrawing(null);
  }

  selectDrawing(element: SVGElement | null): void {
    this.selectedOverlay?.classList.remove("drawing-overlay--selected");
    this.selectedOverlay = element?.ownerSVGElement ?? null;
    this.selectedOverlay?.classList.add("drawing-overlay--selected");
  }

  setDrawingsVisible(visible: boolean): void {
    this.drawingsVisible = visible;
    this.container.dataset.drawingsVisible = visible ? "true" : "false";
  }

  getDrawingsVisible(): boolean {
    return this.drawingsVisible;
  }

  destroy(): void {
    document.removeEventListener("keydown", this.onKeyDown);
    this.container.removeEventListener("contextmenu", this.onContextMenu);
    this.clearSelection();
    cancelAnimationFrame(this.overlayLoopId);
    cancelAnimationFrame(this.pendingOverlaySyncFrame);
    this.overlayLoopTokens.clear();
    this.overlayLoopId = 0;
    this.pendingOverlaySyncFrame = 0;
    this.overlaySyncById.clear();
    this.modeChangeListeners.clear();
    this.bridgesByKind.clear();
    this.purgeByKind.clear();
    delete this.container.dataset.drawingMode;
    delete this.container.dataset.drawingActive;
    delete this.container.dataset.drawingsVisible;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    if (target instanceof Element) {
      const tag = target.tagName;
      const editable = target instanceof HTMLElement && target.isContentEditable;
      if (tag === "INPUT" || tag === "TEXTAREA" || editable) return;
    }

    const mod = event.ctrlKey || event.metaKey;

    if (mod && (event.code === "KeyC" || event.key.toLowerCase() === "c")) {
      if (!this.activeKind) return;
      const item = this.bridgesByKind.get(this.activeKind)?.getSelected();
      if (!item) return;
      event.preventDefault();
      this.clipboard = cloneClipboardItem(item);
      return;
    }

    if (mod && (event.code === "KeyV" || event.key.toLowerCase() === "v")) {
      if (this.isDrawing() || !this.clipboard) return;
      event.preventDefault();
      this.bridgesByKind.get(this.clipboard.kind)?.paste(this.clipboard);
      return;
    }

    if (mod && event.shiftKey && (event.key === "Delete" || event.key === "Backspace")) {
      if (this.isDrawing()) return;
      event.preventDefault();
      this.deleteAllDrawings();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (this.isDrawing() || !this.activeKind) return;
      event.preventDefault();
      this.bridgesByKind.get(this.activeKind)?.deleteSelected();
      return;
    }

    if (event.key === "Escape") {
      if (this.isDrawing()) {
        const kind = MODE_TO_KIND[this.mode];
        if (kind && this.bridgesByKind.get(kind)?.cancelDrawing?.()) {
          event.preventDefault();
          return;
        }
      }
      if (this.activeKind) {
        event.preventDefault();
        this.clearSelection();
      }
    }
  }

  private applyMode(): void {
    this.container.dataset.drawingMode = this.mode;
    this.container.dataset.drawingActive = this.isDrawing() ? "true" : "false";
  }

  private stopOverlayLoop(token: symbol): void {
    this.overlayLoopTokens.delete(token);
    if (this.overlayLoopTokens.size || !this.overlayLoopId) return;
    cancelAnimationFrame(this.overlayLoopId);
    this.overlayLoopId = 0;
  }
}
