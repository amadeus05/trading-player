import type {
  FibonacciRetracement,
  FibonacciTrendExtension,
  ParallelChannel,
  Rectangle,
  TrendLine,
  VolumeProfile,
} from "../../types";
import type { DrawingSelectionKind } from "../DrawingManager";

export type DrawingClipboardItem =
  | { kind: "trendline"; data: Omit<TrendLine, "id" | "datasetId"> }
  | { kind: "rectangle"; data: Omit<Rectangle, "id" | "datasetId"> }
  | { kind: "fibonacci"; data: Omit<FibonacciRetracement, "id" | "datasetId"> }
  | { kind: "fibtrendext"; data: Omit<FibonacciTrendExtension, "id" | "datasetId"> }
  | { kind: "parallelchannel"; data: Omit<ParallelChannel, "id" | "datasetId"> }
  | { kind: "volumeprofile"; data: Omit<VolumeProfile, "id" | "datasetId"> };

export function drawingKindFromClipboard(item: DrawingClipboardItem): DrawingSelectionKind {
  return item.kind;
}

export function cloneClipboardItem<T extends DrawingClipboardItem>(item: T): T {
  return structuredClone(item);
}

export interface PasteOffset {
  timeDelta: number;
  priceDelta: number;
}

export function getDefaultPasteOffset(candles: { time: number }[]): PasteOffset {
  const interval = candles.length > 1 ? candles[1].time - candles[0].time : 300;
  return { timeDelta: interval * 5, priceDelta: 0 };
}

function offsetPoint(
  point: { time: number; price: number },
  offset: PasteOffset,
): { time: number; price: number } {
  return {
    time: point.time + offset.timeDelta,
    price: point.price + offset.priceDelta,
  };
}

export function offsetClipboardItem<T extends DrawingClipboardItem>(item: T, offset: PasteOffset): T {
  const cloned = structuredClone(item);
  switch (cloned.kind) {
    case "trendline":
      cloned.data.point1 = offsetPoint(cloned.data.point1, offset);
      cloned.data.point2 = offsetPoint(cloned.data.point2, offset);
      break;
    case "rectangle":
      cloned.data.timeLeft += offset.timeDelta;
      cloned.data.timeRight += offset.timeDelta;
      cloned.data.priceTop += offset.priceDelta;
      cloned.data.priceBottom += offset.priceDelta;
      break;
    case "fibonacci":
      cloned.data.point1 = offsetPoint(cloned.data.point1, offset);
      cloned.data.point2 = offsetPoint(cloned.data.point2, offset);
      break;
    case "fibtrendext":
      cloned.data.point1 = offsetPoint(cloned.data.point1, offset);
      cloned.data.point2 = offsetPoint(cloned.data.point2, offset);
      cloned.data.point3 = offsetPoint(cloned.data.point3, offset);
      break;
    case "parallelchannel":
      cloned.data.point1 = offsetPoint(cloned.data.point1, offset);
      cloned.data.point2 = offsetPoint(cloned.data.point2, offset);
      cloned.data.widthPoint = offsetPoint(cloned.data.widthPoint, offset);
      break;
    case "volumeprofile":
      cloned.data.timeLeft += offset.timeDelta;
      cloned.data.timeRight += offset.timeDelta;
      break;
  }
  return cloned;
}
