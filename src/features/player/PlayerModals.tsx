import dayjs from 'dayjs';
import { Button, DatePicker, InputNumber, Modal, Select, Switch } from 'antd';
import type { AccountSettings, AmbiguousExitPolicy, Candle, HeaderStatsVariant, SimulationSettings } from '../../types';
import { zonedDateBarStart, zonedDateParts } from '../../shared/lib/chartTimezones';

function unixToPickerDate(unixSeconds: number, timeZone: string) {
  const parts = zonedDateParts(timeZone, unixSeconds);
  return dayjs(new Date(parts.year, parts.month - 1, parts.day));
}

const HEADER_STATS_VARIANTS: Array<{ value: HeaderStatsVariant; label: string }> = [
  { value: "ticker", label: "Тикер" },
  { value: "rail", label: "Рейл" },
  { value: "chips", label: "Чипы" },
  { value: "minimal", label: "Минимал" },
  { value: "compact", label: "Компакт" },
  { value: "accent", label: "Акцент" },
  { value: "stack", label: "Стек" },
];

interface PlayerModalsProps {
  settingsOpen: boolean;
  datePickerOpen: boolean;
  settings: SimulationSettings;
  chartTimeZone?: string;
  timeframeMinutes: number;
  account: AccountSettings;
  candles: Candle[];
  replayDateRange?: { from: number; to: number };
  onSettingsClose: () => void;
  onSettingsReset: () => void;
  onSettingChange: (
    key: Exclude<keyof SimulationSettings, 'showClosedTradeOverlays' | 'followCandle' | 'tradePanelTabPinned' | 'headerStatsVariant' | 'tradingSessionsVariant' | 'showFairValueGaps' | 'ambiguousExitPolicy' | 'chartTimeZone'>,
    value: number | null,
  ) => void;
  onInitialBalanceChange: (value: number | null) => void;
  onAmbiguousExitPolicyChange: (value: AmbiguousExitPolicy) => void;
  onClosedTradeOverlaysChange: (checked: boolean) => void;
  onFollowCandleChange: (checked: boolean) => void;
  onTradePanelTabPinnedChange: (checked: boolean) => void;
  onHeaderStatsVariantChange: (value: HeaderStatsVariant) => void;
  onDatePickerClose: () => void;
  onReplayTimeSelect: (time: number) => void;
}

export function PlayerModals({
  settingsOpen,
  datePickerOpen,
  settings,
  chartTimeZone = "UTC",
  timeframeMinutes,
  account,
  candles,
  replayDateRange,
  onSettingsClose,
  onSettingsReset,
  onSettingChange,
  onInitialBalanceChange,
  onAmbiguousExitPolicyChange,
  onClosedTradeOverlaysChange,
  onFollowCandleChange,
  onTradePanelTabPinnedChange,
  onHeaderStatsVariantChange,
  onDatePickerClose,
  onReplayTimeSelect,
}: PlayerModalsProps) {
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
          <label className="settingsToggle">
            <span>Кнопка Trade всегда видна</span>
            <Switch checked={settings.tradePanelTabPinned} onChange={onTradePanelTabPinnedChange} />
            <small>
              Вкл — вкладка Trade всегда справа при свёрнутой панели. Выкл — не перекрывает цены и выезжает на секунду у правого края экрана
            </small>
          </label>
          <label className="settingsToggle">
            <span>Дизайн статистики в шапке</span>
            <Button
              className="settingsCycleBtn"
              onClick={() => {
                const index = HEADER_STATS_VARIANTS.findIndex((item) => item.value === settings.headerStatsVariant);
                const next = HEADER_STATS_VARIANTS[(index + 1 + HEADER_STATS_VARIANTS.length) % HEADER_STATS_VARIANTS.length];
                onHeaderStatsVariantChange(next.value);
              }}
            >
              {HEADER_STATS_VARIANTS.find((item) => item.value === settings.headerStatsVariant)?.label
                ?? HEADER_STATS_VARIANTS[0].label}
            </Button>
            <small>Клик переключает все варианты дизайна по кругу</small>
          </label>
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
          minDate={replayDateRange ? unixToPickerDate(replayDateRange.from / 1_000, chartTimeZone) : candles[0] ? unixToPickerDate(candles[0].time, chartTimeZone) : undefined}
          maxDate={replayDateRange ? unixToPickerDate((replayDateRange.to - 1) / 1_000, chartTimeZone) : candles.at(-1) ? unixToPickerDate(candles.at(-1)!.time, chartTimeZone) : undefined}
          onChange={(value) => {
            if (!value) return;
            // Гражданская дата в поясе графика, не полночь браузера.
            const target = zonedDateBarStart(
              chartTimeZone,
              value.year(),
              value.month() + 1,
              value.date(),
              timeframeMinutes * 60,
            );
            // Округление вверх на последней доступной дате может уйти за конец
            // набора — тогда голова так и осталась бы в ожидании данных.
            const lastTime = replayDateRange
              ? Math.floor((replayDateRange.to - 1) / 1_000)
              : candles.at(-1)?.time;
            onReplayTimeSelect(lastTime != null ? Math.min(target, lastTime) : target);
            onDatePickerClose();
          }}
        />
      </Modal>
    </>
  );
}
