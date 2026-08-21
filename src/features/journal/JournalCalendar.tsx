import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CalendarDays, ChevronLeft } from "lucide-react";
import type { Trade, TradeScreenshot } from "../../types";
import { formatNumber } from "../../shared/lib/market";
import {
  MONTH_NAMES,
  WEEKDAY_LABELS,
  buildJournalCalendar,
  calendarMonthGrid,
  tradeDayKey,
  type CalendarDay,
  type CalendarMonth,
  type CalendarStats,
  calendarWinRatePct,
} from "./calendarModel";
import { JournalTradeTable } from "./JournalTradeTable";

interface JournalCalendarProps {
  trades: Trade[];
  datasetName: (id?: string) => string;
  knownTags: string[];
  onJumpToTrade?: (trade: Trade) => void;
  onCancelOrder: (id: string) => void;
  onCloseTrade: (trade: Trade) => void;
  onDeleteTrade: (id: string) => void;
  onUpdateTradeJournal: (id: string, patch: { comment?: string; screenshots?: TradeScreenshot[]; tags?: string[] }) => void;
}

const signClass = (value: number) => (value >= 0 ? "pos" : "neg");
const signed = (value: number) => `${value >= 0 ? "+" : ""}${formatNumber(value)}`;

function toneOf(stats: CalendarStats): "pos" | "neg" | "empty" {
  if (stats.trades === 0) return "empty";
  return stats.pnl >= 0 ? "pos" : "neg";
}

function StatsLine({ stats }: { stats: CalendarStats }) {
  return (
    <div className="journalCalMetaMetrics">
      <span>
        <i>сделки</i>
        <em>{stats.trades}</em>
      </span>
      <span>
        <i>TP / SL</i>
        <em>
          <b className={stats.takes ? "is-tp" : ""}>{stats.takes}</b>
          <span>/</span>
          <b className={stats.stops ? "is-sl" : ""}>{stats.stops}</b>
        </em>
      </span>
      {stats.drawdown > 0 && (
        <span className="is-dd">
          <i>DD</i>
          <em>{formatNumber(stats.drawdown)}</em>
        </span>
      )}
    </div>
  );
}

export function JournalCalendar({
  trades,
  datasetName,
  knownTags,
  onJumpToTrade,
  onCancelOrder,
  onCloseTrade,
  onDeleteTrade,
  onUpdateTradeJournal,
}: JournalCalendarProps) {
  const model = useMemo(() => buildJournalCalendar(trades), [trades]);
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);

  useEffect(() => {
    const nextYear = year != null && model.byYear.has(year) ? year : (model.years.at(-1) ?? null);
    if (nextYear !== year) {
      setYear(nextYear);
      setMonth(null);
      setDayKey(null);
      return;
    }
    if (nextYear == null) {
      setMonth(null);
      setDayKey(null);
      return;
    }
    const yearRow = model.byYear.get(nextYear);
    if (month != null && !yearRow?.months[month - 1]) {
      setMonth(null);
      setDayKey(null);
      return;
    }
    setDayKey((current) => {
      if (!current || !yearRow) return null;
      return yearRow.months.some((item) => item.days.some((day) => day.key === current)) ? current : null;
    });
  }, [model, year, month]);

  const yearRow = year != null ? model.byYear.get(year) : undefined;
  const monthRow = yearRow && month != null ? yearRow.months[month - 1] : undefined;
  const peakMonth = Math.max(1, ...(yearRow?.months.map((item) => Math.abs(item.pnl)) ?? [1]));
  const dayTrades = useMemo(() => {
    if (!dayKey) return [];
    return trades.filter((trade) => trade.status === "CLOSED" && tradeDayKey(trade) === dayKey);
  }, [dayKey, trades]);

  if (!model.years.length) {
    return <div className="journalEmpty">Закрытых сделок пока нет — календарь появится после первой.</div>;
  }

  const activeStats = monthRow ?? yearRow;

  return (
    <div className="journalCal">
      <div className="journalCalTopRow">
        <div className="journalCalTopRowStart">
          {monthRow ? (
            <>
              <button
                type="button"
                className="journalCalBack"
                onClick={() => {
                  setMonth(null);
                  setDayKey(null);
                }}
              >
                <ChevronLeft size={15} strokeWidth={2.2} />
              </button>
              <span className="journalCalTopRowTitle">{MONTH_NAMES[monthRow.month - 1]}</span>
            </>
          ) : (
            <div className="journalCalYears">
              {model.years.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`journalCalYear ${year === value ? "is-active" : ""}`}
                  onClick={() => {
                    setYear(value);
                    setMonth(null);
                    setDayKey(null);
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
          )}
        </div>
        {activeStats && activeStats.trades > 0 && (
          <b className={`journalCalTopPnl ${signClass(activeStats.pnl)}`}>{signed(activeStats.pnl)}</b>
        )}
      </div>

      {activeStats && activeStats.trades > 0 && (
        <div className="journalCalMetaRow">
          <StatsLine stats={activeStats} />
          <span className={`journalCalMetaWr ${calendarWinRatePct(activeStats) >= 50 ? "pos" : "neg"}`}>
            <i>WR</i>
            <em>{calendarWinRatePct(activeStats).toFixed(0)}%</em>
          </span>
        </div>
      )}

      {yearRow && !monthRow && (
        <div className="journalCalMonths">
            {yearRow.months.map((item) => (
              <MonthCard
                key={item.month}
                month={item}
                peak={peakMonth}
                onOpen={() => {
                  setMonth(item.month);
                  setDayKey(null);
                }}
              />
            ))}
        </div>
      )}

      {yearRow && monthRow && (
        <>
          <div className="journalCalWeekdays">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="journalCalDays">
            {calendarMonthGrid(monthRow).map((day, index) => (
              <DayCard
                key={day?.key ?? `pad-${index}`}
                day={day}
                selected={day?.key === dayKey}
                onSelect={() => setDayKey(day && day.trades ? day.key : null)}
              />
            ))}
          </div>
          {dayKey && (
            <DayTrades
              day={monthRow.days.find((item) => item.key === dayKey)}
              trades={dayTrades}
              datasetName={datasetName}
              knownTags={knownTags}
              onJumpToTrade={onJumpToTrade}
              onCancelOrder={onCancelOrder}
              onCloseTrade={onCloseTrade}
              onDeleteTrade={onDeleteTrade}
              onUpdateTradeJournal={onUpdateTradeJournal}
            />
          )}
        </>
      )}
    </div>
  );
}

function MonthCard({
  month,
  peak,
  onOpen,
}: {
  month: CalendarMonth;
  peak: number;
  onOpen: () => void;
}) {
  const empty = month.trades === 0;
  const fill = empty ? 0 : Math.max(0.08, Math.abs(month.pnl) / peak);
  const winRate = calendarWinRatePct(month);
  const winTone = winRate >= 50 ? "pos" : "neg";
  return (
    <button
      type="button"
      className={`journalCalMonth ${toneOf(month)}`}
      onClick={onOpen}
      style={empty ? undefined : {
        "--journal-cal-fill": String(fill),
      } as CSSProperties}
    >
      <span className="journalCalMonthTop">
        <span className="journalCalMonthTitle">
          <span className="journalCalMonthIcon" aria-hidden="true">
            <CalendarDays size={13} strokeWidth={2} />
          </span>
          <span className="journalCalMonthName">{MONTH_NAMES[month.month - 1]}</span>
        </span>
        {!empty && <span className="journalCalMonthCount">{month.trades}</span>}
      </span>
      {empty ? (
        <span className="journalCalMonthIdle">нет сделок</span>
      ) : (
        <>
          <span className="journalCalMonthPnl">
            <b className={signClass(month.pnl)}>{signed(month.pnl)}</b>
            {month.drawdown > 0 && (
              <span className="journalCalMonthDd">
                <i>max. DD</i>
                <em>{formatNumber(month.drawdown)}</em>
              </span>
            )}
          </span>
          <span className="journalCalMonthStats">
            <span>
              <span className={month.takes ? "is-tp" : ""}>TP {month.takes}</span>
              <span className="journalCalMonthSlash">/</span>
              <span className={month.stops ? "is-sl" : ""}>SL {month.stops}</span>
            </span>
            <span className={`journalCalMonthWr ${winTone}`}>WR {winRate.toFixed(0)}%</span>
          </span>
        </>
      )}
    </button>
  );
}

function DayCard({
  day,
  selected,
  onSelect,
}: {
  day: CalendarDay | null;
  selected: boolean;
  onSelect: () => void;
}) {
  if (!day) return <div className="journalCalDay is-pad" />;
  const empty = day.trades === 0;
  const winRate = calendarWinRatePct(day);
  return (
    <button
      type="button"
      className={`journalCalDay ${toneOf(day)} ${selected ? "is-selected" : ""}`}
      disabled={empty}
      onClick={onSelect}
    >
      <span className="journalCalDayTop">
        <span className="journalCalDayNum">{day.day}</span>
        {!empty && <span className="journalCalDayCount">{day.trades}</span>}
      </span>
      {!empty && (
        <span className="journalCalDayPnl">
          <b className={signClass(day.pnl)}>{signed(day.pnl)}</b>
          <em className={winRate >= 50 ? "pos" : "neg"}>{winRate.toFixed(0)}%</em>
        </span>
      )}
    </button>
  );
}

function DayTrades({
  day,
  trades,
  datasetName,
  knownTags,
  onJumpToTrade,
  onCancelOrder,
  onCloseTrade,
  onDeleteTrade,
  onUpdateTradeJournal,
}: {
  day?: CalendarDay;
  trades: Trade[];
  datasetName: (id?: string) => string;
  knownTags: string[];
  onJumpToTrade?: (trade: Trade) => void;
  onCancelOrder: (id: string) => void;
  onCloseTrade: (trade: Trade) => void;
  onDeleteTrade: (id: string) => void;
  onUpdateTradeJournal: JournalCalendarProps["onUpdateTradeJournal"];
}) {
  if (!day) return null;
  return (
    <div className="journalCalDayList">
      <div className="journalCalDayListHead">
        {day.day} {MONTH_NAMES[day.month - 1].toLowerCase()}
        <b className={signClass(day.pnl)}>{signed(day.pnl)}</b>
      </div>
      <JournalTradeTable
        trades={trades}
        datasetName={datasetName}
        knownTags={knownTags}
        onJumpToTrade={onJumpToTrade}
        onCancelOrder={onCancelOrder}
        onCloseTrade={onCloseTrade}
        onDeleteTrade={onDeleteTrade}
        onUpdateTradeJournal={onUpdateTradeJournal}
      />
    </div>
  );
}
