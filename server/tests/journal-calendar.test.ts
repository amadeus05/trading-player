import assert from "node:assert/strict";
import test from "node:test";
import type { Trade } from "../../src/types";
import {
  buildJournalCalendar,
  calendarMonthGrid,
  mondayOffset,
  utcDateParts,
} from "../../src/features/journal/calendarModel";

const trade = (
  partial: Pick<Trade, "id" | "entryTime" | "exitTime" | "result" | "outcome">,
): Trade => ({
  side: "LONG",
  entry: 100,
  size: 1,
  sl: 90,
  tp: 110,
  status: "CLOSED",
  comment: "",
  ...partial,
});

test("splits closed trades into utc years months and days", () => {
  const calendar = buildJournalCalendar([
    trade({
      id: "feb-win",
      entryTime: Math.floor(Date.UTC(2026, 1, 3, 22, 5) / 1000),
      exitTime: Math.floor(Date.UTC(2026, 1, 3, 23, 0) / 1000),
      result: 20,
      outcome: "TP",
    }),
    trade({
      id: "feb-loss",
      entryTime: Math.floor(Date.UTC(2026, 1, 3, 10, 0) / 1000),
      exitTime: Math.floor(Date.UTC(2026, 1, 3, 11, 0) / 1000),
      result: -8,
      outcome: "SL",
    }),
    trade({
      id: "jan",
      entryTime: Math.floor(Date.UTC(2025, 0, 15, 8, 0) / 1000),
      exitTime: Math.floor(Date.UTC(2025, 0, 15, 9, 0) / 1000),
      result: 5,
      outcome: "MANUAL",
    }),
  ]);

  assert.deepEqual(calendar.years, [2025, 2026]);
  const y26 = calendar.byYear.get(2026)!;
  assert.equal(y26.trades, 2);
  assert.equal(y26.pnl, 12);
  assert.equal(y26.takes, 1);
  assert.equal(y26.stops, 1);
  assert.equal(y26.months[1].trades, 2);
  assert.equal(y26.months[1].wins, 1);
  assert.equal(y26.months[1].days[2].trades, 2);
  assert.equal(y26.months[1].days[2].pnl, 12);
  assert.equal(y26.months[0].trades, 0);
});

test("drawdown is peak to trough inside the period", () => {
  const calendar = buildJournalCalendar([
    trade({
      id: "a",
      entryTime: 10,
      exitTime: 20,
      result: 30,
      outcome: "TP",
    }),
    trade({
      id: "b",
      entryTime: 30,
      exitTime: 40,
      result: -50,
      outcome: "SL",
    }),
    trade({
      id: "c",
      entryTime: 50,
      exitTime: 60,
      result: 10,
      outcome: "TP",
    }),
  ]);

  const year = calendar.byYear.get(utcDateParts(20).year)!;
  assert.equal(year.drawdown, 50);
});

test("month grid starts on monday", () => {
  assert.equal(mondayOffset(2026, 2), 6);
  const calendar = buildJournalCalendar([
    trade({
      id: "one",
      entryTime: Math.floor(Date.UTC(2026, 1, 1) / 1000),
      exitTime: Math.floor(Date.UTC(2026, 1, 1, 1) / 1000),
      result: 1,
      outcome: "TP",
    }),
  ]);
  const grid = calendarMonthGrid(calendar.byYear.get(2026)!.months[1]);
  assert.equal(grid[0], null);
  assert.equal(grid[6]?.day, 1);
});
