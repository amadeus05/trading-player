import type { Trade } from "../../types";

export const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
] as const;

export const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

export interface CalendarStats {
  trades: number;
  pnl: number;
  wins: number;
  stops: number;
  takes: number;
  manuals: number;
  timeouts: number;
  drawdown: number;
}

export interface CalendarDay extends CalendarStats {
  year: number;
  month: number;
  day: number;
  key: string;
}

export interface CalendarMonth extends CalendarStats {
  year: number;
  month: number;
  days: CalendarDay[];
}

export interface CalendarYear extends CalendarStats {
  year: number;
  months: CalendarMonth[];
}

export interface JournalCalendarModel {
  years: number[];
  byYear: Map<number, CalendarYear>;
}

const EMPTY_STATS: CalendarStats = {
  trades: 0,
  pnl: 0,
  wins: 0,
  stops: 0,
  takes: 0,
  manuals: 0,
  timeouts: 0,
  drawdown: 0,
};

export function tradeCalendarTime(trade: Trade): number {
  return trade.exitTime ?? trade.entryTime;
}

export function utcDateParts(unixSeconds: number): { year: number; month: number; day: number } {
  const date = new Date(unixSeconds * 1_000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function utcDayBounds(year: number, month: number, day: number): { from: number; to: number } {
  return {
    from: Math.floor(Date.UTC(year, month - 1, day) / 1_000),
    to: Math.floor(Date.UTC(year, month - 1, day, 23, 59, 59) / 1_000),
  };
}

export function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Смещение первого дня месяца для сетки, которая начинается с понедельника. */
export function mondayOffset(year: number, month: number): number {
  return (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
}

function emptyStats(): CalendarStats {
  return { ...EMPTY_STATS };
}

function addTrade(stats: CalendarStats, trade: Trade): void {
  stats.trades += 1;
  stats.pnl += trade.result ?? 0;
  if ((trade.result ?? 0) > 0) stats.wins += 1;
  if (trade.outcome === "SL") stats.stops += 1;
  if (trade.outcome === "TP") stats.takes += 1;
  if (trade.outcome === "MANUAL") stats.manuals += 1;
  if (trade.outcome === "TIMEOUT") stats.timeouts += 1;
}

export function calendarWinRatePct(stats: CalendarStats): number {
  if (!stats.trades) return 0;
  return (stats.wins / stats.trades) * 100;
}

function periodDrawdown(trades: Trade[]): number {
  const closed = [...trades].sort((left, right) => tradeCalendarTime(left) - tradeCalendarTime(right));
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const trade of closed) {
    equity += trade.result ?? 0;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return drawdown;
}

function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function tradeDayKey(trade: Trade): string {
  const { year, month, day } = utcDateParts(tradeCalendarTime(trade));
  return dayKey(year, month, day);
}

function emptyDay(year: number, month: number, day: number): CalendarDay {
  return { ...emptyStats(), year, month, day, key: dayKey(year, month, day) };
}

function emptyMonth(year: number, month: number): CalendarMonth {
  const days = Array.from({ length: daysInUtcMonth(year, month) }, (_, index) => emptyDay(year, month, index + 1));
  return { ...emptyStats(), year, month, days };
}

function emptyYear(year: number): CalendarYear {
  return {
    ...emptyStats(),
    year,
    months: Array.from({ length: 12 }, (_, index) => emptyMonth(year, index + 1)),
  };
}

export function buildJournalCalendar(trades: Trade[]): JournalCalendarModel {
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const byYear = new Map<number, CalendarYear>();
  const tradesByYear = new Map<number, Trade[]>();
  const tradesByMonth = new Map<string, Trade[]>();
  const tradesByDay = new Map<string, Trade[]>();

  for (const trade of closed) {
    const { year, month, day } = utcDateParts(tradeCalendarTime(trade));
    const yearRow = byYear.get(year) ?? emptyYear(year);
    const monthRow = yearRow.months[month - 1];
    const dayRow = monthRow.days[day - 1];
    addTrade(yearRow, trade);
    addTrade(monthRow, trade);
    addTrade(dayRow, trade);
    byYear.set(year, yearRow);

    const monthKey = `${year}-${month}`;
    const dayId = dayKey(year, month, day);
    (tradesByYear.get(year) ?? tradesByYear.set(year, []).get(year)!).push(trade);
    (tradesByMonth.get(monthKey) ?? tradesByMonth.set(monthKey, []).get(monthKey)!).push(trade);
    (tradesByDay.get(dayId) ?? tradesByDay.set(dayId, []).get(dayId)!).push(trade);
  }

  for (const [year, yearRow] of byYear) {
    yearRow.drawdown = periodDrawdown(tradesByYear.get(year) ?? []);
    for (const monthRow of yearRow.months) {
      monthRow.drawdown = periodDrawdown(tradesByMonth.get(`${year}-${monthRow.month}`) ?? []);
      for (const dayRow of monthRow.days) {
        dayRow.drawdown = periodDrawdown(tradesByDay.get(dayRow.key) ?? []);
      }
    }
  }

  const years = [...byYear.keys()].sort((left, right) => left - right);
  return { years, byYear };
}

export function calendarMonthGrid(month: CalendarMonth): Array<CalendarDay | null> {
  const leading = mondayOffset(month.year, month.month);
  return [...Array.from({ length: leading }, () => null), ...month.days];
}
