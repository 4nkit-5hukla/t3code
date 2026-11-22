/**
 * The account list under a login field, like Chrome's. It lives in a closed shadow root so page
 * styles and scripts cannot restyle or read it, and it only ever shows usernames.
 */

const PICKER_ATTRIBUTE = "data-t3code-password-picker";
const Z_INDEX = 2147483647;
const GAP_PX = 4;
const KEY_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>';

const STYLES = `
:host { all: initial; }
.list {
  position: fixed; z-index: ${Z_INDEX}; box-sizing: border-box; max-height: 280px; overflow-y: auto;
  margin: 0; padding: 4px; list-style: none; border-radius: 8px;
  font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #1f1f1f; background: #fff; border: 1px solid rgb(0 0 0 / 12%);
  box-shadow: 0 6px 24px rgb(0 0 0 / 18%);
}
.item {
  display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 6px;
  cursor: default; user-select: none;
}
.item[aria-selected="true"] { background: rgb(0 0 0 / 7%); }
.icon { display: flex; flex: none; color: #5f6368; }
.text { display: flex; min-width: 0; flex-direction: column; }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mask { color: #5f6368; font-size: 11px; letter-spacing: 1px; }
@media (prefers-color-scheme: dark) {
  .list { color: #e8eaed; background: #2b2c2f; border-color: rgb(255 255 255 / 12%); }
  .item[aria-selected="true"] { background: rgb(255 255 255 / 10%); }
  .icon, .mask { color: #9aa0a6; }
}
`;

// Captured before page scripts run, so a page cannot open the shadow root by patching it.
const attachShadow = Element.prototype.attachShadow;

interface OpenPicker {
  readonly anchor: HTMLInputElement;
  readonly host: HTMLElement;
  readonly list: HTMLUListElement;
  readonly onPick: (index: number) => void;
  readonly count: number;
  highlight: number;
}

let open: OpenPicker | null = null;

export function isPickerHost(node: Node): boolean {
  return node instanceof Element && node.hasAttribute(PICKER_ATTRIBUTE);
}

export function pickerAnchor(): HTMLInputElement | null {
  return open?.anchor ?? null;
}

function position(picker: OpenPicker) {
  const rect = picker.anchor.getBoundingClientRect();
  const { list } = picker;
  list.style.left = `${Math.max(GAP_PX, rect.left)}px`;
  list.style.minWidth = `${Math.max(rect.width, 220)}px`;
  const below = window.innerHeight - rect.bottom;
  const height = list.offsetHeight;
  if (below < height + GAP_PX && rect.top > below) {
    list.style.top = `${Math.max(GAP_PX, rect.top - height - GAP_PX)}px`;
  } else {
    list.style.top = `${rect.bottom + GAP_PX}px`;
  }
}

function setHighlight(picker: OpenPicker, index: number) {
  picker.highlight = index;
  picker.list.querySelectorAll<HTMLElement>(".item").forEach((item, itemIndex) => {
    item.setAttribute("aria-selected", itemIndex === index ? "true" : "false");
    if (itemIndex === index) item.scrollIntoView({ block: "nearest" });
  });
}

export function hidePicker() {
  open?.host.remove();
  open = null;
}

export function showPicker(
  anchor: HTMLInputElement,
  usernames: ReadonlyArray<string>,
  emptyLabel: string,
  onPick: (index: number) => void,
) {
  hidePicker();
  if (usernames.length === 0) return;
  const host = document.createElement("div");
  host.setAttribute(PICKER_ATTRIBUTE, "");
  const root = attachShadow.call(host, { mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLES;
  const list = document.createElement("ul");
  list.className = "list";
  list.setAttribute("role", "listbox");
  usernames.forEach((username, index) => {
    const item = document.createElement("li");
    item.className = "item";
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.innerHTML = KEY_ICON;
    const text = document.createElement("span");
    text.className = "text";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = username === "" ? emptyLabel : username;
    const mask = document.createElement("span");
    mask.className = "mask";
    mask.textContent = "••••••••";
    text.append(name, mask);
    item.append(icon, text);
    item.addEventListener("mouseenter", () => {
      if (open) setHighlight(open, index);
    });
    item.addEventListener("click", () => onPick(index));
    list.append(item);
  });
  root.append(style, list);
  // Keep focus in the field, and keep the page's own outside-click handlers from seeing the press.
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"] as const) {
    host.addEventListener(type, (event) => {
      if (type === "pointerdown" || type === "mousedown") event.preventDefault();
      event.stopPropagation();
    });
  }
  document.documentElement.append(host);
  open = { anchor, host, list, onPick, count: usernames.length, highlight: -1 };
  position(open);
}

export function repositionPicker() {
  if (!open) return;
  if (!open.anchor.isConnected) return hidePicker();
  position(open);
}

/** Handles a key pressed in the anchor field; returns whether the picker consumed it. */
export function handlePickerKey(event: KeyboardEvent): boolean {
  if (!open) return false;
  switch (event.key) {
    case "ArrowDown":
      setHighlight(open, (open.highlight + 1) % open.count);
      return true;
    case "ArrowUp":
      setHighlight(open, open.highlight <= 0 ? open.count - 1 : open.highlight - 1);
      return true;
    case "Enter":
      if (open.highlight === -1) return false;
      open.onPick(open.highlight);
      return true;
    case "Escape":
      hidePicker();
      return true;
    default:
      return false;
  }
}
