import type { IPriceLine, ISeriesApi } from "lightweight-charts";
import type { Barrier, Trade } from "../../types";

interface PriceMarkersOptions {
  container: HTMLElement;
  series: ISeriesApi<"Candlestick">;
  barriers: Barrier[];
  trades: Trade[];
  entryMarker?: { id: string; price: number };
  editable: boolean;
  pricePrecision: number;
  quoteAsset: string;
  onBarrierChange: (id: string, kind: "tp" | "sl", price: number) => void;
  onEntryMarkerChange: (id: string, price: number) => void;
  onFrame: () => void;
}

// en-US, как и остальные числа в приложении (formatNumber): десятичная точка,
// чтобы сумма на метке не спорила с ценой прямо рядом с ней.
const moneyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Сколько денег принесёт или заберёт сделка, если цена дойдёт до этой метки.
 *
 * Считаем чистыми, с комиссиями обеих сторон: иначе цифра на графике не сошлась
 * бы с тем, что потом попадёт в журнал. Take profit исполняется лимитом, значит
 * maker, а stop loss уходит по рынку — taker.
 */
function amountAtPrice(trade: Trade, price: number, kind: "tp" | "sl"): number | null {
  if (!(trade.size > 0) || !(trade.entry > 0) || !(price > 0)) return null;
  const gross = (trade.side === "LONG" ? price - trade.entry : trade.entry - price) * trade.size;
  const exitFeePct = kind === "tp" ? trade.makerFeePct : trade.takerFeePct;
  const exitFee = exitFeePct != null ? price * trade.size * exitFeePct / 100 : 0;
  const net = gross - (trade.entryFee ?? 0) - exitFee;
  return Number.isFinite(net) ? net : null;
}

const formatMoney = (value: number, quoteAsset: string) =>
  `${value >= 0 ? "+" : "−"}${moneyFormat.format(Math.abs(value))} ${quoteAsset}`;

/** Метка-пилюля: цветной торец с типом, сумма, цена. */
function buildHandle(kind: string, className: string, editable: boolean) {
  const handle = document.createElement("button");
  handle.className = `barrier-handle ${className}${editable ? "" : " read-only"}`;
  const cap = document.createElement("span");
  cap.className = "barrier-cap";
  cap.textContent = kind;
  const amount = document.createElement("span");
  amount.className = "barrier-amount";
  const price = document.createElement("span");
  price.className = "barrier-price";
  handle.append(cap, amount, price);
  return { handle, amount, price };
}

export function attachPriceMarkers({
  container,
  series,
  barriers,
  trades,
  entryMarker,
  editable,
  pricePrecision,
  quoteAsset,
  onBarrierChange,
  onEntryMarkerChange,
  onFrame,
}: PriceMarkersOptions) {
  const handles: HTMLButtonElement[] = [];
  const priceLines: IPriceLine[] = [];
  const positions: Array<{ handle: HTMLButtonElement; price: () => number }> = [];

  barriers.forEach((barrier) => {
    const trade = trades.find((item) => item.id === barrier.id);
    if (!trade) return;
    (["tp", "sl"] as const).forEach((kind) => {
      if (trade[kind] <= 0) return;
      const color = kind === "tp" ? "#2bd9a8" : "#ff5c73";
      let displayedPrice = trade[kind];
      const line = series.createPriceLine({
        price: displayedPrice,
        color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
        title: "",
      });
      priceLines.push(line);
      const { handle, amount, price: priceLabel } = buildHandle(kind.toUpperCase(), kind, editable);
      const render = (value: number) => {
        priceLabel.textContent = value.toFixed(pricePrecision);
        const money = amountAtPrice(trade, value, kind);
        amount.textContent = money == null ? "" : formatMoney(money, quoteAsset);
        // Перетащили стоп выше входа — метка «SL» покажет плюс. Красим по знаку
        // суммы, а не по типу метки, иначе цвет врал бы о результате.
        handle.classList.toggle("gain", money != null && money >= 0);
        handle.classList.toggle("loss", money != null && money < 0);
      };
      render(displayedPrice);
      container.appendChild(handle);
      handles.push(handle);
      positions.push({ handle, price: () => displayedPrice });
      if (!editable) return;
      handle.onpointerdown = (event) => {
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        const move = (pointerEvent: PointerEvent) => {
          const bounds = container.getBoundingClientRect();
          const price = series.coordinateToPrice(pointerEvent.clientY - bounds.top);
          if (price === null || price <= 0) return;
          displayedPrice = price;
          line.applyOptions({ price });
          render(price);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          onBarrierChange(barrier.id, kind, displayedPrice);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up, { once: true });
      };
    });
  });

  if (entryMarker) {
    let displayedPrice = entryMarker.price;
    const line = series.createPriceLine({
      price: displayedPrice,
      color: "#9b8cff",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: false,
      title: "",
    });
    priceLines.push(line);
    // У метки входа суммы нет: это точка отсчёта, от неё и считаются остальные.
    const { handle, price: priceLabel } = buildHandle("LIMIT", "entry", editable);
    priceLabel.textContent = displayedPrice.toFixed(pricePrecision);
    container.appendChild(handle);
    handles.push(handle);
    positions.push({ handle, price: () => displayedPrice });
    if (editable) {
      handle.onpointerdown = (event) => {
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        const move = (pointerEvent: PointerEvent) => {
          const bounds = container.getBoundingClientRect();
          const price = series.coordinateToPrice(pointerEvent.clientY - bounds.top);
          if (price === null || price <= 0) return;
          displayedPrice = price;
          line.applyOptions({ price });
          priceLabel.textContent = price.toFixed(pricePrecision);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          onEntryMarkerChange(entryMarker.id, displayedPrice);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up, { once: true });
      };
    }
  }

  const sync = () => {
    onFrame();
    positions.forEach(({ handle, price }) => {
      const y = series.priceToCoordinate(price());
      if (y !== null) handle.style.top = `${y}px`;
    });
  };

  return {
    sync,
    cleanup: () => {
      handles.forEach((handle) => handle.remove());
      priceLines.forEach((line) => {
        try { series.removePriceLine(line); } catch { /* chart may already be disposed */ }
      });
    },
  };
}
