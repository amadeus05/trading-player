import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "antd";
import { ChevronDown } from "lucide-react";
import {
  availableTimeframes,
  loadPinnedTimeframes,
  savePinnedTimeframes,
  sortTimeframes,
  type TimeframeOption,
} from "../shared/config/simulation";
import { formatTimeframe } from "../shared/lib/market";

interface TimeframePickerProps {
  timeframe: number;
  onTimeframeChange: (timeframe: number) => void;
}

export function TimeframePicker({ timeframe, onTimeframeChange }: TimeframePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef(0);
  const editingRef = useRef(false);
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const [pinned, setPinned] = useState<TimeframeOption[]>(loadPinnedTimeframes);
  const [draft, setDraft] = useState<TimeframeOption[]>(pinned);
  const [editing, setEditing] = useState(false);
  editingRef.current = editing;

  const visiblePins = sortTimeframes(editing ? draft : pinned);
  const barItems = visiblePins.includes(timeframe as TimeframeOption)
    ? visiblePins
    : [...visiblePins, timeframe];

  const cancelClose = () => {
    if (!closeTimerRef.current) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = 0;
  };

  const discardEdit = () => {
    setDraft(pinned);
    setEditing(false);
  };

  const closeMenu = (discard = true) => {
    cancelClose();
    if (discard) discardEdit();
    setMenu(null);
  };

  const openMenu = () => {
    const el = rootRef.current;
    if (!el) return;
    cancelClose();
    const rect = el.getBoundingClientRect();
    setMenu({ top: rect.bottom + 4, left: rect.left });
  };

  const scheduleClose = () => {
    if (editingRef.current) return;
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => closeMenu(), 160);
  };

  const select = (value: number) => {
    if (editing) return;
    if (value !== timeframe) onTimeframeChange(value);
    closeMenu();
  };

  const pin = (value: TimeframeOption) => {
    setDraft((current) => current.includes(value) ? current : sortTimeframes([...current, value]));
  };

  const unpin = (value: TimeframeOption) => {
    setDraft((current) => {
      if (current.length <= 1) return current;
      return current.filter((item) => item !== value);
    });
  };

  const saveEdit = () => {
    const next = savePinnedTimeframes(draft);
    setPinned(next);
    setDraft(next);
    setEditing(false);
  };

  useEffect(() => () => cancelClose(), []);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".tf-menu")) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu, pinned]);

  return (
    <div ref={rootRef} className={`tf ${menu ? "is-open" : ""}`}>
      {barItems.map((value) => (
        <Button
          key={value}
          type="text"
          className={timeframe === value ? "is-active" : undefined}
          onClick={() => select(value)}
        >
          {formatTimeframe(value)}
        </Button>
      ))}
      <button
        type="button"
        className={`tf-caret ${menu ? "is-open" : ""}`}
        title="Таймфреймы"
        aria-label="Открыть список таймфреймов"
        aria-expanded={menu != null}
        onMouseEnter={openMenu}
        onMouseLeave={scheduleClose}
        onClick={() => (menu ? closeMenu() : openMenu())}
      >
        <ChevronDown size={14} />
      </button>
      {menu &&
        createPortal(
          <div
            className={`tf-menu ${editing ? "is-editing" : ""}`}
            style={{ top: menu.top, left: menu.left }}
            role="dialog"
            aria-label="Таймфреймы"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <section className="tf-menu__section">
              <div className="tf-menu__header">
                <span>Закреплено</span>
                <button
                  type="button"
                  className="tf-menu__edit"
                  onClick={() => {
                    if (editing) saveEdit();
                    else {
                      setDraft(pinned);
                      setEditing(true);
                    }
                  }}
                >
                  {editing ? "Сохранить" : "Редактировать"}
                </button>
              </div>
              <div className="tf-menu__chips">
                {visiblePins.map((value) => (
                  <TimeframeChip
                    key={value}
                    value={value}
                    active={timeframe === value}
                    badge={editing ? "minus" : null}
                    badgeDisabled={editing && visiblePins.length <= 1}
                    onSelect={select}
                    onBadge={() => unpin(value)}
                  />
                ))}
              </div>
            </section>
            <section className="tf-menu__section">
              <div className="tf-menu__header">Доступно</div>
              <div className="tf-menu__chips">
                {availableTimeframes(visiblePins).map((value) => (
                  <TimeframeChip
                    key={value}
                    value={value}
                    active={timeframe === value}
                    badge={editing ? "plus" : null}
                    onSelect={select}
                    onBadge={() => pin(value)}
                  />
                ))}
              </div>
            </section>
            <section className="tf-menu__section is-disabled" aria-disabled="true">
              <div className="tf-menu__header">Настраиваемые интервалы</div>
              <p className="tf-menu__hint">Пока недоступны</p>
            </section>
          </div>,
          document.body,
        )}
    </div>
  );
}

function TimeframeChip({
  value,
  active,
  badge,
  badgeDisabled = false,
  onSelect,
  onBadge,
}: {
  value: number;
  active: boolean;
  badge: "plus" | "minus" | null;
  badgeDisabled?: boolean;
  onSelect: (value: number) => void;
  onBadge: () => void;
}) {
  return (
    <div className="tf-menu__chip-wrap">
      <button
        type="button"
        className={`tf-menu__chip ${active ? "is-active" : ""}`}
        onClick={() => onSelect(value)}
      >
        {formatTimeframe(value)}
      </button>
      {badge ? (
        <button
          type="button"
          className={`tf-menu__badge tf-menu__badge--${badge}`}
          disabled={badgeDisabled}
          title={
            badge === "plus"
              ? "Закрепить"
              : badgeDisabled
                ? "Нужен хотя бы один закреплённый"
                : "Открепить"
          }
          aria-label={badge === "plus" ? `Закрепить ${formatTimeframe(value)}` : `Открепить ${formatTimeframe(value)}`}
          onClick={(event) => {
            event.stopPropagation();
            if (!badgeDisabled) onBadge();
          }}
        >
          {badge === "plus" ? "+" : "−"}
        </button>
      ) : null}
    </div>
  );
}
