import { Button, Card, Checkbox, InputNumber, Select, Slider, Tag, Tooltip } from "antd";
import { Check, CircleHelp, Pencil, X } from "lucide-react";
import type { Candle, Trade } from "../../types";
import { formatDateTime, formatNumber, formatPrice } from "../../shared/lib/market";
import type { AmountUnit, OrderType } from "./types";

interface TradingSidebarProps {
  currentCandle?: Candle;
  pricePrecision: number;
  baseAsset: string;
  quoteAsset: string;
  orderType: OrderType;
  leverage: number;
  amountUnit: AmountUnit;
  orderValue: number;
  allocationPercent: number;
  limitPrice: number;
  protectionEnabled: boolean;
  takeProfit: number;
  stopLoss: number;
  ticketQuantity: number;
  ticketMargin: number;
  longLiquidation: number | null;
  shortLiquidation: number | null;
  hasBlockingTrade: boolean;
  workingTrades: Trade[];
  focusedTradeId: string | null;
  editingTradeId: string | null;
  onOrderTypeChange: (type: OrderType) => void;
  onLeverageChange: (leverage: number) => void;
  onAmountUnitChange: (unit: AmountUnit) => void;
  onOrderValueChange: (value: number) => void;
  onAllocationChange: (percent: number) => void;
  onLimitPriceChange: (price: number) => void;
  onProtectionChange: (enabled: boolean) => void;
  onTakeProfitChange: (price: number) => void;
  onStopLossChange: (price: number) => void;
  onPlaceOrder: (side: Trade["side"]) => void;
  onTradeFocus: (id: string | null) => void;
  onTradeEditStart: (trade: Trade) => void;
  onTradeEditCancel: () => void;
  onTradeEditSave: () => void;
  onCancelOrder: (id: string) => void;
  onCloseTrade: (trade: Trade) => void;
}

export function TradingSidebar({
  currentCandle,
  pricePrecision,
  baseAsset,
  quoteAsset,
  orderType,
  leverage,
  amountUnit,
  orderValue,
  allocationPercent,
  limitPrice,
  protectionEnabled,
  takeProfit,
  stopLoss,
  ticketQuantity,
  ticketMargin,
  longLiquidation,
  shortLiquidation,
  hasBlockingTrade,
  workingTrades,
  focusedTradeId,
  editingTradeId,
  onOrderTypeChange,
  onLeverageChange,
  onAmountUnitChange,
  onOrderValueChange,
  onAllocationChange,
  onLimitPriceChange,
  onProtectionChange,
  onTakeProfitChange,
  onStopLossChange,
  onPlaceOrder,
  onTradeFocus,
  onTradeEditStart,
  onTradeEditCancel,
  onTradeEditSave,
  onCancelOrder,
  onCloseTrade,
}: TradingSidebarProps) {
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
      <div className="protectionToggle">
        <Checkbox disabled={editingTradeId != null} checked={protectionEnabled} onChange={(event) => onProtectionChange(event.target.checked)}>
          TP / SL
        </Checkbox>
        <span>обязательно</span>
      </div>
      {protectionEnabled && (
        <div className="limitProtection">
          <div className="ticketField"><span>Take Profit</span><InputNumber controls={false} placeholder="Не задан" value={takeProfit || undefined} precision={pricePrecision} step={10 ** -pricePrecision} onChange={(value) => onTakeProfitChange(value ?? 0)} /></div>
          <div className="ticketField"><span>Stop Loss</span><InputNumber controls={false} placeholder="Не задан" value={stopLoss || undefined} precision={pricePrecision} step={10 ** -pricePrecision} onChange={(value) => onStopLossChange(value ?? 0)} /></div>
        </div>
      )}
      <div className="ticketField">
        <span>Value</span>
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
        <div><span>Cost</span><b>{ticketMargin ? `${formatNumber(ticketMargin)} ${quoteAsset}` : "—"}</b></div>
        <div><span>Liq. Price</span><b><em>{longLiquidation != null ? formatPrice(longLiquidation, pricePrecision) : "—"}</em> / <strong>{shortLiquidation != null ? formatPrice(shortLiquidation, pricePrecision) : "—"}</strong></b></div>
      </div>
      <div className="tradeBtns">
        <Button className="long" disabled={hasBlockingTrade || !currentCandle || !protectionEnabled || takeProfit <= 0 || stopLoss <= 0} onClick={() => onPlaceOrder("LONG")}>Long</Button>
        <Button className="short" disabled={hasBlockingTrade || !currentCandle || !protectionEnabled || takeProfit <= 0 || stopLoss <= 0} onClick={() => onPlaceOrder("SHORT")}>Short</Button>
      </div>
      <div className="sideTitle">ПОЗИЦИИ И ЗАЯВКИ</div>
      {workingTrades.length ? workingTrades.map((trade) => {
        const unrealizedPnl = currentCandle && trade.status === "OPEN"
          ? (trade.side === "LONG" ? currentCandle.close - trade.entry : trade.entry - currentCandle.close) * trade.size
          : null;
        const margin = trade.entry * trade.size / (trade.leverage ?? 1);
        const unrealizedRoi = unrealizedPnl != null && margin > 0
          ? unrealizedPnl / margin * 100
          : null;
        return (
          <Card
            size="small"
            key={trade.id}
            data-trade-focus-id={trade.id}
            className={`position ${focusedTradeId === trade.id ? "focused" : ""}`}
            onClick={() => onTradeFocus(trade.id)}
          >
            <div className="positionMain">
              <Tag color={trade.status === "PENDING" ? "orange" : trade.side === "LONG" ? "green" : "red"}>{trade.status === "PENDING" ? "LIMIT" : trade.side}</Tag>
              <div className="positionPrice"><b>{formatPrice(trade.entry, pricePrecision)}</b><small>{trade.leverage ?? 1}x · {formatPrice(trade.size, Math.min(8, pricePrecision + 2))} {baseAsset}</small></div>
              {unrealizedPnl != null && (
                <div className={`positionPnl ${unrealizedPnl >= 0 ? "positive" : "negative"}`}>
                  <b>{unrealizedPnl >= 0 ? "+" : ""}{formatNumber(unrealizedPnl)} {quoteAsset}</b>
                  <em>{unrealizedRoi != null && unrealizedRoi >= 0 ? "+" : ""}{unrealizedRoi?.toFixed(2)}%</em>
                </div>
              )}
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
          </Card>
        );
      }) : <div className="muted">Нет активных позиций и заявок</div>}
      <div className="tip">
        Будущие свечи скрыты
        <br />
        <span>Доступно до {currentCandle ? formatDateTime(currentCandle.time) : "—"}</span>
      </div>
    </aside>
  );
}
