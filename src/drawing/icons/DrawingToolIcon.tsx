import type { DrawingMode } from "../shared/types";
import parallelChannelIcon from "./channels/parallel-channel.svg?raw";
import fibRetracementIcon from "./fibonacci/fib-retracement.svg?raw";
import trendBasedFibExtensionIcon from "./fibonacci/trend-based-fib-extension.svg?raw";
import trendLineIcon from "./lines/trend-line.svg?raw";
import rectangleIcon from "./shapes/rectangle.svg?raw";
import measureRulerIcon from "./ui/measure-ruler.svg?raw";

const ICONS: Record<Exclude<DrawingMode, "none">, string> = {
  trendline: trendLineIcon,
  rectangle: rectangleIcon,
  measure: measureRulerIcon,
  fibonacci: fibRetracementIcon,
  fibtrendext: trendBasedFibExtensionIcon,
  parallelchannel: parallelChannelIcon,
};

function normalizeTradingViewIcon(svg: string): string {
  return svg
    .replace(/\s(width|height)="[^"]*"/g, "")
    .replace("<svg", '<svg class="drawing-tool-icon__svg" focusable="false"');
}

interface DrawingToolIconProps {
  mode: Exclude<DrawingMode, "none">;
}

export function DrawingToolIcon({ mode }: DrawingToolIconProps) {
  return (
    <span
      className="drawing-tool-icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: normalizeTradingViewIcon(ICONS[mode]) }}
    />
  );
}
