import type { Candle, Persisted, SimulationSettings, Trade } from "../../../types";
import { IntrabarExitResolver } from "../../../simulation/IntrabarExitResolver";
import { buildPartialCandle } from "../../replay/playheadCandle";
import { calculateBarrierClose } from "./calculateTradeResult";

const intrabarExitResolver = new IntrabarExitResolver();

export type SimulationEvent =
  | { type: "order-filled"; trade: Trade }
  | {
      type: "trade-closed";
      trade: Trade;
      outcome: "TP" | "SL";
      exit: number;
      result: number;
    };

interface AdvanceSimulationOptions {
  state: Persisted;
  rawCandles: Candle[];
  candle: Candle;
  timeframeMinutes: number;
  settings: SimulationSettings;
  /** Голова плеера: SL/TP видит тот же отрезок, что и частичная свеча на графике. */
  playheadTime?: number;
}

/** Тик в UI зависит от головы и окна 5м, не только от открытия бакета. */
export function simulationTickKey(
  datasetId: string,
  timeframeMinutes: number,
  candleTime: number,
  playheadTime: number,
  rawCandles: Pick<Candle, "time">[],
): string {
  const from = rawCandles[0]?.time ?? "";
  const to = rawCandles.at(-1)?.time ?? "";
  return `${datasetId}:${timeframeMinutes}:${candleTime}:${playheadTime}:${rawCandles.length}:${from}:${to}`;
}

export interface AdvanceSimulationResult {
  state: Persisted;
  events: SimulationEvent[];
}

const resolveFallbackOutcome = (
  trade: Trade,
  candle: Candle,
  settings: SimulationSettings,
): "TP" | "SL" | null => {
  const stopLossHit = trade.side === "LONG"
    ? candle.low <= trade.sl
    : candle.high >= trade.sl;
  const takeProfitHit = trade.side === "LONG"
    ? candle.high >= trade.tp
    : candle.low <= trade.tp;
  if (!stopLossHit && !takeProfitHit) return null;
  if (stopLossHit && takeProfitHit) {
    if (settings.ambiguousExitPolicy === "ignore") return null;
    return settings.ambiguousExitPolicy === "optimistic" ? "TP" : "SL";
  }
  return stopLossHit ? "SL" : "TP";
};

export function advanceSimulation({
  state,
  rawCandles,
  candle,
  timeframeMinutes,
  settings,
  playheadTime,
}: AdvanceSimulationOptions): AdvanceSimulationResult {
  if (playheadTime != null && candle.time > playheadTime) {
    return { state, events: [] };
  }
  const events: SimulationEvent[] = [];
  const filledIds = new Set(
    state.trades
      .filter((trade) =>
        trade.status === "PENDING"
        && (trade.createdTime ?? trade.entryTime) < candle.time
        && candle.low <= trade.entry
        && candle.high >= trade.entry,
      )
      .map((trade) => trade.id),
  );
  state.trades.forEach((trade) => {
    if (filledIds.has(trade.id)) events.push({ type: "order-filled", trade });
  });

  const closures = state.trades.flatMap((trade) => {
    if (trade.status !== "OPEN" || trade.entryTime >= candle.time) return [];
    const intrabar = intrabarExitResolver.resolve(
      rawCandles,
      candle.time,
      timeframeMinutes * 60,
      trade,
      playheadTime,
    );
    if (intrabar.kind === "not-hit") return [];
    const playedCandle = playheadTime == null
      ? candle
      : buildPartialCandle(rawCandles, candle.time, playheadTime);
    if (intrabar.kind !== "resolved" && !playedCandle) return [];
    const outcome = intrabar.kind === "resolved"
      ? intrabar.outcome
      : resolveFallbackOutcome(trade, playedCandle ?? candle, settings);
    if (!outcome) return [];
    const exitTime = intrabar.kind === "resolved" ? intrabar.candleTime : candle.time;
    const close = calculateBarrierClose(trade, outcome, settings);
    return [{ trade, outcome, exitTime, ...close }];
  });
  const closuresById = new Map(closures.map((closure) => [closure.trade.id, closure]));
  closures.forEach(({ trade, outcome, exit, result }) => {
    events.push({ type: "trade-closed", trade, outcome, exit, result });
  });

  if (!filledIds.size && !closures.length) return { state, events };
  return {
    state: {
      ...state,
      trades: state.trades.map((trade) => {
        const closure = closuresById.get(trade.id);
        if (closure) {
          return {
            ...trade,
            status: "CLOSED",
            exitTime: closure.exitTime,
            exit: closure.exit,
            grossResult: closure.grossResult,
            fees: closure.fees,
            result: closure.result,
            outcome: closure.outcome,
          };
        }
        return filledIds.has(trade.id)
          ? { ...trade, status: "OPEN", entryTime: candle.time }
          : trade;
      }),
      annotations: state.annotations.map((barrier) => filledIds.has(barrier.id)
        ? { ...barrier, entryTime: candle.time }
        : barrier),
    },
    events,
  };
}
