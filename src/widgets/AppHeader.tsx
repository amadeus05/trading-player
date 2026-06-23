import { Button, Tag } from "antd";
import { BarChart3, BookOpen, Settings } from "lucide-react";
import { HistoryManager } from "../HistoryManager";
import type { Dataset } from "../types";

interface AppHeaderProps {
  tradeCount: number;
  onMarketOpen: (market: Dataset) => void;
  onSettingsOpen: () => void;
  onJournalOpen: () => void;
}

export function AppHeader({
  tradeCount,
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
