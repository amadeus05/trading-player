import type { AccountSettings, Candle, Trade } from "../../../types";

export interface AccountStats {
  initialBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  balance: number;
  equity: number;
  usedMargin: number;
  availableBalance: number;
  growthPct: number;
  closedTradeCount: number;
  openTradeCount: number;
}

const tradeUnrealizedPnl = (trade: Trade, price: number): number => {
  if (trade.status !== "OPEN") return 0;
  const grossResult = (trade.side === "LONG" ? price - trade.entry : trade.entry - price) * trade.size;
  return grossResult - (trade.entryFee ?? 0);
};

const tradeMargin = (trade: Trade): number => {
  if (trade.status !== "OPEN" && trade.status !== "PENDING") return 0;
  const leverage = Math.max(1, trade.leverage ?? 1);
  return trade.entry * trade.size / leverage;
};

export function calculateAccountStats(
  account: AccountSettings,
  trades: Trade[],
  currentCandle?: Candle,
): AccountStats {
  const initialBalance = Math.max(0, account.initialBalance);
  const realizedPnl = trades.reduce(
    (total, trade) => total + (trade.status === "CLOSED" ? trade.result ?? 0 : 0),
    0,
  );
  const unrealizedPnl = currentCandle
    ? trades.reduce((total, trade) => total + tradeUnrealizedPnl(trade, currentCandle.close), 0)
    : 0;
  const balance = initialBalance + realizedPnl;
  const equity = balance + unrealizedPnl;
  const usedMargin = trades.reduce((total, trade) => total + tradeMargin(trade), 0);
  const availableBalance = Math.max(0, equity - usedMargin);
  const growthPct = initialBalance > 0
    ? (equity - initialBalance) / initialBalance * 100
    : 0;

  return {
    initialBalance,
    realizedPnl,
    unrealizedPnl,
    balance,
    equity,
    usedMargin,
    availableBalance,
    growthPct,
    closedTradeCount: trades.filter((trade) => trade.status === "CLOSED").length,
    openTradeCount: trades.filter((trade) => trade.status === "OPEN").length,
  };
}
