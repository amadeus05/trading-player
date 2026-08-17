import type { AccountSettings, Trade } from "../../../types";
import { tradeHasTag } from "../../journal/tradeTags";

export interface AnalyticsFilters {
  datasetId?: string;
  timeframeMinutes?: number;
  fromTime?: number;
  toTime?: number;
  side?: Trade["side"];
  outcome?: NonNullable<Trade["outcome"]>;
  tag?: string;
}

export interface TradeAnalytics {
  equityCurve: Array<{ time: number; equity: number }>;
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  pendingTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  totalPnl: number;
  totalGrossPnl: number;
  totalFees: number;
  profitFactor: number | null;
  expectancy: number;
  averageR: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  longPnl: number;
  shortPnl: number;
  longCount: number;
  shortCount: number;
  tpCount: number;
  slCount: number;
  manualCount: number;
  timeoutCount: number;
}

const EMPTY_ANALYTICS: TradeAnalytics = {
  equityCurve: [],
  totalTrades: 0,
  closedTrades: 0,
  openTrades: 0,
  pendingTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  winRatePct: 0,
  totalPnl: 0,
  totalGrossPnl: 0,
  totalFees: 0,
  profitFactor: null,
  expectancy: 0,
  averageR: null,
  bestTrade: null,
  worstTrade: null,
  maxDrawdown: 0,
  maxDrawdownPct: 0,
  longPnl: 0,
  shortPnl: 0,
  longCount: 0,
  shortCount: 0,
  tpCount: 0,
  slCount: 0,
  manualCount: 0,
  timeoutCount: 0,
};

function tradeTime(trade: Trade): number {
  return trade.exitTime ?? trade.entryTime;
}

function matchesFilters(trade: Trade, filters: AnalyticsFilters): boolean {
  const time = tradeTime(trade);
  return (filters.datasetId == null || trade.datasetId === filters.datasetId)
    && (filters.fromTime == null || time >= filters.fromTime)
    && (filters.toTime == null || time <= filters.toTime)
    && (filters.timeframeMinutes == null || trade.timeframeMinutes === filters.timeframeMinutes)
    && (filters.side == null || trade.side === filters.side)
    && (filters.outcome == null || trade.outcome === filters.outcome)
    && (filters.tag == null || tradeHasTag(trade, filters.tag));
}

export function tradeRisk(trade: Trade): number | null {
  const riskPerUnit = Math.abs(trade.entry - trade.sl);
  const risk = riskPerUnit * trade.size;
  return Number.isFinite(risk) && risk > 0 ? risk : null;
}

export function filterTradesForAnalytics(
  trades: Trade[],
  filters: AnalyticsFilters = {},
): Trade[] {
  return trades.filter((trade) => matchesFilters(trade, filters));
}

export function calculateTradeAnalytics(
  account: AccountSettings,
  trades: Trade[],
  filters: AnalyticsFilters = {},
): TradeAnalytics {
  const filteredTrades = filterTradesForAnalytics(trades, filters);
  const closedTrades = filteredTrades
    .filter((trade) => trade.status === "CLOSED")
    .sort((left, right) => tradeTime(left) - tradeTime(right));

  if (!filteredTrades.length) return EMPTY_ANALYTICS;

  const totalPnl = closedTrades.reduce((total, trade) => total + (trade.result ?? 0), 0);
  const totalGrossPnl = closedTrades.reduce((total, trade) => total + (trade.grossResult ?? trade.result ?? 0), 0);
  const totalFees = closedTrades.reduce((total, trade) => total + (trade.fees ?? trade.entryFee ?? 0), 0);
  const winningTrades = closedTrades.filter((trade) => (trade.result ?? 0) > 0);
  const losingTrades = closedTrades.filter((trade) => (trade.result ?? 0) < 0);
  const grossProfit = winningTrades.reduce((total, trade) => total + (trade.result ?? 0), 0);
  const grossLoss = losingTrades.reduce((total, trade) => total + Math.abs(trade.result ?? 0), 0);
  const rValues = closedTrades.flatMap((trade) => {
    const risk = tradeRisk(trade);
    return risk ? [(trade.result ?? 0) / risk] : [];
  });

  let equity = Math.max(0, account.initialBalance);
  const equityCurve: TradeAnalytics["equityCurve"] = [{ time: 0, equity }];
  let peak = equity;
  let maxDrawdown = 0;
  closedTrades.forEach((trade) => {
    equity += trade.result ?? 0;
    equityCurve.push({ time: tradeTime(trade), equity });
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  });

  const bestTrade = closedTrades.length
    ? Math.max(...closedTrades.map((trade) => trade.result ?? 0))
    : null;
  const worstTrade = closedTrades.length
    ? Math.min(...closedTrades.map((trade) => trade.result ?? 0))
    : null;

  return {
    equityCurve,
    totalTrades: filteredTrades.length,
    closedTrades: closedTrades.length,
    openTrades: filteredTrades.filter((trade) => trade.status === "OPEN").length,
    pendingTrades: filteredTrades.filter((trade) => trade.status === "PENDING").length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRatePct: closedTrades.length ? winningTrades.length / closedTrades.length * 100 : 0,
    totalPnl,
    totalGrossPnl,
    totalFees,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : winningTrades.length ? null : 0,
    expectancy: closedTrades.length ? totalPnl / closedTrades.length : 0,
    averageR: rValues.length
      ? rValues.reduce((total, value) => total + value, 0) / rValues.length
      : null,
    bestTrade,
    worstTrade,
    maxDrawdown,
    maxDrawdownPct: peak > 0 ? maxDrawdown / peak * 100 : 0,
    longPnl: closedTrades
      .filter((trade) => trade.side === "LONG")
      .reduce((total, trade) => total + (trade.result ?? 0), 0),
    shortPnl: closedTrades
      .filter((trade) => trade.side === "SHORT")
      .reduce((total, trade) => total + (trade.result ?? 0), 0),
    longCount: filteredTrades.filter((trade) => trade.side === "LONG").length,
    shortCount: filteredTrades.filter((trade) => trade.side === "SHORT").length,
    tpCount: closedTrades.filter((trade) => trade.outcome === "TP").length,
    slCount: closedTrades.filter((trade) => trade.outcome === "SL").length,
    manualCount: closedTrades.filter((trade) => trade.outcome === "MANUAL").length,
    timeoutCount: closedTrades.filter((trade) => trade.outcome === "TIMEOUT").length,
  };
}
