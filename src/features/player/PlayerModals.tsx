import dayjs from 'dayjs';
import { Button, DatePicker, InputNumber, Modal, Select, Switch } from 'antd';
import type { AccountSettings, AmbiguousExitPolicy, Candle, SimulationSettings } from '../../types';

interface PlayerModalsProps {
  settingsOpen: boolean;
  datePickerOpen: boolean;
  settings: SimulationSettings;
  account: AccountSettings;
  candles: Candle[];
  replayDateRange?: { from: number; to: number };
  onSettingsClose: () => void;
  onSettingsReset: () => void;
  onSettingChange: (
    key: Exclude<keyof SimulationSettings, 'showClosedTradeOverlays' | 'followCandle' | 'tradePanelTabPinned' | 'showTradingSessions' | 'showFairValueGaps' | 'ambiguousExitPolicy'>,
    value: number | null,
  ) => void;
  onInitialBalanceChange: (value: number | null) => void;
  onAmbiguousExitPolicyChange: (value: AmbiguousExitPolicy) => void;
  onClosedTradeOverlaysChange: (checked: boolean) => void;
  onFollowCandleChange: (checked: boolean) => void;
  onTradePanelTabPinnedChange: (checked: boolean) => void;
  onDatePickerClose: () => void;
  onReplayTimeSelect: (time: number) => void;
}

export function PlayerModals({
  settingsOpen,
  datePickerOpen,
  settings,
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
    </>
  );
}
