export function mountAnchoredPopup(options: {
  container: HTMLElement;
  anchor: Element;
  horizontalAnchor?: Element;
  verticalAnchor?: Element;
  popup: HTMLElement;
  width?: number;
  minWidth?: number;
  /** Ширина по содержимому (как меню шаблонов в TradingView). */
  fitContent?: boolean;
  gap?: number;
  margin?: number;
  /** Открыть над якорем, если хватает места (меню Template в футере настроек). */
  preferAbove?: boolean;
  onDismiss?: () => void;
}): () => void {
  const { container, anchor, popup } = options;
  const horizontalAnchor = options.horizontalAnchor ?? anchor;
  const verticalAnchor = options.verticalAnchor ?? anchor;
  const gap = options.gap ?? 6;
  const margin = options.margin ?? 4;
  const minWidth = options.minWidth ?? options.width ?? 160;
  const horizontalBounds = horizontalAnchor.getBoundingClientRect();
  const verticalBounds = verticalAnchor.getBoundingClientRect();
  const containerBounds = container.getBoundingClientRect();

  popup.style.minWidth = `${minWidth}px`;
  if (options.fitContent) {
    popup.style.width = "max-content";
  } else if (options.width != null) {
    popup.style.width = `${options.width}px`;
  }
  popup.addEventListener("pointerdown", stopPropagation);
  container.appendChild(popup);

  const width = Math.min(
    Math.max(popup.offsetWidth, minWidth),
    Math.max(minWidth, containerBounds.width - margin * 2),
  );
  popup.style.width = `${width}px`;

  let left = horizontalBounds.left - containerBounds.left;
  left = Math.max(margin, Math.min(left, containerBounds.width - width - margin));
  popup.style.left = `${left}px`;

  const height = popup.offsetHeight;
  const spaceBelow = containerBounds.bottom - verticalBounds.bottom - margin;
  const spaceAbove = verticalBounds.top - containerBounds.top - margin;
  const openAbove = options.preferAbove
    ? spaceAbove >= Math.min(height, spaceBelow) || spaceAbove >= spaceBelow
    : spaceBelow < height + gap && spaceAbove > spaceBelow;
  const top = openAbove
    ? verticalBounds.top - containerBounds.top - height - gap
    : verticalBounds.bottom - containerBounds.top + gap;
  popup.style.top = `${Math.max(margin, Math.min(top, containerBounds.height - height - margin))}px`;

  let disposed = false;
  const onOutsidePointerDown = (event: PointerEvent) => {
    const target = event.target as Node;
    // Capture: панели рисунков делают stopPropagation, иначе меню не закрывается
    // при drag/клике по settings.
    if (!popup.contains(target) && !anchor.contains(target)) dispose();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    popup.removeEventListener("pointerdown", stopPropagation);
    popup.remove();
    options.onDismiss?.();
  };
  setTimeout(() => {
    if (!disposed) document.addEventListener("pointerdown", onOutsidePointerDown, true);
  }, 0);
  return dispose;
}

function stopPropagation(event: Event): void {
  event.stopPropagation();
}
