import { formatNumber } from "../../shared/lib/market";
import type { AccountStats } from "./lib/calculateAccountStats";
import type { HeaderStatsVariant } from "../../types";

interface AccountStatsBarProps {
  stats: AccountStats;
  quoteAsset: string;
  variant?: HeaderStatsVariant;
}

function toneOf(value: number): "pos" | "neg" | undefined {
  if (value > 0) return "pos";
  if (value < 0) return "neg";
  return undefined;
}

export function AccountStatsBar({
  stats,
  quoteAsset,
  variant = "ticker",
}: AccountStatsBarProps) {
  const growthValue = `${stats.growthPct >= 0 ? "+" : ""}${stats.growthPct.toFixed(2)}%`;
  const unrealizedValue = `${stats.unrealizedPnl >= 0 ? "+" : ""}${formatNumber(stats.unrealizedPnl)}`;
  const realizedValue = `${stats.realizedPnl >= 0 ? "+" : ""}${formatNumber(stats.realizedPnl)}`;

  return (
    <div className={`headerStats headerStats--${variant}`}>
      <div className="headerStatsTrack">
        <div className="headerStatsGroup headerStatsGroup--account">
          <div className="headerStat headerStat--main">
            <span>Balance</span>
            <b>{formatNumber(stats.balance)} <i>{quoteAsset}</i></b>
          </div>
          <div className="headerStat">
            <span>Equity</span>
            <b>{formatNumber(stats.equity)}</b>
          </div>
          <div className="headerStat">
            <span>Available</span>
            <b>{formatNumber(stats.availableBalance)}</b>
          </div>
          <div className="headerStat">
            <span>Margin</span>
            <b>{formatNumber(stats.usedMargin)}</b>
          </div>
        </div>

        <div className="headerStatsSplit" aria-hidden="true" />

        <div className="headerStatsGroup headerStatsGroup--pnl">
          <div className={`headerStat headerStat--growth ${toneOf(stats.growthPct) ?? ""}`}>
            <span>Growth</span>
            <b className={toneOf(stats.growthPct)}>{growthValue}</b>
          </div>
          <div className="headerStat">
            <span>Unrealized</span>
            <b className={toneOf(stats.unrealizedPnl)}>{unrealizedValue}</b>
          </div>
          <div className="headerStat">
            <span>Realized</span>
            <b className={toneOf(stats.realizedPnl)}>{realizedValue}</b>
          </div>
        </div>
      </div>
    </div>
  );
}
