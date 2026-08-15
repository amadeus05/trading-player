import { useState } from "react";
import { Button, Dropdown } from "antd";
import { MessageSquare, MoreHorizontal, Trash2 } from "lucide-react";
import type { Trade, TradeScreenshot } from "../../types";
import { formatDateTime, formatNumber, formatTimeframe } from "../../shared/lib/market";
import { useConfirmDelete } from "../../shared/ui/useConfirmDelete";
import { tradeRisk } from "../trading/lib/calculateTradeAnalytics";
import { JournalTradeNotes } from "./JournalTradeNotes";

const signClass = (value: number) => (value >= 0 ? "pos" : "neg");
const signed = (value: number) => `${value >= 0 ? "+" : ""}${formatNumber(value)}`;

export interface JournalTradeTableProps {
  trades: Trade[];
  datasetName: (id?: string) => string;
  knownTags: string[];
  onJumpToTrade?: (trade: Trade) => void;
  onCancelOrder: (id: string) => void;
  onCloseTrade: (trade: Trade) => void;
  onDeleteTrade: (id: string) => void;
  onUpdateTradeJournal: (id: string, patch: { comment?: string; screenshots?: TradeScreenshot[]; tags?: string[] }) => void;
  emptyText?: string;
}

export function JournalTradeTable({
  trades,
  datasetName,
  knownTags,
  onJumpToTrade,
  onCancelOrder,
  onCloseTrade,
  onDeleteTrade,
  onUpdateTradeJournal,
  emptyText,
}: JournalTradeTableProps) {
  const confirmDelete = useConfirmDelete();
  const [notesTradeId, setNotesTradeId] = useState<string | null>(null);

  return (
    <div className="journalRows">
      <div className="journalRowsHead">
        <span>Время</span>
        <span>Инструмент</span>
        <span>Side</span>
        <span>Вход → выход</span>
        <span className="num">P&L</span>
        <span />
      </div>
      {trades.length === 0 && emptyText ? <div className="journalEmpty">{emptyText}</div> : null}
      {trades.map((trade) => {
        const risk = tradeRisk(trade);
        const rMultiple = risk != null && trade.result != null ? trade.result / risk : null;
        const tone = trade.status !== "CLOSED" ? "open" : (trade.result ?? 0) >= 0 ? "pos" : "neg";
        const notesOpen = notesTradeId === trade.id;
        const hasNotes = Boolean((trade.comment ?? "").trim())
          || (trade.screenshots?.length ?? 0) > 0
          || (trade.tags?.length ?? 0) > 0;
        return (
          <div key={trade.id} className={`journalRow ${tone} ${notesOpen ? "is-open" : ""}`}>
            <div
              className="journalRowMain"
              role={onJumpToTrade ? "button" : undefined}
              tabIndex={onJumpToTrade ? 0 : undefined}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button, .journalRowMenu, .ant-dropdown")) return;
                onJumpToTrade?.(trade);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onJumpToTrade?.(trade);
                }
              }}
            >
              <span className="journalRowTime">{formatDateTime(trade.entryTime)}</span>
              <span className="journalRowSymbol">
                {datasetName(trade.datasetId)}
                {trade.timeframeMinutes ? <i>{formatTimeframe(trade.timeframeMinutes)}</i> : null}
              </span>
              <span className={trade.side === "LONG" ? "pos" : "neg"}>{trade.side}</span>
              <span className="journalRowPrices">
                {formatNumber(trade.entry)}
                <i>→</i>
                {trade.exit == null
                  ? <em>{trade.status === "PENDING" ? "заявка" : "открыта"}</em>
                  : formatNumber(trade.exit)}
              </span>
              <span className="journalRowPnl num">
                <b className={trade.result == null ? "" : signClass(trade.result)}>
                  {trade.result == null ? "—" : signed(trade.result)}
                </b>
                <i>
                  {rMultiple == null ? "—" : `${rMultiple >= 0 ? "+" : ""}${rMultiple.toFixed(1)}R`}
                  {" · "}
                  {trade.outcome ?? trade.status}
                </i>
              </span>
              <span
                className="journalRowMenu"
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <Button
                  size="small"
                  type="text"
                  className={`journalNotesBtn ${notesOpen ? "is-active" : ""} ${hasNotes ? "has-notes" : ""}`}
                  aria-label={notesOpen ? "Скрыть заметку" : "Заметка, теги и скрины"}
                  title={notesOpen ? "Скрыть заметку" : "Заметка, теги и скрины"}
                  icon={<MessageSquare size={15} />}
                  onClick={() => setNotesTradeId(notesOpen ? null : trade.id)}
                />
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      { key: "notes", label: notesOpen ? "Скрыть заметку" : "Заметка, теги и скрины" },
                      ...(trade.status === "PENDING"
                        ? [{ key: "cancel", label: "Отменить заявку" }]
                        : []),
                      ...(trade.status === "OPEN"
                        ? [{ key: "close", label: "Закрыть сделку" }]
                        : []),
                      { key: "delete", danger: true, icon: <Trash2 size={14} />, label: "Удалить" },
                    ],
                    onClick: ({ key }) => {
                      if (key === "notes") setNotesTradeId(notesOpen ? null : trade.id);
                      if (key === "cancel") onCancelOrder(trade.id);
                      if (key === "close") onCloseTrade(trade);
                      if (key === "delete") {
                        confirmDelete({
                          title: "Удалить сделку?",
                          content: "Сделка, заметка, теги и скрины будут удалены.",
                          onConfirm: () => onDeleteTrade(trade.id),
                        });
                      }
                    },
                  }}
                >
                  <Button size="small" type="text" aria-label="Действия со сделкой" icon={<MoreHorizontal size={15} />} />
                </Dropdown>
              </span>
            </div>
            {notesOpen && (
              <JournalTradeNotes
                trade={trade}
                knownTags={knownTags}
                onCommentChange={(comment) => onUpdateTradeJournal(trade.id, { comment })}
                onScreenshotsChange={(screenshots) => onUpdateTradeJournal(trade.id, { screenshots })}
                onTagsChange={(nextTags) => onUpdateTradeJournal(trade.id, { tags: nextTags })}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
