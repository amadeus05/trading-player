export type DrawingMode = "none" | "trendline" | "measure" | "rectangle" | "fibonacci" | "fibtrendext" | "parallelchannel" | "volumeprofile";

export interface DrawingCrudCallbacks<T extends { id: string }> {
  onCreate: (drawing: T) => void;
  onUpdate: (drawing: T) => void;
  onDelete: (id: string) => void;
  onDrawingComplete: () => void;
}

export interface ChartCandleStore {
  candles: Array<{ time: number; volume?: number }>;
}

export interface ManagedDrawingToolOptions {
  manager: import("../DrawingManager").DrawingManager;
}
