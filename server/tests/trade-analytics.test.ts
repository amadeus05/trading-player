import assert from "node:assert/strict";
import test from "node:test";
import type { AccountSettings, Trade } from "../../src/types";
import { calculateTradeAnalytics, filterTradesForAnalytics } from "../../src/features/trading/lib/calculateTradeAnalytics";

const account: AccountSettings = {
  initialBalance: 1_000,
  quoteAsset: "USDT",
};

const trades: Trade[] = [
  {
    id: "win-long",
    datasetId: "binance-futures:BTCUSDT",
    side: "LONG",
    entryTime: 10,
    exitTime: 20,
    entry: 100,
    size: 1,
    sl: 90,
    tp: 130,
    status: "CLOSED",
    result: 30,
    grossResult: 32,
    fees: 2,
    outcome: "TP",
    comment: "",
  },
  {
    id: "loss-short",
    datasetId: "binance-futures:BTCUSDT",
    side: "SHORT",
    entryTime: 30,
    exitTime: 40,
    entry: 100,
    size: 2,
    sl: 110,
    tp: 80,
    status: "CLOSED",
    result: -20,
    grossResult: -18,
    fees: 2,
    outcome: "SL",
    comment: "",
  },
  {
    id: "manual-short",
    datasetId: "binance-futures:ETHUSDT",
    side: "SHORT",
    entryTime: 50,
    exitTime: 60,
    entry: 100,
    size: 1,
    sl: 120,
    tp: 70,
    status: "CLOSED",
    result: 10,
    fees: 1,
    outcome: "MANUAL",
    comment: "",
  },
  {
    id: "open",
    datasetId: "binance-futures:ETHUSDT",
    side: "LONG",
    entryTime: 70,
    entry: 100,
    size: 1,
    sl: 90,
    tp: 120,
    status: "OPEN",
    comment: "",
  },
];

test("calculates closed trade analytics", () => {
  const analytics = calculateTradeAnalytics(account, trades);

  assert.equal(analytics.totalTrades, 4);
  assert.equal(analytics.closedTrades, 3);
  assert.equal(analytics.openTrades, 1);
  assert.equal(analytics.pendingTrades, 0);
  assert.equal(analytics.winningTrades, 2);
  assert.equal(analytics.losingTrades, 1);
  assert.equal(analytics.winRatePct, 66.66666666666666);
  assert.equal(analytics.totalPnl, 20);
  assert.equal(analytics.totalGrossPnl, 24);
  assert.equal(analytics.totalFees, 5);
  assert.equal(analytics.profitFactor, 2);
  assert.equal(analytics.expectancy, 6.666666666666667);
  assert.equal(analytics.averageR, 0.8333333333333334);
  assert.equal(analytics.bestTrade, 30);
  assert.equal(analytics.worstTrade, -20);
  assert.equal(analytics.maxDrawdown, 20);
  assert.equal(analytics.maxDrawdownPct, 1.9417475728155338);
  assert.equal(analytics.longPnl, 30);
  assert.equal(analytics.shortPnl, -10);
  assert.equal(analytics.tpCount, 1);
  assert.equal(analytics.slCount, 1);
  assert.equal(analytics.manualCount, 1);
});

test("filters trades by dataset, period, side and outcome", () => {
  const filtered = filterTradesForAnalytics(trades, {
    datasetId: "binance-futures:BTCUSDT",
    fromTime: 20,
    toTime: 45,
    side: "SHORT",
    outcome: "SL",
  });

  assert.deepEqual(filtered.map((trade) => trade.id), ["loss-short"]);
});
