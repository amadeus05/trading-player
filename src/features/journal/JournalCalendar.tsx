import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronLeft } from "lucide-react";
import type { Trade } from "../../types";
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
} from "./calendarModel";

interface JournalCalendarProps {
  trades: Trade[];
  onJumpToTrade?: (trade: Trade) => void;
  datasetName: (id?: string) => string;
}

const signClass = (value: number) => (value >= 0 ? "pos" : "neg");
const signed = (value: number) => `${value >= 0 ? "+" : ""}${formatNumber(value)}`;

function toneOf(stats: CalendarStats): "pos" | "neg" | "empty" {
  if (stats.trades === 0) return "empty";
  return stats.pnl >= 0 ? "pos" : "neg";
}

function StatsLine({ stats, compact = false }: { stats: CalendarStats; compact?: boolean }) {
  return (
    <div className={`journalCalMeta ${compact ? "is-compact" : ""}`}>
      <span className="journalCalChip">{stats.trades} сд.</span>
      <span className={`journalCalChip ${stats.takes ? "is-tp" : ""}`}>TP {stats.takes}</span>
      <span className={`journalCalChip ${stats.stops ? "is-sl" : ""}`}>SL {stats.stops}</span>
      {stats.drawdown > 0 && (
        <span className="journalCalChip is-dd">DD {formatNumber(stats.drawdown)}</span>
      )}
    </div>
  );
}

export function JournalCalendar({ trades, onJumpToTrade, datasetName }: JournalCalendarProps) {
  const model = useMemo(() => buildJournalCalendar(trades), [trades]);
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);

  useEffect(() => {
    const latest = model.years.at(-1) ?? null;
    setYear((current) => (current != null && model.byYear.has(current) ? current : latest));
    setMonth(null);
    setDayKey(null);
  }, [model]);

  const yearRow = year != null ? model.byYear.get(year) : undefined;
  const monthRow = yearRow && month != null ? yearRow.months[month - 1] : undefined;
  const peakMonth = Math.max(1, ...(yearRow?.months.map((item) => Math.abs(item.pnl)) ?? [1]));
  const dayTrades = useMemo(() => {
    if (!dayKey) return [];
    return trades
      .filter((trade) => trade.status === "CLOSED" && tradeDayKey(trade) === dayKey)
      .sort((left, right) => (right.exitTime ?? right.entryTime) - (left.exitTime ?? left.entryTime));
  }, [dayKey, trades]);

  if (!model.years.length) {
    return <div className="journalEmpty">Закрытых сделок пока нет — календарь появится после первой.</div>;
  }

  return (
    <div className="journalCal">
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

      {yearRow && !monthRow && (
        <>
          <div className="journalCalHead">
            <div>
              <span className="journalCalHeadLabel">{yearRow.year}</span>
              <b className={signClass(yearRow.pnl)}>{signed(yearRow.pnl)}</b>
            </div>
            <StatsLine stats={yearRow} />
          </div>
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
        </>
      )}

      {yearRow && monthRow && (
        <>
          <div className="journalCalHead">
            <button
              type="button"
              className="journalCalBack"
              onClick={() => {
                setMonth(null);
                setDayKey(null);
              }}
            >
              <ChevronLeft size={15} strokeWidth={2.2} />
              {yearRow.year}
              <span className="journalCalHeadLabel">{MONTH_NAMES[monthRow.month - 1]}</span>
            </button>
            <b className={monthRow.trades ? signClass(monthRow.pnl) : ""}>
              {monthRow.trades ? signed(monthRow.pnl) : "нет сделок"}
            </b>
            <StatsLine stats={monthRow} />
          </div>
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
              onJumpToTrade={onJumpToTrade}
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
  return (
    <button
      type="button"
      className={`journalCalMonth ${toneOf(month)}`}
      onClick={onOpen}
      style={empty ? undefined : {
        "--journal-cal-fill": String(fill),
      } as CSSProperties}
    >
      <span className="journalCalMonthName">{MONTH_NAMES[month.month - 1]}</span>
      {empty ? (
        <span className="journalCalMonthIdle">нет сделок</span>
      ) : (
        <>
          <b className={signClass(month.pnl)}>{signed(month.pnl)}</b>
          <StatsLine stats={month} compact />
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
  return (
    <button
      type="button"
      className={`journalCalDay ${toneOf(day)} ${selected ? "is-selected" : ""}`}
      disabled={empty}
      onClick={onSelect}
    >
      <span className="journalCalDayNum">{day.day}</span>
      {empty ? null : (
        <>
          <b className={signClass(day.pnl)}>{signed(day.pnl)}</b>
          <i>{day.trades} сд.</i>
        </>
      )}
    </button>
  );
}

function DayTrades({
  day,
  trades,
  datasetName,
  onJumpToTrade,
}: {
  day?: CalendarDay;
  trades: Trade[];
  datasetName: (id?: string) => string;
  onJumpToTrade?: (trade: Trade) => void;
}) {
  if (!day) return null;
  return (
    <div className="journalCalDayList">
      <div className="journalCalDayListHead">
        {day.day} {MONTH_NAMES[day.month - 1].toLowerCase()}
        <b className={signClass(day.pnl)}>{signed(day.pnl)}</b>
      </div>
      {trades.map((trade) => (
        <button
          key={trade.id}
          type="button"
          className="journalCalDayTrade"
          onClick={() => onJumpToTrade?.(trade)}
        >
          <span className={trade.side === "LONG" ? "pos" : "neg"}>{trade.side}</span>
          <span>{datasetName(trade.datasetId)}</span>
          <span className="journalCalDayTradeOut">{trade.outcome ?? trade.status}</span>
          <b className={trade.result == null ? "" : signClass(trade.result)}>
            {trade.result == null ? "—" : signed(trade.result)}
          </b>
        </button>
      ))}
    </div>
  );
}
