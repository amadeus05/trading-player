import assert from "node:assert/strict";
import test from "node:test";
import type { Trade } from "../../src/types";
import {
  CHART_TIMEZONE_CITIES,
  CHART_TIMEZONE_EXCHANGE,
  CHART_TIMEZONE_UTC,
  DEFAULT_CHART_TIMEZONE,
  exchangeTimeZoneIana,
  formatChartAxisTime,
  formatChartCrosshairTime,
  formatChartTickMark,
  formatChartTimeZoneButtonLabel,
  formatChartTimeZoneMenuLabel,
  formatUtcOffsetTag,
  resolveChartTimeZoneIana,
  sanitizeChartTimeZone,
  zonedDateBarStart,
  zonedDateParts,
  zonedDayBounds,
  zonedWallTime,
  zoneOffsetSeconds,
} from "../../src/shared/lib/chartTimezones";
import { aggregateCandles, formatDateTime } from "../../src/shared/lib/market";
import { buildJournalCalendar } from "../../src/features/journal/calendarModel";

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1_000);

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

test("menu list matches TradingView specials and city count", () => {
  assert.equal(CHART_TIMEZONE_CITIES.length, 97);
  const ids = CHART_TIMEZONE_CITIES.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(CHART_TIMEZONE_CITIES.some((item) => item.id === "moscow" && item.iana === "Europe/Moscow"));
  assert.ok(CHART_TIMEZONE_CITIES.some((item) => item.id === "new-york" && item.iana === "America/New_York"));
  assert.ok(CHART_TIMEZONE_CITIES.some((item) => item.id === "kathmandu" && item.iana === "Asia/Kathmandu"));
  assert.ok(CHART_TIMEZONE_CITIES.some((item) => item.id === "chatham-islands" && item.iana === "Pacific/Chatham"));
});

test("sanitize keeps known ids and falls back to utc", () => {
  assert.equal(sanitizeChartTimeZone("utc"), CHART_TIMEZONE_UTC);
  assert.equal(sanitizeChartTimeZone("exchange"), CHART_TIMEZONE_EXCHANGE);
  assert.equal(sanitizeChartTimeZone("moscow"), "moscow");
  assert.equal(sanitizeChartTimeZone("Europe/Moscow"), DEFAULT_CHART_TIMEZONE);
  assert.equal(sanitizeChartTimeZone(null), DEFAULT_CHART_TIMEZONE);
  assert.equal(sanitizeChartTimeZone("not-a-zone"), DEFAULT_CHART_TIMEZONE);
});

test("exchange timezone is UTC for crypto and New York otherwise", () => {
  assert.equal(exchangeTimeZoneIana("linear"), "UTC");
  assert.equal(exchangeTimeZoneIana("inverse"), "UTC");
  assert.equal(exchangeTimeZoneIana("spot"), "UTC");
  assert.equal(exchangeTimeZoneIana(), "UTC");
  assert.equal(exchangeTimeZoneIana("forex"), "America/New_York");
  assert.equal(resolveChartTimeZoneIana("exchange", "linear"), "UTC");
  assert.equal(resolveChartTimeZoneIana("exchange", "forex"), "America/New_York");
  assert.equal(resolveChartTimeZoneIana("utc"), "UTC");
  assert.equal(resolveChartTimeZoneIana("moscow"), "Europe/Moscow");
});

test("Moscow has no DST: always UTC+3", () => {
  const winter = unix("2026-01-15T12:00:00Z");
  const summer = unix("2026-07-15T12:00:00Z");
  assert.equal(zoneOffsetSeconds("Europe/Moscow", winter), 3 * 3_600);
  assert.equal(zoneOffsetSeconds("Europe/Moscow", summer), 3 * 3_600);
  assert.deepEqual(zonedDateParts("Europe/Moscow", winter), {
    year: 2026, month: 1, day: 15, hour: 15, minute: 0, second: 0, weekday: 4,
  });
  assert.equal(formatUtcOffsetTag(3 * 3_600), "(UTC+3)");
  assert.equal(formatChartTimeZoneMenuLabel("moscow", "Europe/Moscow", summer), "(UTC+3) Moscow");
  assert.equal(formatChartTimeZoneButtonLabel("moscow", "Europe/Moscow", summer), "UTC+3");
});

test("New York DST spring forward skips local 02:00", () => {
  // 2026-03-08 07:00 UTC — переход 02:00 EST → 03:00 EDT.
  const before = unix("2026-03-08T06:59:00Z");
  const after = unix("2026-03-08T07:00:00Z");
  const beforeParts = zonedDateParts("America/New_York", before);
  const afterParts = zonedDateParts("America/New_York", after);
  assert.equal(beforeParts.hour, 1);
  assert.equal(beforeParts.minute, 59);
  assert.equal(zoneOffsetSeconds("America/New_York", before), -5 * 3_600);
  assert.equal(afterParts.hour, 3);
  assert.equal(afterParts.minute, 0);
  assert.equal(zoneOffsetSeconds("America/New_York", after), -4 * 3_600);
  assert.equal(formatChartTimeZoneMenuLabel("new-york", "America/New_York", after), "(UTC-4) New York");
  assert.equal(formatChartTimeZoneMenuLabel("new-york", "America/New_York", unix("2026-01-15T12:00:00Z")), "(UTC-5) New York");
});

test("New York DST fall back repeats local 01:00", () => {
  // 2026-11-01 06:00 UTC — переход 02:00 EDT → 01:00 EST.
  const first = unix("2026-11-01T05:30:00Z");
  const second = unix("2026-11-01T06:30:00Z");
  const firstParts = zonedDateParts("America/New_York", first);
  const secondParts = zonedDateParts("America/New_York", second);
  assert.equal(firstParts.hour, 1);
  assert.equal(firstParts.minute, 30);
  assert.equal(zoneOffsetSeconds("America/New_York", first), -4 * 3_600);
  assert.equal(secondParts.hour, 1);
  assert.equal(secondParts.minute, 30);
  assert.equal(zoneOffsetSeconds("America/New_York", second), -5 * 3_600);
  assert.notEqual(first, second);
});

test("London BST spring forward skips 01:00", () => {
  const before = unix("2026-03-29T00:59:00Z");
  const after = unix("2026-03-29T01:00:00Z");
  assert.equal(zonedDateParts("Europe/London", before).hour, 0);
  assert.equal(zonedDateParts("Europe/London", after).hour, 2);
  assert.equal(zoneOffsetSeconds("Europe/London", before), 0);
  assert.equal(zoneOffsetSeconds("Europe/London", after), 3_600);
});

test("Phoenix and Tokyo do not observe DST", () => {
  const winter = unix("2026-01-15T12:00:00Z");
  const summer = unix("2026-07-15T12:00:00Z");
  assert.equal(zoneOffsetSeconds("America/Phoenix", winter), -7 * 3_600);
  assert.equal(zoneOffsetSeconds("America/Phoenix", summer), -7 * 3_600);
  assert.equal(zoneOffsetSeconds("Asia/Tokyo", winter), 9 * 3_600);
  assert.equal(zoneOffsetSeconds("Asia/Tokyo", summer), 9 * 3_600);
});

test("fractional offsets keep minutes", () => {
  const at = unix("2026-01-15T12:00:00Z");
  assert.equal(formatUtcOffsetTag(zoneOffsetSeconds("Asia/Kolkata", at)), "(UTC+5:30)");
  assert.equal(formatUtcOffsetTag(zoneOffsetSeconds("Asia/Kathmandu", at)), "(UTC+5:45)");
  assert.equal(formatChartTimeZoneMenuLabel("kolkata", "Asia/Kolkata", at), "(UTC+5:30) Kolkata");
  assert.equal(formatChartTimeZoneButtonLabel("kathmandu", "Asia/Kathmandu", at), "UTC+5:45");
});

test("whole-hour offsets do not render as :60 when unix has a fraction", () => {
  const fractional = unix("2026-08-15T12:00:00Z") + 0.8;
  assert.equal(formatUtcOffsetTag(4 * 3_600 - 0.8), "(UTC+4)");
  assert.equal(formatUtcOffsetTag(zoneOffsetSeconds("Asia/Dubai", fractional)), "(UTC+4)");
  assert.equal(formatChartTimeZoneMenuLabel("dubai", "Asia/Dubai", fractional), "(UTC+4) Dubai");
  assert.equal(formatChartTimeZoneButtonLabel("sofia", "Europe/Sofia", fractional), "UTC+3");
});

test("zoned midnight converts civil date to unix without shifting the bar", () => {
  assert.equal(zonedWallTime("UTC", 2026, 2, 15), unix("2026-02-15T00:00:00Z"));
  assert.equal(zonedWallTime("Europe/Moscow", 2026, 2, 15), unix("2026-02-14T21:00:00Z"));
  assert.equal(zonedWallTime("America/New_York", 2026, 1, 15), unix("2026-01-15T05:00:00Z"));
});

test("date jump lands on the bar labelled with the chosen civil date", () => {
  const day = { year: 2026, month: 2, day: 15 };
  const hour = 3_600;
  const daily = 86_400;

  // Москва: местная полночь — вчерашние 21:00 UTC, на дневке это чужой бар.
  assert.equal(zonedDateBarStart("Europe/Moscow", day.year, day.month, day.day, hour), unix("2026-02-14T21:00:00Z"));
  assert.equal(zonedDateBarStart("Europe/Moscow", day.year, day.month, day.day, daily), unix("2026-02-15T00:00:00Z"));
  assert.equal(zonedDateBarStart("Europe/Moscow", day.year, day.month, day.day, 4 * hour), unix("2026-02-15T00:00:00Z"));

  // UTC не двигается, западные зоны берут первый бар с нужной подписью.
  assert.equal(zonedDateBarStart("UTC", day.year, day.month, day.day, daily), unix("2026-02-15T00:00:00Z"));
  assert.equal(zonedDateBarStart("America/New_York", day.year, day.month, day.day, hour), unix("2026-02-15T05:00:00Z"));
  assert.equal(zonedDateBarStart("America/New_York", day.year, day.month, day.day, daily), unix("2026-02-16T00:00:00Z"));

  // Дробный оффсет: 18:15 UTC попадает в часовой бар 18:00 с подписью 14-го.
  assert.equal(zonedDateBarStart("Asia/Kathmandu", day.year, day.month, day.day, hour), unix("2026-02-14T19:00:00Z"));

  for (const timeframeMinutes of [1, 3, 5, 7, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1_440]) {
    for (const timeZone of ["UTC", "Europe/Moscow", "America/New_York", "Asia/Kathmandu", "Pacific/Chatham"]) {
      const start = zonedDateBarStart(timeZone, day.year, day.month, day.day, timeframeMinutes * 60);
      const parts = zonedDateParts(timeZone, start);
      assert.deepEqual(
        { year: parts.year, month: parts.month, day: parts.day },
        day,
        `${timeZone} @ ${timeframeMinutes}m`,
      );
    }
  }
});

test("civil day bounds follow DST length: 23h spring, 25h fall, 24h otherwise", () => {
  const moscow = zonedDayBounds("Europe/Moscow", 2026, 2, 15);
  assert.equal(moscow.to - moscow.from, 86_399);

  const spring = zonedDayBounds("America/New_York", 2026, 3, 8);
  assert.equal(spring.from, unix("2026-03-08T05:00:00Z"));
  assert.equal(spring.to, unix("2026-03-09T04:00:00Z") - 1);
  assert.equal(spring.to - spring.from, 23 * 3_600 - 1);

  const fall = zonedDayBounds("America/New_York", 2026, 11, 1);
  assert.equal(fall.from, unix("2026-11-01T04:00:00Z"));
  assert.equal(fall.to, unix("2026-11-02T05:00:00Z") - 1);
  assert.equal(fall.to - fall.from, 25 * 3_600 - 1);
});

test("axis and tick labels follow the zone, not UTC", () => {
  const noonUtc = unix("2026-02-15T12:00:00Z");
  assert.equal(formatChartCrosshairTime(noonUtc, "UTC"), "Sun 15 Feb '26 12:00");
  assert.equal(formatChartCrosshairTime(noonUtc, "Europe/Moscow"), "Sun 15 Feb '26 15:00");
  assert.equal(formatChartAxisTime(noonUtc, 3_600, "Europe/Moscow"), "Sun 15 Feb '26 15:00");
  assert.equal(formatChartAxisTime(noonUtc, 86_400, "Europe/Moscow"), "Sun 15 Feb '26");
  assert.equal(formatChartTickMark(noonUtc, 0, "Europe/Moscow"), "2026");
  assert.equal(formatChartTickMark(noonUtc, 1, "Europe/Moscow"), "Feb '26");
  assert.equal(formatChartTickMark(noonUtc, 2, "Europe/Moscow"), "15");
  assert.equal(formatChartTickMark(noonUtc, 3, "Europe/Moscow"), "15:00");
  assert.equal(formatChartTickMark(noonUtc, 4, "Europe/Moscow"), "15:00:00");
});

test("replay clock formatDateTime defaults to UTC and accepts a zone", () => {
  const noonUtc = unix("2026-02-15T12:00:00Z");
  const utc = formatDateTime(noonUtc);
  const moscow = formatDateTime(noonUtc, "Europe/Moscow");
  assert.notEqual(utc, moscow);
  assert.match(utc, /12:00/);
  assert.match(moscow, /15:00/);
  assert.match(utc, /26/);
});

test("journal calendar buckets follow the display zone, UTC stays the default", () => {
  const lateUtc = trade({
    id: "late",
    entryTime: unix("2026-02-03T23:00:00Z"),
    exitTime: unix("2026-02-03T23:30:00Z"),
    result: 10,
    outcome: "TP",
  });
  const utcCalendar = buildJournalCalendar([lateUtc]);
  assert.equal(utcCalendar.byYear.get(2026)?.months[1].days[2].trades, 1);
  assert.equal(utcCalendar.byYear.get(2026)?.months[1].days[3]?.trades ?? 0, 0);

  const tokyoCalendar = buildJournalCalendar([lateUtc], "Asia/Tokyo");
  assert.equal(tokyoCalendar.byYear.get(2026)?.months[1].days[2].trades, 0);
  assert.equal(tokyoCalendar.byYear.get(2026)?.months[1].days[3].trades, 1);
});

test("display timezone does not rebucket daily candles", () => {
  const minutes = Array.from({ length: 1_440 }, (_, index) => ({
    time: unix("2026-02-15T00:00:00Z") + index * 60,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
  }));
  const daily = aggregateCandles(minutes, 1_440, 1);
  assert.equal(daily.length, 1);
  assert.equal(daily[0].time, unix("2026-02-15T00:00:00Z"));
  const moscowMidnight = zonedWallTime("Europe/Moscow", 2026, 2, 15);
  assert.notEqual(daily[0].time, moscowMidnight);
});
