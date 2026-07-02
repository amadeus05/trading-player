import { Button, InputNumber, Select, Slider, Tooltip } from "antd";
import { Check, CircleHelp, Pencil, X } from "lucide-react";
import type { Candle, Trade } from "../../types";
import { formatNumber, formatPrice } from "../../shared/lib/market";
import type { AccountStats } from "./lib/calculateAccountStats";
import type { OrderFormController } from "./useOrderForm";

interface TradingSidebarProps {
  currentCandle?: Candle;
  pricePrecision: number;
  baseAsset: string;
  quoteAsset: string;
  accountStats: AccountStats;
  orderForm: OrderFormController;
  workingTrades: Trade[];
  focusedTradeId: string | null;
  editingTradeId: string | null;
  onBeginOrderDraft: (side: Trade["side"]) => void;
  onCancelOrderDraft: () => void;
  onPlaceOrder: (side: Trade["side"]) => void;
  onTradeFocus: (id: string | null) => void;
  onTradeEditStart: (trade: Trade) => void;
  onTradeEditCancel: () => void;
  onTradeEditSave: () => void;
  onCancelOrder: (id: string) => void;
  onCloseTrade: (trade: Trade) => void;
}

function OrderSideButton({
  side,
  className,
  label,
  orderDraftSide,
  disabled,
  takeProfit,
  stopLoss,
  onBeginOrderDraft,
  onCancelOrderDraft,
  onPlaceOrder,
}: {
  side: Trade["side"];
  className: string;
  label: string;
  orderDraftSide: Trade["side"] | null;
  disabled: boolean;
  takeProfit: number;
  stopLoss: number;
  onBeginOrderDraft: (side: Trade["side"]) => void;
  onCancelOrderDraft: () => void;
  onPlaceOrder: (side: Trade["side"]) => void;
}) {
  if (orderDraftSide === side) {
    return (
      <div className={`tradeBtnSplit ${className}`}>
        <button
          type="button"
          className="tradeBtnSplitPart confirm"
          aria-label={`Подтвердить ${label}`}
          disabled={disabled || takeProfit <= 0 || stopLoss <= 0}
          onClick={() => onPlaceOrder(side)}
        >
          <Check size={20} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          className="tradeBtnSplitPart cancel"
          aria-label="Отменить создание сделки"
          onClick={onCancelOrderDraft}
        >
          <X size={20} strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  return (
    <Button
      className={className}
      disabled={disabled || (orderDraftSide != null && orderDraftSide !== side)}
      onClick={() => onBeginOrderDraft(side)}
    >
      {label}
    </Button>
  );
}

export function TradingSidebar({
  currentCandle,
  pricePrecision,
  baseAsset,
  quoteAsset,
  accountStats,
  orderForm,
  workingTrades,
  focusedTradeId,
  editingTradeId,
  onBeginOrderDraft,
  onCancelOrderDraft,
  onPlaceOrder,
  onTradeFocus,
  onTradeEditStart,
  onTradeEditCancel,
  onTradeEditSave,
  onCancelOrder,
  onCloseTrade,
}: TradingSidebarProps) {
  const {
    orderType,
    leverage,
    amountUnit,
    orderValue,
    allocationPercent,
    limitPrice,
    orderDraftSide,
    takeProfit,
    stopLoss,
    ticketQuantity,
    ticketNotional,
    ticketMargin,
    riskStats,
    liquidationStats,
    selectedRiskPct,
    riskSizingCapped,
    longLiquidation,
    shortLiquidation,
    changeAllocation: onAllocationChange,
    changeAmountUnit: onAmountUnitChange,
    changeOrderType: onOrderTypeChange,
    changeOrderValue: onOrderValueChange,
    changeRiskPercent: onRiskPercentChange,
    setLeverage: onLeverageChange,
    setLimitPrice: onLimitPriceChange,
    setTakeProfit: onTakeProfitChange,
    setStopLoss: onStopLossChange,
  } = orderForm;
  const orderActionsDisabled = !currentCandle || editingTradeId != null;
  const riskText = riskStats
    ? `${formatNumber(riskStats.riskAmount)} ${quoteAsset} (${riskStats.riskPct.toFixed(2)}%)`
    : "—";
  const rewardText = riskStats
    ? `${formatNumber(riskStats.rewardAmount)} ${quoteAsset} (${riskStats.rewardPct.toFixed(2)}%)`
    : "—";
  const insufficientMargin = ticketMargin > accountStats.availableBalance + 0.000001;
  const riskAboveLimit = riskStats != null && riskStats.riskPct > 2;
  const limitStatus = insufficientMargin ? "No margin" : riskSizingCapped ? "Capped" : riskAboveLimit ? "Above 2%" : "OK";
  const limitStatusClass = insufficientMargin || riskSizingCapped || riskAboveLimit ? "warn" : "ok";
  const liquidationText = liquidationStats
    ? `${formatPrice(liquidationStats.liquidationPrice, pricePrecision)} (${liquidationStats.entryDistancePct.toFixed(2)}% from entry)`
    : "—";
  const liquidationBufferText = liquidationStats?.stopLossBufferPct != null
    ? `${liquidationStats.stopLossBufferPct.toFixed(2)}%`
    : "—";
  const liquidationStatus = liquidationStats?.warning === "after"
    ? "SL after liq"
    : liquidationStats?.warning === "near"
      ? "SL near liq"
      : "OK";

  return (
    <aside>
      <div className="orderHeader"><b>Trade</b></div>
      <div className="ticketTopRow">
        <Select value="isolated" options={[{ value: "isolated", label: "Isolated" }]} />
        <Select
          className="leverageSelect"
          value={leverage}
          onChange={onLeverageChange}
          options={[1, 2, 3, 5, 10, 20, 50, 100].map((value) => ({
            value,
            label: `${value.toFixed(2)}x`,
          }))}
        />
      </div>
      <div className="orderTabs">
        <button className={orderType === "LIMIT" ? "active" : ""} onClick={() => onOrderTypeChange("LIMIT")}>Limit</button>
        <button className={orderType === "MARKET" ? "active" : ""} onClick={() => onOrderTypeChange("MARKET")}>Market</button>
        <CircleHelp size={16} />
      </div>
      {orderType === "LIMIT" && (
        <div className="ticketField">
          <span>Цена</span>
          <div className="priceInput">
            <InputNumber controls={false} value={limitPrice || currentCandle?.close} precision={pricePrecision} step={10 ** -pricePrecision} onChange={(value) => onLimitPriceChange(value ?? 0)} />
            <button onClick={() => currentCandle && onLimitPriceChange(currentCandle.close)}>Last</button>
          </div>
        </div>
      )}
      {orderDraftSide && (
        <div className="limitProtection">
          <div className="ticketField"><span>Take Profit</span><InputNumber controls={false} placeholder="Не задан" value={takeProfit || undefined} precision={pricePrecision} step={10 ** -pricePrecision} onChange={(value) => onTakeProfitChange(value ?? 0)} /></div>
          <div className="ticketField"><span>Stop Loss</span><InputNumber controls={false} placeholder="Не задан" value={stopLoss || undefined} precision={pricePrecision} step={10 ** -pricePrecision} onChange={(value) => onStopLossChange(value ?? 0)} /></div>
        </div>
      )}
      <div className="ticketField">
        <span>{amountUnit === "USDT" ? "Margin" : "Quantity"}</span>
        <div className="amountInput">
          <InputNumber controls={false} min={0} value={orderValue} onChange={(value) => onOrderValueChange(value ?? 0)} />
          <Select
            variant="borderless"
            value={amountUnit}
            onChange={onAmountUnitChange}
            options={[{ value: "USDT", label: "USDT" }, { value: "COIN", label: baseAsset }]}
          />
        </div>
      </div>
      <div className="allocationSlider">
        <Slider min={0} max={100} step={1} value={allocationPercent} onChange={onAllocationChange} tooltip={{ formatter: (value) => `${value}%` }} />
        <div><span>0</span><span>100%</span></div>
      </div>
      <div className="orderSummary">
        <div><span>Quantity</span><b>{ticketQuantity ? formatPrice(ticketQuantity, Math.min(8, pricePrecision + 2)) : "—"} {baseAsset}</b></div>
        <div><span>Margin</span><b>{ticketMargin ? `${formatNumber(ticketMargin)} ${quoteAsset}` : "—"}</b></div>
        <div><span>Notional</span><b>{ticketNotional ? `${formatNumber(ticketNotional)} ${quoteAsset}` : "—"}</b></div>
        <div><span>Liq. Price</span><b><em>{longLiquidation != null ? formatPrice(longLiquidation, pricePrecision) : "—"}</em> / <strong>{shortLiquidation != null ? formatPrice(shortLiquidation, pricePrecision) : "—"}</strong></b></div>
      </div>
      {orderDraftSide && (
        <div className="riskPanel">
          <div className="riskPresets">
            <span>Risk size</span>
            <div>
              {[0.5, 1, 2].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={selectedRiskPct === value ? "active" : ""}
                  onClick={() => onRiskPercentChange(value)}
                >
                  {value}%
                </button>
              ))}
            </div>
          </div>
          <div className="riskGrid">
            <div>
              <span>Risk</span>
              <Tooltip title={riskText}>
                <b className={riskStats && riskStats.riskPct > 2 ? "warn" : ""}>{riskText}</b>
              </Tooltip>
            </div>
            <div>
              <span>Reward</span>
              <Tooltip title={rewardText}>
                <b>{rewardText}</b>
              </Tooltip>
            </div>
            <div>
              <span>R/R</span>
              <b>{riskStats?.riskReward != null ? `1:${riskStats.riskReward.toFixed(2)}` : "—"}</b>
            </div>
            <div>
              <span>Limit</span>
              <Tooltip title={
                insufficientMargin
                  ? `Need ${formatNumber(ticketMargin)} ${quoteAsset}, available ${formatNumber(accountStats.availableBalance)} ${quoteAsset}`
                  : riskSizingCapped && selectedRiskPct != null
                    ? `Target ${selectedRiskPct}% needs more margin. Using max available size.`
                    : limitStatus
              }>
                <b className={limitStatusClass}>{limitStatus}</b>
              </Tooltip>
            </div>
            <div>
              <span>Liq. distance</span>
              <Tooltip title={liquidationText}>
                <b className={liquidationStats?.warning === "after" || liquidationStats?.warning === "near" ? "warn" : "ok"}>
                  {liquidationStats ? `${liquidationStats.entryDistancePct.toFixed(2)}%` : "—"}
                </b>
              </Tooltip>
            </div>
            <div>
              <span>SL buffer</span>
              <Tooltip title={liquidationStats ? `${liquidationStatus} · ${liquidationBufferText} before liquidation` : "—"}>
                <b className={liquidationStats?.warning === "after" || liquidationStats?.warning === "near" ? "warn" : "ok"}>
                  {liquidationStats ? `${liquidationStatus} (${liquidationBufferText})` : "—"}
                </b>
              </Tooltip>
            </div>
          </div>
        </div>
      )}
      <div className="tradeBtns">
        <OrderSideButton
          side="LONG"
          className="long"
          label="Long"
          orderDraftSide={orderDraftSide}
          disabled={orderActionsDisabled || insufficientMargin}
          takeProfit={takeProfit}
          stopLoss={stopLoss}
          onBeginOrderDraft={onBeginOrderDraft}
          onCancelOrderDraft={onCancelOrderDraft}
          onPlaceOrder={onPlaceOrder}
        />
        <OrderSideButton
          side="SHORT"
          className="short"
          label="Short"
          orderDraftSide={orderDraftSide}
          disabled={orderActionsDisabled || insufficientMargin}
          takeProfit={takeProfit}
          stopLoss={stopLoss}
          onBeginOrderDraft={onBeginOrderDraft}
          onCancelOrderDraft={onCancelOrderDraft}
          onPlaceOrder={onPlaceOrder}
        />
      </div>
      <div className="sideTitle">ПОЗИЦИИ И ЗАЯВКИ</div>
      {workingTrades.length ? workingTrades.map((trade) => {
        const unrealizedPnl = currentCandle && trade.status === "OPEN"
          ? (trade.side === "LONG" ? currentCandle.close - trade.entry : trade.entry - currentCandle.close) * trade.size - (trade.entryFee ?? 0)
          : null;
        const margin = trade.entry * trade.size / (trade.leverage ?? 1);
        const unrealizedRoi = unrealizedPnl != null && margin > 0
          ? unrealizedPnl / margin * 100
          : null;
        const sideClass = trade.status === "PENDING"
          ? "pending"
          : trade.side === "LONG"
            ? "long"
            : "short";
        const sideLabel = trade.status === "PENDING" ? "LIMIT" : trade.side;

        return (
          <div
            key={trade.id}
            data-trade-focus-id={trade.id}
            className={`position ${focusedTradeId === trade.id ? "focused" : ""}`}
            onClick={() => onTradeFocus(focusedTradeId === trade.id ? null : trade.id)}
          >
            {focusedTradeId === trade.id ? <span className="positionBeam" aria-hidden="true" /> : null}
            <div className="positionContent">
            <div className="positionTop">
              <div className="positionIdentity">
                <span className={`positionSide ${sideClass}`}>{sideLabel}</span>
                <span className="positionSymbol">{baseAsset}</span>
                <span className="positionLeverage">{trade.leverage ?? 1}x</span>
              </div>
              {unrealizedPnl != null ? (
                <div className={`positionPnl ${unrealizedPnl >= 0 ? "positive" : "negative"}`}>
                  <span className="positionPnlValue">
                    {unrealizedPnl >= 0 ? "+" : ""}{formatNumber(unrealizedPnl)} {quoteAsset}
                  </span>
                  <span className="positionPnlPct">
                    {unrealizedRoi != null && unrealizedRoi >= 0 ? "+" : ""}{unrealizedRoi?.toFixed(2)}%
                  </span>
                </div>
              ) : (
                <span className="positionPending">Ожидает</span>
              )}
            </div>
            <div className="positionBottom">
              <div className="positionStats">
                <div className="positionStat">
                  <span>{trade.status === "PENDING" ? "Limit" : "Entry"}</span>
                  <b>{formatPrice(trade.entry, pricePrecision)}</b>
                </div>
                <div className="positionStat">
                  <span>Size</span>
                  <b>{formatPrice(trade.size, Math.min(8, pricePrecision + 2))}</b>
                </div>
              </div>
              <div className="positionActions">
                {editingTradeId === trade.id ? (
                  <>
                    <Tooltip title="Сохранить изменения"><Button className="positionAction save" aria-label="Сохранить изменения" icon={<Check size={14} />} onClick={(event) => { event.stopPropagation(); onTradeEditSave(); }} /></Tooltip>
                    <Tooltip title="Отменить изменения"><Button className="positionAction" aria-label="Отменить изменения" icon={<X size={14} />} onClick={(event) => { event.stopPropagation(); onTradeEditCancel(); }} /></Tooltip>
                  </>
                ) : (
                  <>
                    <Tooltip title="Редактировать"><Button className="positionAction edit" aria-label="Редактировать" icon={<Pencil size={13} />} onClick={(event) => { event.stopPropagation(); onTradeEditStart(trade); }} /></Tooltip>
                    <Tooltip title={trade.status === "PENDING" ? "Отменить заявку" : "Закрыть позицию"}>
                      <Button
                        className={`positionAction ${trade.status === "PENDING" ? "cancel" : "close"}`}
                        aria-label={trade.status === "PENDING" ? "Отменить заявку" : "Закрыть позицию"}
                        icon={<X size={14} />}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (trade.status === "PENDING") onCancelOrder(trade.id);
                          else onCloseTrade(trade);
                          onTradeFocus(null);
                          onTradeEditCancel();
                        }}
                      />
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
            </div>
          </div>
        );
      }) : <div className="muted">Нет активных позиций и заявок</div>}
    </aside>
  );
}
