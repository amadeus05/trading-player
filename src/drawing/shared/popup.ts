export function mountAnchoredPopup(options: {
  container: HTMLElement;
  anchor: Element;
  popup: HTMLElement;
  width: number;
  gap?: number;
  margin?: number;
  onDismiss?: () => void;
}): () => void {
  const { container, anchor, popup, width } = options;
  const gap = options.gap ?? 6;
  const margin = options.margin ?? 4;
  const anchorBounds = anchor.getBoundingClientRect();
  const containerBounds = container.getBoundingClientRect();
  let left = anchorBounds.left - containerBounds.left;
  left = Math.max(margin, Math.min(left, containerBounds.width - width - margin));
  popup.style.left = `${left}px`;
  popup.style.top = `${anchorBounds.bottom - containerBounds.top + gap}px`;
  popup.addEventListener("pointerdown", stopPropagation);
  container.appendChild(popup);

  let disposed = false;
  const onOutsidePointerDown = (event: PointerEvent) => {
    const target = event.target as Node;
    if (!popup.contains(target) && !anchor.contains(target)) dispose();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener("pointerdown", onOutsidePointerDown);
    popup.removeEventListener("pointerdown", stopPropagation);
    popup.remove();
    options.onDismiss?.();
  };
  setTimeout(() => {
    if (!disposed) document.addEventListener("pointerdown", onOutsidePointerDown);
  }, 0);
  return dispose;
}

function stopPropagation(event: Event): void {
  event.stopPropagation();
}
