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
  onBarrierChange: (id: string, kind: "tp" | "sl", price: number) => void;
  onEntryMarkerChange: (id: string, price: number) => void;
  onFrame: () => void;
}

export function attachPriceMarkers({
  container,
  series,
  barriers,
  trades,
  entryMarker,
  editable,
  pricePrecision,
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
      const handle = document.createElement("button");
      handle.className = `barrier-handle ${kind}${editable ? "" : " read-only"}`;
      handle.textContent = `${kind.toUpperCase()} ${displayedPrice.toFixed(pricePrecision)}`;
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
          handle.textContent = `${kind.toUpperCase()} ${price.toFixed(pricePrecision)}`;
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
    const handle = document.createElement("button");
    handle.className = `barrier-handle entry${editable ? "" : " read-only"}`;
    handle.textContent = `LIMIT ${displayedPrice.toFixed(pricePrecision)}`;
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
          handle.textContent = `LIMIT ${price.toFixed(pricePrecision)}`;
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
