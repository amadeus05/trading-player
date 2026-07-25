import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { Button, DatePicker, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from "antd";
import type { TableProps } from "antd";
import type { Dayjs } from "dayjs";
import { Trash2 } from "lucide-react";
import type { AccountSettings, AmbiguousExitPolicy, Candle, SimulationSettings, Trade } from "../../types";
import { formatDateTime, formatNumber, formatTimeframe } from "../../shared/lib/market";
import {
  calculateTradeAnalytics,
  filterTradesForAnalytics,
  type AnalyticsFilters,
} from "../trading/lib/calculateTradeAnalytics";

type JournalPeriod = "all" | "today" | "week" | "month" | "custom";

const EQUITY_CHART_WIDTH = 360;
const EQUITY_CHART_HEIGHT = 116;

function buildEquityPath(curve: Array<{ equity: number }>): string {
  if (curve.length === 0) return "";
  const values = curve.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const lastIndex = Math.max(1, curve.length - 1);
  return curve.map((point, index) => {
    const x = index / lastIndex * EQUITY_CHART_WIDTH;
    const y = EQUITY_CHART_HEIGHT - ((point.equity - min) / range * EQUITY_CHART_HEIGHT);
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

interface PlayerModalsProps {
  settingsOpen: boolean;
  datePickerOpen: boolean;
  journalOpen: boolean;
  settings: SimulationSettings;
  account: AccountSettings;
  candles: Candle[];
  replayDateRange?: { from: number; to: number };
  trades: Trade[];
  datasetOptions: Array<{ id: string; name: string }>;
  onSettingsClose: () => void;
  onSettingsReset: () => void;
  onSettingChange: (
    key: Exclude<keyof SimulationSettings, "showClosedTradeOverlays" | "ambiguousExitPolicy">,
    value: number | null,
  ) => void;
  onInitialBalanceChange: (value: number | null) => void;
  onAmbiguousExitPolicyChange: (value: AmbiguousExitPolicy) => void;
  onClosedTradeOverlaysChange: (checked: boolean) => void;
  onFollowCandleChange: (checked: boolean) => void;
  onDatePickerClose: () => void;
  onReplayTimeSelect: (time: number) => void;
  onJournalClose: () => void;
  onCancelOrder: (id: string) => void;
  onCloseTrade: (trade: Trade) => void;
  onDeleteTrade: (id: string) => void;
  onDeleteAllTrades: () => void;
}

export function PlayerModals({
  settingsOpen,
  datePickerOpen,
  journalOpen,
  settings,
  account,
  candles,
  replayDateRange,
  trades,
  datasetOptions,
  onSettingsClose,
  onSettingsReset,
  onSettingChange,
  onInitialBalanceChange,
  onAmbiguousExitPolicyChange,
  onClosedTradeOverlaysChange,
  onFollowCandleChange,
  onDatePickerClose,
  onReplayTimeSelect,
  onJournalClose,
  onCancelOrder,
  onCloseTrade,
  onDeleteTrade,
  onDeleteAllTrades,
}: PlayerModalsProps) {
  const [journalPeriod, setJournalPeriod] = useState<JournalPeriod>("all");
  const [journalDateRange, setJournalDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [journalDatasetId, setJournalDatasetId] = useState<string>("all");
  const [journalTimeframe, setJournalTimeframe] = useState<number | "all">("all");
  const [journalSide, setJournalSide] = useState<Trade["side"] | "all">("all");
  const [journalOutcome, setJournalOutcome] = useState<NonNullable<Trade["outcome"]> | "all">("all");
  const datasetNameById = useMemo(
    () => new Map(datasetOptions.map((option) => [option.id, option.name])),
    [datasetOptions],
  );
  const datasetFilterOptions = useMemo(() => {
    const ids = new Set(trades.flatMap((trade) => trade.datasetId ? [trade.datasetId] : []));
    return [...ids].map((id) => ({
      value: id,
      label: datasetNameById.get(id) ?? id,
    }));
  }, [datasetNameById, trades]);
  const journalFilters = useMemo<AnalyticsFilters>(() => {
    const now = dayjs();
    const periodRange = (() => {
      if (journalPeriod === "today") return { fromTime: now.startOf("day").unix() };
      if (journalPeriod === "week") return { fromTime: now.subtract(7, "day").startOf("day").unix() };
      if (journalPeriod === "month") return { fromTime: now.subtract(1, "month").startOf("day").unix() };
      if (journalPeriod === "custom" && journalDateRange) {
        return {
          fromTime: journalDateRange[0].startOf("day").unix(),
          toTime: journalDateRange[1].endOf("day").unix(),
        };
      }
      return {};
    })();
    return {
      ...periodRange,
      datasetId: journalDatasetId === "all" ? undefined : journalDatasetId,
      timeframeMinutes: journalTimeframe === "all" ? undefined : journalTimeframe,
      side: journalSide === "all" ? undefined : journalSide,
      outcome: journalOutcome === "all" ? undefined : journalOutcome,
    };
  }, [journalDatasetId, journalDateRange, journalOutcome, journalPeriod, journalSide, journalTimeframe]);
  const timeframeFilterOptions = useMemo(() => {
    const timeframes = [...new Set(trades.flatMap((trade) => trade.timeframeMinutes ? [trade.timeframeMinutes] : []))]
      .sort((left, right) => left - right);
    return timeframes.map((timeframe) => ({
      value: timeframe,
      label: formatTimeframe(timeframe),
    }));
  }, [trades]);
  const filteredTrades = useMemo(
    () => filterTradesForAnalytics(trades, journalFilters),
    [journalFilters, trades],
  );
  const analytics = useMemo(
    () => calculateTradeAnalytics(account, trades, journalFilters),
    [account, journalFilters, trades],
  );
  const equityPath = useMemo(
    () => buildEquityPath(analytics.equityCurve),
    [analytics.equityCurve],
  );
  const formatSigned = (value: number) => `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
  const formatNullable = (value: number | null, suffix = "") => value == null ? "—" : `${formatNumber(value)}${suffix}`;
  const columns: TableProps<Trade>["columns"] = [
    { title: "Вход", dataIndex: "entryTime", render: formatDateTime },
    {
      title: "Side",
      dataIndex: "side",
      render: (side: Trade["side"]) => (
        <Tag color={side === "LONG" ? "green" : "red"}>{side}</Tag>
      ),
    },
    {
      title: "Dataset",
      dataIndex: "datasetId",
      render: (value?: string) => value ? datasetNameById.get(value) ?? value : "Unknown",
    },
    {
      title: "TF",
      dataIndex: "timeframeMinutes",
      render: (value?: number) => value ? formatTimeframe(value) : "Unknown",
    },
    { title: "Цена", dataIndex: "entry", render: formatNumber },
    { title: "Статус", dataIndex: "status" },
    {
      title: "P&L",
      dataIndex: "result",
      render: (value?: number) => (
        <span className={(value ?? 0) >= 0 ? "pos" : "neg"}>
          {value == null ? "—" : formatNumber(value)}
        </span>
      ),
    },
    {
      title: "Комиссии",
      dataIndex: "fees",
      render: (value?: number) => value == null ? "—" : formatNumber(value),
    },
    {
      title: "Действия",
      render: (_value: unknown, trade: Trade) => (
        <Space size={6} align="center" className="journalActions">
          {(trade.status === "OPEN" || trade.status === "PENDING") && (
            <Button
              className="journalActionBtn"
              size="small"
              onClick={() => trade.status === "PENDING"
                ? onCancelOrder(trade.id)
                : onCloseTrade(trade)}
            >
              {trade.status === "PENDING" ? "Отменить" : "Закрыть"}
            </Button>
          )}
          <Popconfirm
            title="Удалить сделку?"
            description="Сделка и её разметка будут удалены."
            okText="Удалить"
            cancelText="Отмена"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDeleteTrade(trade.id)}
          >
            <Button className="journalActionBtn" danger size="small" icon={<Trash2 size={14} />}>
              Удалить
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Modal
        title="Настройки симуляции"
        open={settingsOpen}
        onCancel={onSettingsClose}
        footer={(
          <>
            <Button onClick={onSettingsReset}>По умолчанию</Button>
            <Button type="primary" onClick={onSettingsClose}>Готово</Button>
          </>
        )}
      >
        <div className="settingsGrid">
          <label>
            <span>Initial balance</span>
            <InputNumber
              value={account.initialBalance}
              min={0}
              precision={2}
              step={100}
              suffix={account.quoteAsset}
              onChange={onInitialBalanceChange}
            />
            <small>Start deposit for balance, equity and growth</small>
          </label>
          <label><span>Maker fee</span><InputNumber value={settings.makerFeePct} min={0} precision={4} step={0.001} suffix="%" onChange={(value) => onSettingChange("makerFeePct", value)} /><small>Limit-вход и Take Profit</small></label>
          <label><span>Taker fee</span><InputNumber value={settings.takerFeePct} min={0} precision={4} step={0.001} suffix="%" onChange={(value) => onSettingChange("takerFeePct", value)} /><small>Market, Stop Loss и ручное закрытие</small></label>
          <label><span>Market slippage</span><InputNumber value={settings.slippagePct} min={0} precision={4} step={0.001} suffix="%" onChange={(value) => onSettingChange("slippagePct", value)} /><small>Вход и ручное закрытие по рынку</small></label>
          <label><span>Stop slippage</span><InputNumber value={settings.stopSlippagePct} min={0} precision={4} step={0.001} suffix="%" onChange={(value) => onSettingChange("stopSlippagePct", value)} /><small>Ухудшение цены исполнения Stop Loss</small></label>
          <label>
            <span>Ambiguous TP/SL</span>
            <Select<AmbiguousExitPolicy>
              value={settings.ambiguousExitPolicy}
              onChange={onAmbiguousExitPolicyChange}
              options={[
                { value: "conservative", label: "Conservative: SL first" },
                { value: "optimistic", label: "Optimistic: TP first" },
                { value: "ignore", label: "Ignore until next candle" },
              ]}
            />
            <small>Used only when TP and SL order cannot be resolved from lower candles</small>
          </label>
          <label className="settingsToggle"><span>Разметка закрытых сделок</span><Switch checked={settings.showClosedTradeOverlays} onChange={onClosedTradeOverlaysChange} /><small>Зоны TP/SL и линия фактического выхода на графике</small></label>
          <label className="settingsToggle"><span>Следовать за свечой</span><Switch checked={settings.followCandle} onChange={onFollowCandleChange} /><small>График центрируется и автоматически прокручивается за текущей свечой во время replay</small></label>
        </div>
      </Modal>

      <Modal
        title="Выберите дату начала replay"
        open={datePickerOpen}
        footer={null}
        onCancel={onDatePickerClose}
        width={360}
      >
        <DatePicker
          style={{ width: "100%" }}
          minDate={replayDateRange ? dayjs(replayDateRange.from) : candles[0] ? dayjs(candles[0].time * 1_000) : undefined}
          maxDate={replayDateRange ? dayjs(replayDateRange.to - 1) : candles.at(-1) ? dayjs(candles.at(-1)!.time * 1_000) : undefined}
          onChange={(value) => {
            if (!value) return;
            // Полночь именно по UTC: startOf("day") даёт местную, и прыжок
            // попадал в предыдущие сутки рынка — на дневке это целая свеча мимо.
            onReplayTimeSelect(Date.UTC(value.year(), value.month(), value.date()) / 1_000);
            onDatePickerClose();
          }}
        />
      </Modal>

      <Modal
        title="Журнал сделок"
        width={1180}
        open={journalOpen}
        footer={<Button onClick={onJournalClose}>Закрыть</Button>}
        onCancel={onJournalClose}
      >
        <div className="journalAnalytics">
          <div className="journalTopBar">
            <div>
              <b>Аналитика сделок</b>
              <span>{filteredTrades.length} сделок в текущем фильтре</span>
            </div>
            <Popconfirm
              title="Удалить все сделки?"
              description={`Будут удалены все ${trades.length} сделок и их разметка на графике, включая скрытые фильтром. Отменить нельзя.`}
              okText="Удалить всё"
              cancelText="Отмена"
              okButtonProps={{ danger: true }}
              onConfirm={onDeleteAllTrades}
            >
              <Button danger disabled={!trades.length} icon={<Trash2 size={14} />}>
                Удалить все сделки{trades.length ? ` (${trades.length})` : ""}
              </Button>
            </Popconfirm>
          </div>
          <div className="journalFilters">
            <Select<JournalPeriod>
              value={journalPeriod}
              onChange={setJournalPeriod}
              options={[
                { value: "all", label: "Весь период" },
                { value: "today", label: "Сегодня" },
                { value: "week", label: "Последняя неделя" },
                { value: "month", label: "Последний месяц" },
                { value: "custom", label: "Даты" },
              ]}
            />
            {journalPeriod === "custom" && (
              <DatePicker.RangePicker
                value={journalDateRange}
                onChange={(value) => {
                  const [from, to] = value ?? [];
                  setJournalDateRange(from && to ? [from, to] : null);
                }}
              />
            )}
            <Select
              value={journalDatasetId}
              onChange={setJournalDatasetId}
              options={[
                { value: "all", label: "Все монеты" },
                ...datasetFilterOptions,
              ]}
            />
            <Select
              value={journalTimeframe}
              onChange={setJournalTimeframe}
              options={[
                { value: "all", label: "Все TF" },
                ...timeframeFilterOptions,
              ]}
            />
            <Select
              value={journalSide}
              onChange={setJournalSide}
              options={[
                { value: "all", label: "LONG + SHORT" },
                { value: "LONG", label: "LONG" },
                { value: "SHORT", label: "SHORT" },
              ]}
            />
            <Select
              value={journalOutcome}
              onChange={setJournalOutcome}
              options={[
                { value: "all", label: "Все выходы" },
                { value: "TP", label: "TP" },
                { value: "SL", label: "SL" },
                { value: "MANUAL", label: "Manual" },
                { value: "TIMEOUT", label: "Timeout" },
              ]}
            />
          </div>
          <div className="journalMetrics">
            <div><span>Net PnL</span><b className={analytics.totalPnl >= 0 ? "pos" : "neg"}>{formatSigned(analytics.totalPnl)}</b></div>
            <div><span>Winrate</span><b>{analytics.winRatePct.toFixed(1)}%</b></div>
            <div><span>Profit factor</span><b>{analytics.profitFactor == null ? "∞" : analytics.profitFactor.toFixed(2)}</b></div>
            <div><span>Expectancy</span><b className={analytics.expectancy >= 0 ? "pos" : "neg"}>{formatSigned(analytics.expectancy)}</b></div>
            <div><span>Avg R</span><b>{formatNullable(analytics.averageR, "R")}</b></div>
            <div><span>Max DD</span><b className="neg">{formatNumber(analytics.maxDrawdown)} ({analytics.maxDrawdownPct.toFixed(1)}%)</b></div>
            <div><span>Fees</span><b>{formatNumber(analytics.totalFees)}</b></div>
            <div><span>Trades</span><b>{analytics.closedTrades} / {analytics.totalTrades}</b></div>
            <div><span>LONG PnL</span><b className={analytics.longPnl >= 0 ? "pos" : "neg"}>{formatSigned(analytics.longPnl)}</b></div>
            <div><span>SHORT PnL</span><b className={analytics.shortPnl >= 0 ? "pos" : "neg"}>{formatSigned(analytics.shortPnl)}</b></div>
            <div><span>Exits</span><b>TP {analytics.tpCount} · SL {analytics.slCount} · M {analytics.manualCount}</b></div>
            <div><span>Best / Worst</span><b>{formatNullable(analytics.bestTrade)} / {formatNullable(analytics.worstTrade)}</b></div>
          </div>
          <div className="journalChart">
            <div className="journalChartHeader">
              <span>Equity curve</span>
              <b className={analytics.totalPnl >= 0 ? "pos" : "neg"}>
                {formatSigned(analytics.totalPnl)} {account.quoteAsset}
              </b>
            </div>
            <svg viewBox={`0 0 ${EQUITY_CHART_WIDTH} ${EQUITY_CHART_HEIGHT}`} role="img" aria-label="Equity curve">
              <line x1="0" y1={EQUITY_CHART_HEIGHT - 1} x2={EQUITY_CHART_WIDTH} y2={EQUITY_CHART_HEIGHT - 1} />
              {equityPath && <path d={equityPath} />}
            </svg>
          </div>
        </div>
        <div className="journalTable">
          <Table<Trade>
            rowKey="id"
            dataSource={filteredTrades}
            columns={columns}
            pagination={{ pageSize: 12, showSizeChanger: false }}
            size="small"
          />
        </div>
      </Modal>
    </>
  );
}
