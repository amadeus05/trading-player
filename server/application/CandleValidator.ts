import { BASE_INTERVAL_MS, type Candle } from "../domain/Candle.js";

export interface ValidationResult { candles: Candle[]; gaps: number[] }

export class CandleValidator {
  validate(input: Candle[]): ValidationResult {
    const candles = [...new Map(input.map((c) => [c.openTime, c])).values()]
      .filter((c) => c.openTime % BASE_INTERVAL_MS === 0 && [c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite))
      .sort((a, b) => a.openTime - b.openTime);
    const gaps: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      for (let t = candles[i - 1].openTime + BASE_INTERVAL_MS; t < candles[i].openTime; t += BASE_INTERVAL_MS) gaps.push(t);
    }
    return { candles, gaps };
  }
}
