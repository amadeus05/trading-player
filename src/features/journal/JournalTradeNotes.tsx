import { useEffect, useRef, useState } from "react";
import { App as AntApp, Image, Input, Select } from "antd";
import { ImagePlus, X } from "lucide-react";
import type { Trade, TradeScreenshot } from "../../types";
import { compressJournalImage, JOURNAL_IMAGE_ACCEPT, isJournalImageFile } from "./compressJournalImage";
import { MAX_TRADE_TAGS, normalizeTradeTags } from "./tradeTags";

export const MAX_TRADE_SCREENSHOTS = 8;

interface JournalTradeNotesProps {
  trade: Trade;
  knownTags: string[];
  onCommentChange: (comment: string) => void;
  onScreenshotsChange: (screenshots: TradeScreenshot[]) => void;
  onTagsChange: (tags: string[]) => void;
}

function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromItems = [...data.items]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .flatMap((item) => {
      const file = item.getAsFile();
      return file ? [file] : [];
    });
  return fromItems.length ? fromItems : [...data.files].filter(isJournalImageFile);
}

export function JournalTradeNotes({
  trade,
  knownTags,
  onCommentChange,
  onScreenshotsChange,
  onTagsChange,
}: JournalTradeNotesProps) {
  const { message } = AntApp.useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [comment, setComment] = useState(trade.comment ?? "");
  const [dropActive, setDropActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const screenshots = trade.screenshots ?? [];
  const commentRef = useRef(comment);
  commentRef.current = comment;
  const onCommentChangeRef = useRef(onCommentChange);
  onCommentChangeRef.current = onCommentChange;
  const saveTimerRef = useRef(0);

  useEffect(() => {
    setComment(trade.comment ?? "");
  }, [trade.id]);

  useEffect(() => () => {
    window.clearTimeout(saveTimerRef.current);
    onCommentChangeRef.current(commentRef.current);
  }, []);

  const scheduleCommentSave = (next: string) => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => onCommentChangeRef.current(next), 400);
  };

  const addFiles = async (files: File[]) => {
    const images = files.filter(isJournalImageFile);
    if (!images.length) {
      void message.warning("Нужен файл изображения");
      return;
    }
    const room = MAX_TRADE_SCREENSHOTS - screenshots.length;
    if (room <= 0) {
      void message.warning(`К сделке можно прикрепить не больше ${MAX_TRADE_SCREENSHOTS} скринов`);
      return;
    }
    const selected = images.slice(0, room);
    if (images.length > room) {
      void message.warning(`Добавлю ${room} из ${images.length}: лимит ${MAX_TRADE_SCREENSHOTS} скринов`);
    }
    setBusy(true);
    try {
      const added: TradeScreenshot[] = [];
      for (const file of selected) {
        const compressed = await compressJournalImage(file);
        added.push({
          id: crypto.randomUUID(),
          name: compressed.name,
          mime: compressed.mime,
          dataUrl: compressed.dataUrl,
          createdAt: Date.now(),
        });
      }
      onScreenshotsChange([...screenshots, ...added]);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Не удалось прикрепить скрин");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`journalNotes ${dropActive ? "is-drop" : ""}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPaste={(event) => {
        const files = filesFromClipboard(event.clipboardData);
        if (!files.length) return;
        event.preventDefault();
        void addFiles(files);
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        if (filesFromClipboard(event.dataTransfer).length) setDropActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
        void addFiles(filesFromClipboard(event.dataTransfer));
      }}
    >
      <Select
        mode="tags"
        className="journalTagSelect"
        value={trade.tags ?? []}
        options={knownTags.map((tag) => ({ value: tag, label: tag }))}
        placeholder="Теги: FVG, breakout, ошибка входа…"
        tokenSeparators={[","]}
        maxCount={MAX_TRADE_TAGS}
        allowClear
        onChange={(value) => onTagsChange(normalizeTradeTags(value))}
      />
      <Input.TextArea
        value={comment}
        autoSize={{ minRows: 3, maxRows: 8 }}
        placeholder="Комментарий к сделке: сетап, ошибка, что сработало…"
        onChange={(event) => {
          const next = event.target.value;
          setComment(next);
          scheduleCommentSave(next);
        }}
      />
      <div className="journalShots">
        {screenshots.length > 0 && (
          <Image.PreviewGroup>
            {screenshots.map((shot) => (
              <div key={shot.id} className="journalShot">
                <Image src={shot.dataUrl} alt={shot.name} />
                <button
                  type="button"
                  className="journalShotRemove"
                  aria-label={`Удалить ${shot.name}`}
                  onClick={() => onScreenshotsChange(screenshots.filter((item) => item.id !== shot.id))}
                >
                  <X size={12} strokeWidth={2.4} />
                </button>
              </div>
            ))}
          </Image.PreviewGroup>
        )}
        <button
          type="button"
          className="journalShotAdd"
          disabled={busy || screenshots.length >= MAX_TRADE_SCREENSHOTS}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={16} strokeWidth={2} />
          <span>{busy ? "Сжимаю…" : "Скрин"}</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={JOURNAL_IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            void addFiles(files);
          }}
        />
      </div>
      <p className="journalNotesHint">
        Enter или запятая создаёт тег. Скрин можно вставить из буфера (Ctrl+V) или перетащить. До {MAX_TRADE_SCREENSHOTS} штук.
      </p>
    </div>
  );
}
