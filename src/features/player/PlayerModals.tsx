import dayjs from "dayjs";
import { Button, DatePicker, InputNumber, Modal, Popconfirm, Space, Switch, Table, Tag } from "antd";
import type { TableProps } from "antd";
import { Trash2 } from "lucide-react";
import type { AccountSettings, Candle, SimulationSettings, Trade } from "../../types";
import { formatDateTime, formatNumber } from "../../shared/lib/market";

interface PlayerModalsProps {
  settingsOpen: boolean;
  datePickerOpen: boolean;
  journalOpen: boolean;
  settings: SimulationSettings;
  account: AccountSettings;
  candles: Candle[];
  replayDateRange?: { from: number; to: number };
  trades: Trade[];
  onSettingsClose: () => void;
  onSettingsReset: () => void;
  onSettingChange: (
    key: Exclude<keyof SimulationSettings, "showClosedTradeOverlays">,
    value: number | null,
  ) => void;
  onInitialBalanceChange: (value: number | null) => void;
  onClosedTradeOverlaysChange: (checked: boolean) => void;
  onDatePickerClose: () => void;
  onReplayTimeSelect: (time: number) => void;
  onJournalClose: () => void;
  onCancelOrder: (id: string) => void;
  onCloseTrade: (trade: Trade) => void;
  onDeleteTrade: (id: string) => void;
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
  onSettingsClose,
  onSettingsReset,
  onSettingChange,
  onInitialBalanceChange,
  onClosedTradeOverlaysChange,
  onDatePickerClose,
  onReplayTimeSelect,
  onJournalClose,
  onCancelOrder,
  onCloseTrade,
  onDeleteTrade,
}: PlayerModalsProps) {
  const columns: TableProps<Trade>["columns"] = [
    { title: "Вход", dataIndex: "entryTime", render: formatDateTime },
    {
      title: "Side",
      dataIndex: "side",
      render: (side: Trade["side"]) => (
        <Tag color={side === "LONG" ? "green" : "red"}>{side}</Tag>
      ),
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
        <Space size={6}>
          {(trade.status === "OPEN" || trade.status === "PENDING") && (
            <Button
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
            <Button danger size="small" icon={<Trash2 size={14} />}>
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
              addonAfter={account.quoteAsset}
              onChange={onInitialBalanceChange}
            />
            <small>Start deposit for balance, equity and growth</small>
          </label>
          <label><span>Maker fee</span><InputNumber value={settings.makerFeePct} min={0} precision={4} step={0.001} addonAfter="%" onChange={(value) => onSettingChange("makerFeePct", value)} /><small>Limit-вход и Take Profit</small></label>
          <label><span>Taker fee</span><InputNumber value={settings.takerFeePct} min={0} precision={4} step={0.001} addonAfter="%" onChange={(value) => onSettingChange("takerFeePct", value)} /><small>Market, Stop Loss и ручное закрытие</small></label>
          <label><span>Market slippage</span><InputNumber value={settings.slippagePct} min={0} precision={4} step={0.001} addonAfter="%" onChange={(value) => onSettingChange("slippagePct", value)} /><small>Вход и ручное закрытие по рынку</small></label>
          <label><span>Stop slippage</span><InputNumber value={settings.stopSlippagePct} min={0} precision={4} step={0.001} addonAfter="%" onChange={(value) => onSettingChange("stopSlippagePct", value)} /><small>Ухудшение цены исполнения Stop Loss</small></label>
          <label className="settingsToggle"><span>Разметка закрытых сделок</span><Switch checked={settings.showClosedTradeOverlays} onChange={onClosedTradeOverlaysChange} /><small>Зоны TP/SL и линия фактического выхода на графике</small></label>
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
            onReplayTimeSelect(value.startOf("day").unix());
            onDatePickerClose();
          }}
        />
      </Modal>

      <Modal
        title="Журнал сделок"
        width={900}
        open={journalOpen}
        footer={<Button onClick={onJournalClose}>Закрыть</Button>}
        onCancel={onJournalClose}
      >
        <Table<Trade>
          rowKey="id"
          dataSource={trades}
          columns={columns}
          pagination={false}
        />
      </Modal>
    </>
  );
}
