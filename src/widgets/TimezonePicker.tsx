import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import {
  CHART_TIMEZONE_CITIES,
  CHART_TIMEZONE_EXCHANGE,
  CHART_TIMEZONE_UTC,
  formatChartTimeZoneButtonLabel,
  formatChartTimeZoneMenuLabel,
  resolveChartTimeZoneIana,
  sanitizeChartTimeZone,
} from "../shared/lib/chartTimezones";

interface TimezonePickerProps {
  value: string;
  category?: string;
  onChange: (id: string) => void;
}

export function TimezonePicker({ value, category, onChange }: TimezonePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const id = sanitizeChartTimeZone(value);
  const iana = resolveChartTimeZoneIana(id, category);
  const atUnix = Date.now() / 1_000;
  const specials = useMemo(
    () => [
      { id: CHART_TIMEZONE_UTC, iana: "UTC" },
      { id: CHART_TIMEZONE_EXCHANGE, iana: resolveChartTimeZoneIana(CHART_TIMEZONE_EXCHANGE, category) },
    ],
    [category],
  );

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".tz-menu")) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  const openMenu = () => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenu({ top: rect.bottom + 4, left: rect.left });
  };

  const select = (next: string) => {
    if (next !== id) onChange(next);
    setMenu(null);
  };

  return (
    <div ref={rootRef} className={`tz ${menu ? "is-open" : ""}`}>
      <button
        type="button"
        className={`tz-trigger ${menu ? "is-open" : ""}`}
        title={formatChartTimeZoneMenuLabel(id, iana, atUnix)}
        aria-label="Часовой пояс графика"
        aria-expanded={menu != null}
        onClick={() => (menu ? setMenu(null) : openMenu())}
      >
        <span>{formatChartTimeZoneButtonLabel(id, iana, atUnix)}</span>
        <ChevronDown size={14} />
      </button>
      {menu &&
        createPortal(
          <div className="tz-menu" style={{ top: menu.top, left: menu.left }} role="menu" aria-label="Часовой пояс">
            {specials.map((item) => (
              <TimezoneItem
                key={item.id}
                id={item.id}
                iana={item.iana}
                selected={id}
                atUnix={atUnix}
                onSelect={select}
              />
            ))}
            <div className="tz-menu__sep" />
            {CHART_TIMEZONE_CITIES.map((item) => (
              <TimezoneItem
                key={item.id}
                id={item.id}
                iana={item.iana}
                selected={id}
                atUnix={atUnix}
                onSelect={select}
              />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function TimezoneItem({
  id,
  iana,
  selected,
  atUnix,
  onSelect,
}: {
  id: string;
  iana: string;
  selected: string;
  atUnix: number;
  onSelect: (id: string) => void;
}) {
  const active = selected === id;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={`tz-menu__item ${active ? "is-active" : ""}`}
      onClick={() => onSelect(id)}
    >
      <span className="tz-menu__check">{active ? <Check size={14} strokeWidth={2.4} /> : null}</span>
      <span>{formatChartTimeZoneMenuLabel(id, iana, atUnix)}</span>
    </button>
  );
}
