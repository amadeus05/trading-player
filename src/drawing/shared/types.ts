export type DrawingMode = "none" | "trendline" | "arrow" | "horizontalline" | "measure" | "rectangle" | "fibonacci" | "fibtrendext" | "parallelchannel" | "volumeprofile";


/**
 * Контракт состояния attach-инструментов: каждый инструмент при подключении
 * копирует переданный массив фигур (`let items = [...opts.items]`) и дальше
 * владеет копией сам — React-состояние снаружи обновляется ТОЛЬКО через эти
 * коллбеки и не проталкивается обратно в инструмент. Источник истины на время
 * жизни инструмента — его локальная копия; пересоздание инструмента
 * (re-attach в useEffect) подхватывает внешние изменения.
 */
export interface DrawingCrudCallbacks<T extends { id: string }> {
  onCreate: (drawing: T) => void;
  onUpdate: (drawing: T) => void;
  onDelete: (id: string) => void;
  onDrawingComplete: () => void;
}

/**
 * Минимальные структурные интерфейсы lightweight-charts для координатных
 * утилит: числа вместо branded-типов (Logical/Coordinate), IChartApi и
 * ISeriesApi им соответствуют.
 */
export interface ChartApiLike {
  timeScale(): {
    width(): number;
    height(): number;
    logicalToCoordinate(logical: number): number | null;
    coordinateToLogical(x: number): number | null;
  };
}

export interface SeriesApiLike {
  priceToCoordinate(price: number): number | null;
  coordinateToPrice(y: number): number | null;
}

export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ChartCandleStore {
  candles: ChartCandle[];
}

export interface ManagedDrawingToolOptions {
  manager: import("../DrawingManager").DrawingManager;
}
