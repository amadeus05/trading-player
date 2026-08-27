export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

/**
 * Метка минуты, которой на рынке не было: выходные форекса, ночной перерыв,
 * минута без единого тика. Такая минута хранится настоящим слотом с последней
 * известной ценой, потому что покрытие считается по плотности слотов: пустая
 * дырка навсегда осталась бы «недокачанной», а бакет старшего таймфрейма вокруг
 * неё не собрался бы вообще. Помечаем оборотом: отрицательным он не приходит ни
 * с одной биржи, поэтому спутать метку с настоящими данными невозможно.
 */
export const CLOSED_MARKET_TURNOVER = -1;

export const isClosedMarketCandle = (candle: Candle): boolean => candle.turnover < 0;

/**
 * Разрешение, в котором хранится история. Минутное: из него собирается любой
 * таймфрейм, кратный минуте, включая те, что не делятся на пять — 7m из
 * пятиминуток не сложить в принципе.
 */
export const BASE_INTERVAL_MS = 60_000;
export const SUPPORTED_TIMEFRAMES = [
  "1m", "2m", "3m", "5m", "7m", "10m", "15m", "30m",
  "1h", "2h", "3h", "4h", "6h", "12h", "1d",
] as const;
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
