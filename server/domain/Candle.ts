export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

export const BASE_INTERVAL_MS = 5 * 60_000;
export const SUPPORTED_TIMEFRAMES = ["5m", "10m", "15m", "30m", "1h", "2h", "3h", "4h", "6h", "12h", "1d"] as const;
export type Timeframe = (typeof SUPPORTED_TIMEFRAMES)[number];

export const timeframeMs = (value: string): number => {
  const match = /^(\d+)(m|h|d)$/.exec(value);
  if (!match) throw new Error(`Unsupported timeframe: ${value}`);
  const unit = match[2] === "m" ? 60_000 : match[2] === "h" ? 3_600_000 : 86_400_000;
  const ms = Number(match[1]) * unit;
  if (ms % BASE_INTERVAL_MS !== 0 || !SUPPORTED_TIMEFRAMES.includes(value as Timeframe)) {
    throw new Error(`Unsupported timeframe: ${value}`);
  }
  return ms;
};
