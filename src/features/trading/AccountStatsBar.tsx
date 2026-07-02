import type { ReactNode } from "react";
import { formatNumber } from "../../shared/lib/market";
import type { AccountStats } from "./lib/calculateAccountStats";

interface AccountStatsBarProps {
  stats: AccountStats;
  quoteAsset: string;
}

function HeaderStat({
  label,
  value,
  tone,
  primary = false,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
  primary?: boolean;
}) {
  return (
    <div className={`headerStat${primary ? " headerStatPrimary" : ""}`}>
      <span>{label}</span>
      <b className={tone}>{value}</b>
    </div>
  );
}

function HeaderStatGroup({ children }: { children: ReactNode }) {
  return <div className="headerStatsGroup">{children}</div>;
}

export function AccountStatsBar({ stats, quoteAsset }: AccountStatsBarProps) {
  const growthValue = `${stats.growthPct >= 0 ? "+" : ""}${stats.growthPct.toFixed(2)}%`;
  const unrealizedValue = `${stats.unrealizedPnl >= 0 ? "+" : ""}${formatNumber(stats.unrealizedPnl)}`;
  const realizedValue = `${stats.realizedPnl >= 0 ? "+" : ""}${formatNumber(stats.realizedPnl)}`;

  return (
    <div className="headerStats">
      <HeaderStatGroup>
        <HeaderStat
          label="Balance"
          value={`${formatNumber(stats.balance)} ${quoteAsset}`}
          primary
        />
        <HeaderStat label="Equity" value={`${formatNumber(stats.equity)} ${quoteAsset}`} />
        <HeaderStat label="Available" value={formatNumber(stats.availableBalance)} />
        <HeaderStat label="Margin" value={formatNumber(stats.usedMargin)} />
      </HeaderStatGroup>
      <div className="headerStatsSep" aria-hidden="true" />
      <HeaderStatGroup>
        <HeaderStat
          label="Growth"
          value={growthValue}
          tone={stats.growthPct >= 0 ? "pos" : "neg"}
        />
        <HeaderStat
          label="Unrealized"
          value={unrealizedValue}
          tone={stats.unrealizedPnl >= 0 ? "pos" : "neg"}
        />
        <HeaderStat
          label="Realized"
          value={realizedValue}
          tone={stats.realizedPnl >= 0 ? "pos" : "neg"}
        />
      </HeaderStatGroup>
    </div>
  );
}
