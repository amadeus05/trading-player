import type { DrawingMode } from "../shared/types";
import parallelChannelIcon from "./channels/parallel-channel.svg?raw";
import fibRetracementIcon from "./fibonacci/fib-retracement.svg?raw";
import trendBasedFibExtensionIcon from "./fibonacci/trend-based-fib-extension.svg?raw";
import trendLineIcon from "./lines/trend-line.svg?raw";
import rectangleIcon from "./shapes/rectangle.svg?raw";
import measureRulerIcon from "./ui/measure-ruler.svg?raw";

const volumeProfileIcon = `<svg viewBox="0 0 28 28"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M5 4v20"/><path d="M5 7h9M5 11h13M5 15h7M5 19h11"/><path d="M21 4v20" stroke-dasharray="2 2"/></g></svg>`;

const ICONS: Record<Exclude<DrawingMode, "none">, string> = {
  trendline: trendLineIcon,
  rectangle: rectangleIcon,
  measure: measureRulerIcon,
  fibonacci: fibRetracementIcon,
  fibtrendext: trendBasedFibExtensionIcon,
  parallelchannel: parallelChannelIcon,
  volumeprofile: volumeProfileIcon,
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
