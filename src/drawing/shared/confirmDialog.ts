const CLOSE_ICON = `<svg viewBox="0 0 28 28" width="22" height="22" aria-hidden="true"><path d="m7.5 7.5 13 13m0-13-13 13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

export function openConfirmDialog(options: {
  container: HTMLElement;
  title?: string;
  message: string;
  cancelText?: string;
  confirmText?: string;
  onConfirm: () => void;
}): () => void {
  const {
    container,
    title = "Подтверждение",
    message,
    cancelText = "Нет",
    confirmText = "Да",
    onConfirm,
  } = options;

  const overlay = document.createElement("div");
  overlay.className = "drawing-confirm-overlay";

  const dialog = document.createElement("div");
  dialog.className = "drawing-confirm-dialog";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", title);

  const header = document.createElement("div");
  header.className = "drawing-confirm-header";

  const titleEl = document.createElement("div");
  titleEl.className = "drawing-confirm-title";
  titleEl.textContent = title;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "drawing-confirm-close";
  closeBtn.title = "Закрыть";
  closeBtn.innerHTML = CLOSE_ICON;

  header.append(titleEl, closeBtn);

  const body = document.createElement("div");
  body.className = "drawing-confirm-body";
  body.textContent = message;

  const actions = document.createElement("div");
  actions.className = "drawing-confirm-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "drawing-confirm-btn drawing-confirm-btn-cancel";
  cancelBtn.textContent = cancelText;

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "drawing-confirm-btn drawing-confirm-btn-confirm";
  confirmBtn.textContent = confirmText;

  actions.append(cancelBtn, confirmBtn);
  dialog.append(header, body, actions);
  overlay.appendChild(dialog);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dispose();
    }
  };

  overlay.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (event.target === overlay) dispose();
  });
  dialog.addEventListener("pointerdown", (event) => event.stopPropagation());
  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    dispose();
  });
  cancelBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    dispose();
  });
  confirmBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    dispose();
    onConfirm();
  });

  container.appendChild(overlay);
  document.addEventListener("keydown", onKeyDown, true);
  confirmBtn.focus();
  return dispose;
}
