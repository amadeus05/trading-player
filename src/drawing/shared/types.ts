export type DrawingMode = "none" | "trendline" | "measure" | "rectangle" | "fibonacci" | "fibtrendext" | "parallelchannel";

export interface DrawingCrudCallbacks<T extends { id: string }> {
  onCreate: (drawing: T) => void;
  onUpdate: (drawing: T) => void;
  onDelete: (id: string) => void;
  onDrawingComplete: () => void;
}

export interface ManagedDrawingToolOptions {
  manager: import("../DrawingManager").DrawingManager;
}
