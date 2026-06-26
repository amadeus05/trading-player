export interface InlineTextEditorOptions {
  container: HTMLElement;
  x: number;
  y: number;
  color: string;
  activeColor?: string;
  value?: string;
  placeholder?: string;
  placeholderAsContent?: boolean;
  rotation?: number;
  width?: number;
  height?: number;
  textAlign?: "left" | "center" | "right";
  /** `box` — x/y это левый верхний угол (как getBoundingClientRect). */
  positionMode?: "center" | "box";
  onInput?: (value: string) => void;
  onCommit: (value: string) => void;
  onDismiss?: () => void;
}

export function openInlineTextEditor(options: InlineTextEditorOptions): () => void {
  const placeholder = options.placeholder ?? "+ Add text";
  const editor = document.createElement("div");
  editor.className = "drawing-inline-text-editor";
  editor.contentEditable = "true";
  editor.spellcheck = false;
  editor.dataset.placeholder = placeholder;
  editor.style.left = `${options.x}px`;
  editor.style.top = `${options.y}px`;
  editor.style.color = options.color;
  if (options.textAlign) editor.style.textAlign = options.textAlign;
  if (options.width) {
    editor.style.width = `${options.width}px`;
    editor.style.minWidth = `${options.width}px`;
  }
  if (options.height) {
    editor.style.height = `${options.height}px`;
    editor.style.minHeight = `${options.height}px`;
  }
  const rotation = options.rotation ?? 0;
  const positionMode = options.positionMode ?? "center";
  if (rotation !== 0) editor.classList.add("drawing-inline-text-editor--line");
  editor.style.transformOrigin = "center center";
  if (positionMode === "box") {
    editor.style.transform = rotation !== 0 ? `rotate(${rotation}deg)` : "none";
  } else {
    editor.style.transform = rotation !== 0
      ? `translate(-50%, -50%) rotate(${rotation}deg)`
      : "translate(-50%, -50%)";
  }

  const hasValue = Boolean(options.value?.trim());
  if (hasValue) {
    editor.textContent = options.value!;
  } else if (options.placeholderAsContent) {
    editor.textContent = placeholder;
    editor.classList.add("is-placeholder");
  }

  options.container.appendChild(editor);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    editor.remove();
  };

  const normalizedValue = () => {
    const raw = editor.textContent ?? "";
    if (editor.classList.contains("is-placeholder") || raw.trim() === placeholder.trim()) return "";
    return raw;
  };

  const commit = () => {
    if (disposed) return;
    const value = normalizedValue();
    dispose();
    options.onCommit(value);
  };

  editor.addEventListener("pointerdown", (event) => event.stopPropagation());
  editor.addEventListener("focus", () => {
    if (!editor.classList.contains("is-placeholder")) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  editor.addEventListener("keydown", (event) => {
    if (editor.classList.contains("is-placeholder") && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      editor.textContent = "";
      editor.classList.remove("is-placeholder");
      editor.style.color = options.activeColor ?? options.color;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      dispose();
      options.onDismiss?.();
    }
  });
  editor.addEventListener("input", () => {
    if (editor.classList.contains("is-placeholder")) {
      editor.classList.remove("is-placeholder");
      editor.style.color = options.activeColor ?? options.color;
    }
    options.onInput?.(normalizedValue());
  });
  editor.addEventListener("blur", commit);

  requestAnimationFrame(() => {
    if (disposed) return;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    if (editor.classList.contains("is-placeholder")) range.collapse(true);
    else range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  return () => {
    dispose();
    options.onDismiss?.();
  };
}
