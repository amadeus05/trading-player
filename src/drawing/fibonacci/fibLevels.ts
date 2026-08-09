import type { FibonacciLevel } from "../../types";

/** Порядок как в TradingView Style: 2 колонки слева направо по строкам. */
export const DEFAULT_FIB_LEVEL_DEFS: readonly FibonacciLevel[] = [
  { ratio: 0, color: "#787b86", enabled: true },
  { ratio: 0.236, color: "#f23645", enabled: true },
  { ratio: 0.382, color: "#ff9800", enabled: true },
  { ratio: 0.5, color: "#9acd32", enabled: true },
  { ratio: 0.618, color: "#089981", enabled: true },
  { ratio: 0.786, color: "#00bcd4", enabled: true },
  { ratio: 1, color: "#787b86", enabled: true },
  { ratio: 1.618, color: "#2962ff", enabled: true },
  { ratio: 2.618, color: "#e91e63", enabled: true },
  { ratio: 3.618, color: "#9c27b0", enabled: true },
  { ratio: 4.236, color: "#f23645", enabled: true },
  { ratio: 1.272, color: "#ff9800", enabled: false },
  { ratio: 1.414, color: "#f48fb1", enabled: false },
  { ratio: 2.272, color: "#ff9800", enabled: false },
  { ratio: 2.414, color: "#9acd32", enabled: false },
  { ratio: 2, color: "#089981", enabled: false },
  { ratio: 3, color: "#00bcd4", enabled: false },
  { ratio: 3.272, color: "#787b86", enabled: false },
  { ratio: 3.414, color: "#64b5f6", enabled: false },
  { ratio: 4, color: "#f23645", enabled: false },
  { ratio: 4.272, color: "#9c27b0", enabled: false },
  { ratio: 0.71, color: "#e040fb", enabled: false },
];

export function getDefaultFibLevels(): FibonacciLevel[] {
  return DEFAULT_FIB_LEVEL_DEFS.map((level) => ({ ...level }));
}

export function resolveFibLevels(levels?: FibonacciLevel[] | null): FibonacciLevel[] {
  if (levels?.length) {
    return levels.map((level) => ({
      ratio: Number(level.ratio),
      color: level.color || "#787b86",
      enabled: level.enabled !== false,
    }));
  }
  return getDefaultFibLevels();
}
