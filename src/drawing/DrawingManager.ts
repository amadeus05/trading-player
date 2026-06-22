import type { DrawingMode } from "./shared/types";

export type DrawingSelectionKind = "trendline" | "rectangle" | "fibonacci" | "parallelchannel";

/**
 * Owns interaction priority for every drawing tool attached to one chart.
 * Renderers describe geometry; the manager decides whether existing drawings
 * may receive input while a new drawing is being created.
 */
export class DrawingManager {
  private mode: DrawingMode = "none";
  private selectedOverlay: SVGSVGElement | null = null;
  private activeKind: DrawingSelectionKind | null = null;
  private deselectByKind = new Map<DrawingSelectionKind, () => void>();

  constructor(private readonly container: HTMLElement) {
    this.applyMode();
  }

  setMode(mode: DrawingMode): void {
    this.mode = mode;
    this.applyMode();
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

  registerDeselect(kind: DrawingSelectionKind, deselect: () => void): () => void {
    this.deselectByKind.set(kind, deselect);
    return () => {
      if (this.deselectByKind.get(kind) === deselect) {
        this.deselectByKind.delete(kind);
      }
    };
  }

  activateSelection(kind: DrawingSelectionKind, element: SVGElement | null): void {
    if (this.activeKind && this.activeKind !== kind) {
      this.deselectByKind.get(this.activeKind)?.();
    }
    this.activeKind = kind;
    this.selectDrawing(element);
  }

  clearSelection(kind?: DrawingSelectionKind): void {
    if (kind && this.activeKind !== kind) return;
    if (this.activeKind) {
      this.deselectByKind.get(this.activeKind)?.();
      this.activeKind = null;
    }
    this.selectDrawing(null);
  }

  selectDrawing(element: SVGElement | null): void {
    this.selectedOverlay?.classList.remove("drawing-overlay--selected");
    this.selectedOverlay = element?.ownerSVGElement ?? null;
    this.selectedOverlay?.classList.add("drawing-overlay--selected");
  }

  destroy(): void {
    this.clearSelection();
    delete this.container.dataset.drawingMode;
    delete this.container.dataset.drawingActive;
  }

  private applyMode(): void {
    this.container.dataset.drawingMode = this.mode;
    this.container.dataset.drawingActive = this.isDrawing() ? "true" : "false";
  }
}
