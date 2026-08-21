import assert from "node:assert/strict";
import test from "node:test";
import type { Trade } from "../../src/types";
import {
  nextJournalTradeSort,
  sortJournalTrades,
  type JournalTradeSort,
} from "../../src/features/journal/sortJournalTrades";

const trade = (partial: Pick<Trade, "id" | "entryTime"> & { placedAt?: number }): Trade => ({
  side: "LONG",
  entry: 100,
  size: 1,
  sl: 90,
  tp: 110,
  status: "CLOSED",
  comment: "",
  ...partial,
});

const sort = (key: JournalTradeSort["key"], dir: JournalTradeSort["dir"]): JournalTradeSort => ({
  key,
  dir,
});

test("newest placed trade comes first by default direction", () => {
  const rows = sortJournalTrades([
    trade({ id: "old-chart", entryTime: 9_000, placedAt: 100 }),
    trade({ id: "last-click", entryTime: 1_000, placedAt: 300 }),
    trade({ id: "mid", entryTime: 5_000, placedAt: 200 }),
  ], sort("placedAt", "desc"));
  assert.deepEqual(rows.map((item) => item.id), ["last-click", "mid", "old-chart"]);
});

test("historical sort uses candle time, not the click", () => {
  const rows = sortJournalTrades([
    trade({ id: "old-chart", entryTime: 9_000, placedAt: 100 }),
    trade({ id: "last-click", entryTime: 1_000, placedAt: 300 }),
  ], sort("entryTime", "desc"));
  assert.deepEqual(rows.map((item) => item.id), ["old-chart", "last-click"]);
});

test("trades without placedAt sink below dated ones", () => {
  const rows = sortJournalTrades([
    trade({ id: "legacy", entryTime: 9_000 }),
    trade({ id: "fresh", entryTime: 1_000, placedAt: 50 }),
  ], sort("placedAt", "desc"));
  assert.deepEqual(rows.map((item) => item.id), ["fresh", "legacy"]);
});

test("clicking the same column flips direction, another column starts newest-first", () => {
  assert.deepEqual(
    nextJournalTradeSort({ key: "placedAt", dir: "desc" }, "placedAt"),
    { key: "placedAt", dir: "asc" },
  );
  assert.deepEqual(
    nextJournalTradeSort({ key: "placedAt", dir: "asc" }, "entryTime"),
    { key: "entryTime", dir: "desc" },
  );
});
