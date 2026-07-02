import { Button, Tag } from "antd";
import { BarChart3, BookOpen, Settings } from "lucide-react";
import { HistoryManager } from "../features/datasets/HistoryManager";
import { AccountStatsBar } from "../features/trading/AccountStatsBar";
import type { AccountStats } from "../features/trading/lib/calculateAccountStats";
import type { Dataset } from "../types";

interface AppHeaderProps {
  tradeCount: number;
  quoteAsset: string;
  accountStats: AccountStats;
  onMarketOpen: (market: Dataset) => void;
  onSettingsOpen: () => void;
  onJournalOpen: () => void;
}

export function AppHeader({
  tradeCount,
  quoteAsset,
  accountStats,
  onMarketOpen,
  onSettingsOpen,
  onJournalOpen,
}: AppHeaderProps) {
  return (
    <header>
      <div className="brand">
        <div className="logo"><BarChart3 size={20} /></div>
        <div>
          <b>CANDLE LAB</b>
          <small>Replay terminal</small>
        </div>
      </div>
      <AccountStatsBar stats={accountStats} quoteAsset={quoteAsset} />
      <div className="headerRight">
        <HistoryManager onOpen={onMarketOpen} />
        <span className="live"><i /> LOCAL</span>
        <Button icon={<Settings size={16} />} onClick={onSettingsOpen}>
          Настройки
        </Button>
        <Button icon={<BookOpen size={16} />} onClick={onJournalOpen}>
          Журнал <Tag>{tradeCount}</Tag>
        </Button>
      </div>
    </header>
  );
}
