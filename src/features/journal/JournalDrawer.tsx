import { useMemo, useState } from "react";
import { Button, DatePicker, Drawer, Dropdown, Popover, Segmented, Select } from "antd";
import type { Dayjs } from "dayjs";
import { ChartNoAxesCombined, CalendarDays, Filter, List, MoreHorizontal, Trash2 } from "lucide-react";
import type { AccountSettings, Trade, TradeScreenshot } from "../../types";
import { formatNumber, formatTimeframe } from "../../shared/lib/market";
import { useConfirmDelete } from "../../shared/ui/useConfirmDelete";
import {
  calculateTradeAnalytics,
  filterTradesForAnalytics,
  type AnalyticsFilters,
} from "../trading/lib/calculateTradeAnalytics";
import { JournalTradeTable } from "./JournalTradeTable";
import { JournalCalendar } from "./JournalCalendar";
import { collectKnownTags } from "./tradeTags";

type JournalTab = "trades" | "calendar" | "stats";

const EQUITY_WIDTH = 600;
const EQUITY_HEIGHT = 72;

/**
 * Кривая эквити рисуется подложкой под крупным Net PnL, поэтому нужны обе
 * фигуры: линия поверх и залитая область под ней.
 */
function buildEquityShape(curve: Array<{ equity: number }>): { line: string; area: string } {
  if (curve.length < 2) return { line: "", area: "" };
  const values = curve.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1e-9, max - min);
  const lastIndex = curve.length - 1;
  const line = curve.map((point, index) => {
    const x = (index / lastIndex) * EQUITY_WIDTH;
    const y = EQUITY_HEIGHT - ((point.equity - min) / range) * (EQUITY_HEIGHT - 6) - 3;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return { line, area: `${line} L ${EQUITY_WIDTH} ${EQUITY_HEIGHT} L 0 ${EQUITY_HEIGHT} Z` };
}

interface Bucket {
  key: string;
  label: string;
  trades: number;
  pnl: number;
  wins: number;
}

/** Разрезы на вкладке статистики считаются только по закрытым сделкам. */
function groupTrades(
  trades: Trade[],
  keyOf: (trade: Trade) => string | null,
  labelOf: (key: string) => string,
): Bucket[] {
  const buckets = new Map<string, Bucket>();
  for (const trade of trades) {
    if (trade.status !== "CLOSED") continue;
    const key = keyOf(trade);
    if (key == null) continue;
    const bucket = buckets.get(key) ?? { key, label: labelOf(key), trades: 0, pnl: 0, wins: 0 };
    bucket.trades += 1;
    bucket.pnl += trade.result ?? 0;
    if ((trade.result ?? 0) > 0) bucket.wins += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((left, right) => right.trades - left.trades);
}

interface JournalDrawerProps {
  open: boolean;
  account: AccountSettings;
  trades: Trade[];
  datasetOptions: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCancelOrder: (id: string) => void;
  onCloseTrade: (trade: Trade) => void;
  onDeleteTrade: (id: string) => void;
  onDeleteAllTrades: () => void;
  onUpdateTradeJournal: (id: string, patch: { comment?: string; screenshots?: TradeScreenshot[]; tags?: string[] }) => void;
  /** Перемотка плеера к сделке: журнал закрывается, график встаёт на её вход. */
  onJumpToTrade?: (trade: Trade) => void;
}

export function JournalDrawer({
  open,
  account,
  trades,
  datasetOptions,
  onClose,
  onCancelOrder,
  onCloseTrade,
  onDeleteTrade,
  onDeleteAllTrades,
  onUpdateTradeJournal,
  onJumpToTrade,
}: JournalDrawerProps) {
  const confirmDelete = useConfirmDelete();
  const [tab, setTab] = useState<JournalTab>("trades");
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [datasetId, setDatasetId] = useState<string>("all");
  const [timeframe, setTimeframe] = useState<number | "all">("all");
  const [side, setSide] = useState<Trade["side"] | "all">("all");
  const [outcome, setOutcome] = useState<NonNullable<Trade["outcome"]> | "all">("all");
  const [tag, setTag] = useState<string>("all");

  const datasetNameById = useMemo(
    () => new Map(datasetOptions.map((option) => [option.id, option.name])),
    [datasetOptions],
  );
  const datasetName = (id?: string) => id ? datasetNameById.get(id) ?? id : "—";

  const datasetFilterOptions = useMemo(() => {
    const ids = new Set(trades.flatMap((trade) => trade.datasetId ? [trade.datasetId] : []));
    return [...ids].map((id) => ({ value: id, label: datasetName(id) }));
  }, [datasetNameById, trades]);

  const timeframeFilterOptions = useMemo(() => {
    const values = [...new Set(trades.flatMap((trade) => trade.timeframeMinutes ? [trade.timeframeMinutes] : []))]
      .sort((left, right) => left - right);
    return values.map((value) => ({ value, label: formatTimeframe(value) }));
  }, [trades]);

  const filters = useMemo<AnalyticsFilters>(() => ({
    ...(dateRange
      ? {
          fromTime: dateRange[0].startOf("day").unix(),
          toTime: dateRange[1].endOf("day").unix(),
        }
      : {}),
    datasetId: datasetId === "all" ? undefined : datasetId,
    timeframeMinutes: timeframe === "all" ? undefined : timeframe,
    side: side === "all" ? undefined : side,
    outcome: outcome === "all" ? undefined : outcome,
    tag: tag === "all" ? undefined : tag,
  }), [datasetId, dateRange, outcome, side, tag, timeframe]);

  const filteredTrades = useMemo(
    () => filterTradesForAnalytics(trades, filters),
    [filters, trades],
  );
  const analytics = useMemo(
    () => calculateTradeAnalytics(account, trades, filters),
    [account, filters, trades],
  );
  const equity = useMemo(() => buildEquityShape(analytics.equityCurve), [analytics.equityCurve]);

  const byTimeframe = useMemo(
    () => groupTrades(filteredTrades, (trade) => trade.timeframeMinutes ? String(trade.timeframeMinutes) : null, (key) => formatTimeframe(Number(key))),
    [filteredTrades],
  );
  const bySymbol = useMemo(
    () => groupTrades(filteredTrades, (trade) => trade.datasetId ?? null, datasetName),
    [datasetNameById, filteredTrades],
  );
  const knownTags = useMemo(() => collectKnownTags(trades), [trades]);
  const byTag = useMemo(() => {
    const buckets = new Map<string, Bucket>();
    for (const trade of filteredTrades) {
      if (trade.status !== "CLOSED") continue;
      const labels = trade.tags?.length ? [...new Set(trade.tags)] : ["__untagged__"];
      for (const key of labels) {
        const bucket = buckets.get(key) ?? {
          key,
          label: key === "__untagged__" ? "Без тега" : key,
          trades: 0,
          pnl: 0,
          wins: 0,
        };
        bucket.trades += 1;
        bucket.pnl += trade.result ?? 0;
        if ((trade.result ?? 0) > 0) bucket.wins += 1;
        buckets.set(key, bucket);
      }
    }
    return [...buckets.values()].sort((left, right) => right.trades - left.trades);
  }, [filteredTrades]);

  const activeFilterCount = [
    dateRange != null,
    datasetId !== "all",
    timeframe !== "all",
    side !== "all",
    outcome !== "all",
    tag !== "all",
  ].filter(Boolean).length;

  const filterSummary = activeFilterCount === 0
    ? "Весь период · все"
    : `Фильтров: ${activeFilterCount}`;

  const resetFilters = () => {
    setDateRange(null);
    setDatasetId("all");
    setTimeframe("all");
    setSide("all");
    setOutcome("all");
    setTag("all");
  };

  const signClass = (value: number) => value >= 0 ? "pos" : "neg";
  const signed = (value: number) => `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
  const nullable = (value: number | null, suffix = "") => value == null ? "—" : `${formatNumber(value)}${suffix}`;

  const pnlPct = account.initialBalance > 0
    ? (analytics.totalPnl / account.initialBalance) * 100
    : 0;

  const filterPanel = (
    <div className="journalFilterPanel">
      <label>
        <span>Даты</span>
        <DatePicker.RangePicker
          value={dateRange}
          allowClear
          onChange={(value) => {
            const [from, to] = value ?? [];
            setDateRange(from && to ? [from, to] : null);
          }}
        />
      </label>
      <label>
        <span>Инструмент</span>
        <Select
          value={datasetId}
          onChange={setDatasetId}
          options={[{ value: "all", label: "Все монеты" }, ...datasetFilterOptions]}
        />
      </label>
      <label>
        <span>Таймфрейм</span>
        <Select
          value={timeframe}
          onChange={setTimeframe}
          options={[{ value: "all", label: "Все TF" }, ...timeframeFilterOptions]}
        />
      </label>
      <label>
        <span>Направление</span>
        <Select
          value={side}
          onChange={setSide}
          options={[
            { value: "all", label: "LONG + SHORT" },
            { value: "LONG", label: "LONG" },
            { value: "SHORT", label: "SHORT" },
          ]}
        />
      </label>
      <label>
        <span>Выход</span>
        <Select
          value={outcome}
          onChange={setOutcome}
          options={[
            { value: "all", label: "Все выходы" },
            { value: "TP", label: "TP" },
            { value: "SL", label: "SL" },
            { value: "MANUAL", label: "Manual" },
            { value: "TIMEOUT", label: "Timeout" },
          ]}
        />
      </label>
      <label>
        <span>Тег</span>
        <Select
          showSearch
          value={tag}
          onChange={setTag}
          placeholder="Поиск тега"
          optionFilterProp="label"
          filterOption={(input, option) =>
            String(option?.label ?? "").toLowerCase().includes(input.trim().toLowerCase())
          }
          options={[{ value: "all", label: "Все теги" }, ...knownTags.map((value) => ({ value, label: value }))]}
        />
      </label>
      <Button size="small" disabled={!activeFilterCount} onClick={resetFilters}>Сбросить</Button>
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      size="large"
      rootClassName="journalDrawer"
      title={(
        <div className="journalHead">
          <span className="journalHeadTitle">Журнал</span>
          <Segmented<JournalTab>
            className="journalTabs"
            value={tab}
            onChange={setTab}
            options={[
              {
                value: "trades",
                label: (
                  <span className="journalTabLabel">
                    <List size={13} strokeWidth={2.2} />
                    Сделки
                  </span>
                ),
              },
              {
                value: "calendar",
                label: (
                  <span className="journalTabLabel">
                    <CalendarDays size={13} strokeWidth={2.2} />
                    Календарь
                  </span>
                ),
              },
              {
                value: "stats",
                label: (
                  <span className="journalTabLabel">
                    <ChartNoAxesCombined size={13} strokeWidth={2.2} />
                    Статистика
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}
      extra={(
        <div className="journalHeadActions">
          <Popover trigger="click" placement="bottomRight" content={filterPanel}>
            <Button icon={<Filter size={13} strokeWidth={2.2} />} className={activeFilterCount ? "journalFilterChip active" : "journalFilterChip"}>
              {filterSummary}
            </Button>
          </Popover>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [{
                key: "delete-all",
                danger: true,
                disabled: !trades.length,
                icon: <Trash2 size={14} />,
                label: `Удалить все сделки${trades.length ? ` (${trades.length})` : ""}`,
              }],
              onClick: () => confirmDelete({
                title: "Удалить все сделки?",
                content: `Сделок: ${trades.length}, включая скрытые фильтром. Удалятся вместе с разметкой на графике. Отменить нельзя.`,
                okText: "Удалить всё",
                onConfirm: onDeleteAllTrades,
              }),
            }}
          >
            <Button type="text" className="journalHeadMenu" aria-label="Действия журнала" icon={<MoreHorizontal size={16} />} />
          </Dropdown>
        </div>
      )}
    >
      <>
      {tab !== "calendar" && (
        <>
          <div className="journalHero">
            {equity.line && (
              <svg className={`journalHeroCurve ${signClass(analytics.totalPnl)}`} viewBox={`0 0 ${EQUITY_WIDTH} ${EQUITY_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
                <path className="area" d={equity.area} />
                <path className="line" d={equity.line} />
              </svg>
            )}
            <div className="journalHeroBody">
              <span className="journalHeroLabel">Net PnL</span>
              <div className="journalHeroRow">
                <b className={signClass(analytics.totalPnl)}>{signed(analytics.totalPnl)}</b>
                <span className={signClass(analytics.totalPnl)}>{signed(pnlPct)}%</span>
                <span className="journalHeroMeta">
                  {analytics.closedTrades} закрытых из {analytics.totalTrades} · комиссии {formatNumber(analytics.totalFees)}
                </span>
              </div>
            </div>
          </div>
          <div className="journalKpi">
            <div><span>Winrate</span><b>{analytics.winRatePct.toFixed(1)}%</b></div>
            <div><span>Profit factor</span><b>{analytics.profitFactor == null ? "∞" : analytics.profitFactor.toFixed(2)}</b></div>
            <div><span>Expectancy</span><b className={signClass(analytics.expectancy)}>{signed(analytics.expectancy)}</b></div>
            <div><span>Max DD</span><b className="neg">{formatNumber(analytics.maxDrawdown)} ({analytics.maxDrawdownPct.toFixed(1)}%)</b></div>
          </div>
        </>
      )}

      {tab === "trades" ? (
        <JournalTradeTable
          trades={filteredTrades}
          datasetName={datasetName}
          knownTags={knownTags}
          onJumpToTrade={onJumpToTrade}
          onCancelOrder={onCancelOrder}
          onCloseTrade={onCloseTrade}
          onDeleteTrade={onDeleteTrade}
          onUpdateTradeJournal={onUpdateTradeJournal}
          emptyText={trades.length ? "Под фильтр не попала ни одна сделка." : "Сделок пока нет — открой первую прямо на графике."}
        />
      ) : tab === "calendar" ? (
        <JournalCalendar
          trades={filteredTrades}
          datasetName={datasetName}
          knownTags={knownTags}
          onJumpToTrade={onJumpToTrade}
          onCancelOrder={onCancelOrder}
          onCloseTrade={onCloseTrade}
          onDeleteTrade={onDeleteTrade}
          onUpdateTradeJournal={onUpdateTradeJournal}
        />
      ) : (
        <div className="journalStats">
          <section>
            <h4>Показатели</h4>
            <div className="journalStatGrid">
              <div><span>Avg R</span><b>{nullable(analytics.averageR, "R")}</b></div>
              <div><span>Комиссии</span><b>{formatNumber(analytics.totalFees)}</b></div>
              <div><span>Лучшая</span><b className="pos">{nullable(analytics.bestTrade)}</b></div>
              <div><span>Худшая</span><b className="neg">{nullable(analytics.worstTrade)}</b></div>
              <div><span>LONG PnL</span><b className={signClass(analytics.longPnl)}>{signed(analytics.longPnl)}</b><i>{analytics.longCount} шт.</i></div>
              <div><span>SHORT PnL</span><b className={signClass(analytics.shortPnl)}>{signed(analytics.shortPnl)}</b><i>{analytics.shortCount} шт.</i></div>
              <div><span>Прибыльных / убыточных</span><b>{analytics.winningTrades} / {analytics.losingTrades}</b></div>
              <div><span>Открыто / заявок</span><b>{analytics.openTrades} / {analytics.pendingTrades}</b></div>
            </div>
          </section>

          <section>
            <h4>Как закрывались</h4>
            <div className="journalStatGrid">
              <div><span>Take profit</span><b>{analytics.tpCount}</b></div>
              <div><span>Stop loss</span><b>{analytics.slCount}</b></div>
              <div><span>Вручную</span><b>{analytics.manualCount}</b></div>
              <div><span>По времени</span><b>{analytics.timeoutCount}</b></div>
            </div>
          </section>

          <section>
            <h4>По таймфреймам</h4>
            <BucketList buckets={byTimeframe} signed={signed} signClass={signClass} />
          </section>

          <section>
            <h4>По инструментам</h4>
            <BucketList buckets={bySymbol} signed={signed} signClass={signClass} />
          </section>

          <section>
            <h4>По тегам</h4>
            <BucketList buckets={byTag} signed={signed} signClass={signClass} />
          </section>
        </div>
      )}
      </>
    </Drawer>
  );
}

function BucketList({
  buckets,
  signed,
  signClass,
}: {
  buckets: Bucket[];
  signed: (value: number) => string;
  signClass: (value: number) => string;
}) {
  if (!buckets.length) return <div className="journalEmpty">Нет закрытых сделок в этом разрезе.</div>;
  const peak = Math.max(...buckets.map((bucket) => Math.abs(bucket.pnl)), 1);
  return (
    <div className="journalBuckets">
      {buckets.map((bucket) => (
        <div key={bucket.key} className="journalBucket">
          <span className="journalBucketLabel">{bucket.label}</span>
          <span className="journalBucketBar">
            <i
              className={signClass(bucket.pnl)}
              style={{ width: `${(Math.abs(bucket.pnl) / peak) * 100}%` }}
            />
          </span>
          <span className="journalBucketMeta">{bucket.trades} шт. · {((bucket.wins / bucket.trades) * 100).toFixed(0)}%</span>
          <b className={`num ${signClass(bucket.pnl)}`}>{signed(bucket.pnl)}</b>
        </div>
      ))}
    </div>
  );
}
