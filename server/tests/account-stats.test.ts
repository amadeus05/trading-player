import assert from "node:assert/strict";
import test from "node:test";
import type { AccountSettings, Candle, Trade } from "../../src/types";
import { calculateAccountStats } from "../../src/features/trading/lib/calculateAccountStats";

const account: AccountSettings = {
  initialBalance: 1_000,
  quoteAsset: "USDT",
};

const candle: Candle = {
  time: 1_000,
  open: 110,
  high: 112,
  low: 108,
  close: 110,
  volume: 1,
};

test("calculates balance from closed trades and equity from open trades", () => {
  const trades: Trade[] = [
    {
      id: "closed-win",
      side: "LONG",
      entryTime: 1,
      entry: 100,
      size: 1,
      sl: 90,
      tp: 110,
      status: "CLOSED",
      result: 25,
      comment: "",
    },
    {
      id: "closed-loss",
      side: "SHORT",
      entryTime: 2,
      entry: 100,
      size: 1,
      sl: 110,
      tp: 90,
      status: "CLOSED",
      result: -10,
      comment: "",
    },
    {
      id: "open-long",
      side: "LONG",
      entryTime: 3,
      entry: 100,
      size: 2,
      sl: 95,
      tp: 115,
      status: "OPEN",
      entryFee: 1,
      comment: "",
    },
    {
      id: "pending",
      side: "LONG",
      entryTime: 4,
      entry: 100,
      size: 1,
      sl: 95,
      tp: 115,
      status: "PENDING",
      leverage: 10,
      comment: "",
    },
  ];

  const stats = calculateAccountStats(account, trades, candle);

  assert.equal(stats.realizedPnl, 15);
  assert.equal(stats.unrealizedPnl, 19);
  assert.equal(stats.balance, 1_015);
  assert.equal(stats.equity, 1_034);
  assert.equal(stats.usedMargin, 210);
  assert.equal(stats.availableBalance, 805);
  assert.equal(stats.growthPct, 3.4000000000000004);
  assert.equal(stats.closedTradeCount, 2);
  assert.equal(stats.openTradeCount, 1);
});

test("uses zero unrealized pnl when current candle is not available", () => {
  const trades: Trade[] = [
    {
      id: "open-short",
      side: "SHORT",
      entryTime: 1,
      entry: 100,
      size: 2,
      sl: 110,
      tp: 90,
      status: "OPEN",
      comment: "",
    },
  ];

  const stats = calculateAccountStats(account, trades);

  assert.equal(stats.balance, 1_000);
  assert.equal(stats.equity, 1_000);
  assert.equal(stats.growthPct, 0);
});
