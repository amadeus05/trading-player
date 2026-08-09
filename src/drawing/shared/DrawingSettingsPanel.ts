import { mountFloatingPanel } from "./floatingPanel";

export type DrawingSettingsTabId = "style" | "text" | "coordinates" | "visibility";

export interface DrawingSettingsTab {
  id: DrawingSettingsTabId;
  label: string;
}

export interface DrawingSettingsPanelController {
  panel: HTMLDivElement;
  body: HTMLDivElement;
  setTab: (tabId: DrawingSettingsTabId) => void;
  refresh: () => void;
  destroy: () => void;
}

export interface DrawingSettingsPanelOptions {
  container: HTMLElement;
  title: string;
  persistenceKey: string;
  initialTab?: DrawingSettingsTabId;
  tabs?: DrawingSettingsTab[];
  renderTab?: (tabId: DrawingSettingsTabId, body: HTMLDivElement) => void;
  onTemplateClick?: (anchor: HTMLElement) => void;
  onDragStart?: () => void;
  onCancel?: () => void;
  onOk?: () => void;
  onClose?: () => void;
}

const DEFAULT_TABS: DrawingSettingsTab[] = [
  { id: "style", label: "Style" },
  { id: "text", label: "Text" },
  { id: "coordinates", label: "Coordinates" },
  { id: "visibility", label: "Visibility" },
];

const EDIT_ICON = `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M10.62.72a2.47 2.47 0 0 1 3.5 0l1.16 1.16c.96.97.96 2.54 0 3.5l-.58.58-8.9 8.9-1 1-.14.14H0v-4.65l.14-.15 1-1 8.9-8.9.58-.58Zm2.8.7a1.48 1.48 0 0 0-2.1 0l-.23.23 3.26 3.26.23-.23c.58-.58.58-1.52 0-2.1l-1.16-1.16Zm.23 4.2-3.26-3.27-8.2 8.2 3.25 3.27 8.2-8.2Zm-8.9 8.9-3.27-3.26-.5.5V15h3.27l.5-.5Z"></path></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path d="m7.5 7.5 13 13m0-13-13 13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const CHEVRON_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderPlaceholder(tabId: DrawingSettingsTabId, body: HTMLDivElement) {
  const placeholder = document.createElement("div");
  placeholder.className = "drawing-settings-placeholder";
  placeholder.textContent = `${tabId[0].toUpperCase()}${tabId.slice(1)} settings`;
  body.appendChild(placeholder);
}

export function mountDrawingSettingsPanel(options: DrawingSettingsPanelOptions): DrawingSettingsPanelController {
  const tabs = options.tabs ?? DEFAULT_TABS;
  let activeTab = options.initialTab ?? tabs[0]?.id ?? "style";

  const panel = document.createElement("div");
  panel.className = "drawing-settings-panel vp-panel";
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  panel.addEventListener("click", (event) => event.stopPropagation());

  const header = document.createElement("div");
  header.className = "drawing-settings-header";

  const grip = document.createElement("div");
  grip.className = "drawing-settings-title-wrap";

  const title = document.createElement("div");
  title.className = "drawing-settings-title";
  title.textContent = options.title;

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "drawing-settings-edit";
  edit.title = "Rename";
  edit.innerHTML = EDIT_ICON;
  edit.addEventListener("pointerdown", (event) => event.stopPropagation());

  grip.append(title, edit);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "drawing-settings-close";
  close.title = "Close";
  close.innerHTML = CLOSE_ICON;
  close.addEventListener("pointerdown", (event) => event.stopPropagation());
  close.addEventListener("click", () => {
    options.onClose?.();
  });

  header.append(grip, close);
  panel.appendChild(header);

  const tabList = document.createElement("div");
  tabList.className = "drawing-settings-tabs";
  const tabButtons = new Map<DrawingSettingsTabId, HTMLButtonElement>();

  tabs.forEach((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "drawing-settings-tab";
    button.textContent = tab.label;
    button.addEventListener("click", () => setTab(tab.id));
    tabButtons.set(tab.id, button);
    tabList.appendChild(button);
  });
  panel.appendChild(tabList);

  const body = document.createElement("div");
  body.className = "drawing-settings-body";
  panel.appendChild(body);

  const footer = document.createElement("div");
  footer.className = "drawing-settings-footer";

  const template = document.createElement("button");
  template.type = "button";
  template.className = "drawing-settings-template";
  template.innerHTML = `<span>Template</span>${CHEVRON_ICON}`;
  if (options.onTemplateClick) {
    template.addEventListener("click", (event) => {
      event.stopPropagation();
      options.onTemplateClick?.(template);
    });
  } else {
    template.disabled = true;
    template.title = "Шаблоны недоступны";
  }

  const actions = document.createElement("div");
  actions.className = "drawing-settings-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "drawing-settings-action drawing-settings-action-secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => options.onCancel?.());

  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "drawing-settings-action drawing-settings-action-primary";
  ok.textContent = "Ok";
  ok.addEventListener("click", () => options.onOk?.());

  actions.append(cancel, ok);
  footer.append(template, actions);
  panel.appendChild(footer);

  options.container.appendChild(panel);

  const unmountFloating = mountFloatingPanel({
    container: options.container,
    panel,
    grip: header,
    persistenceKey: options.persistenceKey,
    onDragStart: options.onDragStart,
  });

  function render() {
    body.replaceChildren();
    tabButtons.forEach((button, tabId) => {
      button.classList.toggle("is-active", tabId === activeTab);
    });
    if (options.renderTab) options.renderTab(activeTab, body);
    else renderPlaceholder(activeTab, body);
  }

  function setTab(tabId: DrawingSettingsTabId) {
    activeTab = tabId;
    render();
  }

  render();

  return {
    panel,
    body,
    setTab,
    refresh: render,
    destroy: () => {
      unmountFloating();
      panel.remove();
    },
  };
}
