import type { IChartApi, ISeriesApi, Logical } from "lightweight-charts";
import type { Candle, Trade } from "../../types";
import { timeToX } from "../../drawing/shared/coordinates";

interface ClosedTradeOverlayOptions {
  container: HTMLElement;
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  candleStore: { candles: Candle[] };
  trades: Trade[];
  visible: boolean;
}

const isVisibleInReplay = (trade: Trade, firstTime: number, lastTime: number) =>
  trade.entryTime >= firstTime
  && trade.entryTime <= lastTime
  && trade.exitTime != null
  && trade.exitTime <= lastTime;

const clampToViewport = (chart: IChartApi, x1: number, x2: number) => {
  const range = chart.timeScale().getVisibleLogicalRange();
  if (!range) return { x1, x2 };
  const left = chart.timeScale().logicalToCoordinate(Math.floor(range.from) as Logical);
  const right = chart.timeScale().logicalToCoordinate(Math.ceil(range.to) as Logical);
  return {
    x1: left == null ? x1 : Math.max(x1, left),
    x2: right == null ? x2 : Math.min(x2, right),
  };
};

const lineYAt = (x: number, xStart: number, yStart: number, xEnd: number, yEnd: number) => {
  if (Math.abs(xEnd - xStart) < 1) return yEnd;
  return yStart + (yEnd - yStart) * ((x - xStart) / (xEnd - xStart));
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

const hideGroup = (
  group: SVGGElement,
  target: SVGRectElement,
  risk: SVGRectElement,
  exitPath: SVGLineElement,
) => {
  group.setAttribute("visibility", "hidden");
  setRect(target, 0, 0, 0, 0);
  setRect(risk, 0, 0, 0, 0);
  exitPath.setAttribute("x1", "0");
  exitPath.setAttribute("y1", "0");
  exitPath.setAttribute("x2", "0");
  exitPath.setAttribute("y2", "0");
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
    const candles = candleStore.candles;
    const firstCandle = candles[0];
    const lastCandle = candles.at(-1);
    if (!firstCandle || !lastCandle) return;
    shapes.forEach(({ trade, group, target, risk, exitPath }) => {
      if (!isVisibleInReplay(trade, firstCandle.time, lastCandle.time)) {
        hideGroup(group, target, risk, exitPath);
        return;
      }
      const x1 = timeToX(chart, trade.entryTime, candles);
      const x2 = timeToX(chart, trade.exitTime!, candles);
      const entryY = series.priceToCoordinate(trade.entry);
      const takeProfitY = series.priceToCoordinate(trade.tp);
      const stopLossY = series.priceToCoordinate(trade.sl);
      const exitY = series.priceToCoordinate(trade.exit!);
      if ([x1, x2, entryY, takeProfitY, stopLossY, exitY].some((value) => value == null)) {
        hideGroup(group, target, risk, exitPath);
        return;
      }
      const zoneEndX = Math.max(x1! + 6, x2!);
      const { x1: drawX1, x2: drawX2 } = clampToViewport(chart, x1!, zoneEndX);
      if (drawX2 - drawX1 < 6) {
        hideGroup(group, target, risk, exitPath);
        return;
      }
      group.setAttribute("visibility", "visible");
      setRect(target, drawX1, drawX2, entryY!, takeProfitY!);
      setRect(risk, drawX1, drawX2, entryY!, stopLossY!);
      const lineStartX = drawX1;
      const lineEndX = Math.min(x2!, drawX2);
      if (lineEndX - lineStartX < 2) {
        exitPath.setAttribute("x1", "0");
        exitPath.setAttribute("y1", "0");
        exitPath.setAttribute("x2", "0");
        exitPath.setAttribute("y2", "0");
        return;
      }
      const lineStartY = lineYAt(lineStartX, x1!, entryY!, x2!, exitY!);
      const lineEndY = lineYAt(lineEndX, x1!, entryY!, x2!, exitY!);
      exitPath.setAttribute("x1", String(lineStartX));
      exitPath.setAttribute("y1", String(lineStartY));
      exitPath.setAttribute("x2", String(lineEndX));
      exitPath.setAttribute("y2", String(lineEndY));
    });
  };

  return { sync, destroy: () => overlay.remove() };
};
