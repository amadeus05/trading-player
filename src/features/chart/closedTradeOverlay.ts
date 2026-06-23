import type { IChartApi, ISeriesApi, Logical } from "lightweight-charts";
import type { Candle, Trade } from "../../types";

interface ClosedTradeOverlayOptions {
  container: HTMLElement;
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  candleStore: { candles: Candle[] };
  trades: Trade[];
  visible: boolean;
}

const candleIndexAt = (candles: Candle[], time: number) => {
  let low = 0;
  let high = candles.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (candles[middle].time <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
};

const setRect = (
  rect: SVGRectElement,
  x1: number,
  x2: number,
  y1: number,
  y2: number,
) => {
  rect.setAttribute("x", String(Math.min(x1, x2)));
  rect.setAttribute("y", String(Math.min(y1, y2)));
  rect.setAttribute("width", String(Math.max(6, Math.abs(x2 - x1))));
  rect.setAttribute("height", String(Math.max(1, Math.abs(y2 - y1))));
};

export function attachClosedTradeOverlay({
  container,
  chart,
  series,
  candleStore,
  trades,
  visible,
}: ClosedTradeOverlayOptions) {
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.classList.add("closed-trades-overlay");
  container.appendChild(overlay);

  const shapes = (visible ? trades : [])
    .filter((trade) => trade.status === "CLOSED" && trade.exitTime != null && trade.exit != null)
    .map((trade) => {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const target = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      const risk = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      const exitPath = document.createElementNS("http://www.w3.org/2000/svg", "line");
      target.setAttribute("class", "trade-zone target");
      risk.setAttribute("class", "trade-zone risk");
      exitPath.setAttribute("class", "trade-exit-path");
      group.append(target, risk, exitPath);
      overlay.appendChild(group);
      return { trade, group, target, risk, exitPath };
    });

  const sync = () => {
    const firstCandle = candleStore.candles[0];
    const lastCandle = candleStore.candles.at(-1);
    if (!firstCandle || !lastCandle) return;
    shapes.forEach(({ trade, group, target, risk, exitPath }) => {
      if (trade.entryTime < firstCandle.time || trade.exitTime! > lastCandle.time) {
        group.setAttribute("visibility", "hidden");
        return;
      }
      const entryIndex = candleIndexAt(candleStore.candles, trade.entryTime);
      const exitIndex = candleIndexAt(candleStore.candles, trade.exitTime!);
      const x1 = entryIndex >= 0
        ? chart.timeScale().logicalToCoordinate(entryIndex as Logical)
        : null;
      const x2 = exitIndex >= 0
        ? chart.timeScale().logicalToCoordinate(exitIndex as Logical)
        : null;
      const entryY = series.priceToCoordinate(trade.entry);
      const takeProfitY = series.priceToCoordinate(trade.tp);
      const stopLossY = series.priceToCoordinate(trade.sl);
      const exitY = series.priceToCoordinate(trade.exit!);
      if ([x1, x2, entryY, takeProfitY, stopLossY, exitY].some((value) => value == null)) {
        group.setAttribute("visibility", "hidden");
        return;
      }
      group.setAttribute("visibility", "visible");
      const zoneEndX = Math.max(x1! + 6, x2!);
      setRect(target, x1!, zoneEndX, entryY!, takeProfitY!);
      setRect(risk, x1!, zoneEndX, entryY!, stopLossY!);
      exitPath.setAttribute("x1", String(x1));
      exitPath.setAttribute("y1", String(entryY));
      exitPath.setAttribute("x2", String(x2));
      exitPath.setAttribute("y2", String(exitY));
    });
  };

  return { sync, destroy: () => overlay.remove() };
}
