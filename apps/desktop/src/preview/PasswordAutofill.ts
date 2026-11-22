// @effect-diagnostics globalTimers:off - This isolated Electron preload does not run inside an Effect runtime.
import { ipcRenderer } from "electron";

import { PASSWORD_AUTOFILL_LOOKUP_CHANNEL } from "./GuestProtocol.ts";
import {
  handlePickerKey,
  hidePicker,
  isPickerHost,
  pickerAnchor,
  repositionPicker,
  showPicker,
} from "./PasswordPicker.ts";

interface Credential {
  readonly username: string;
  readonly password: string;
}

/** The fields of one login form; `password` is null on an email-first step. */
interface LoginFields {
  readonly username: HTMLInputElement | null;
  readonly password: HTMLInputElement | null;
}

const SCAN_DELAY_MS = 250;
const USERNAME_HINT = /user|email|e-mail|login|account|identifier/i;
const TEXT_INPUT_TYPES = new Set(["text", "email", "tel", ""]);

// Captured before page scripts run, so a page cannot intercept fills by patching the prototype.
const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
const filled = new WeakSet<HTMLInputElement>();
const loginFieldsByInput = new WeakMap<HTMLInputElement, LoginFields>();
let credentials: Promise<ReadonlyArray<Credential>> | null = null;
let resolvedCredentials: ReadonlyArray<Credential> = [];
// The field whose list the person closed with Escape, until focus leaves it.
let dismissedField: HTMLInputElement | null = null;
// Set while the script writes fields, so its own input events do not reopen the list.
let filling = false;

function lookupCredentials(): Promise<ReadonlyArray<Credential>> {
  credentials ??= ipcRenderer
    .invoke(PASSWORD_AUTOFILL_LOOKUP_CHANNEL)
    .then((result: unknown) =>
      Array.isArray(result)
        ? result.filter(
            (entry): entry is Credential =>
              typeof entry?.username === "string" && typeof entry?.password === "string",
          )
        : [],
    )
    .catch(() => [])
    .then((list) => {
      resolvedCredentials = list;
      return list;
    });
  return credentials;
}

function isFillable(input: HTMLInputElement): boolean {
  return (
    !input.disabled &&
    !input.readOnly &&
    input.getClientRects().length > 0 &&
    getComputedStyle(input).visibility !== "hidden"
  );
}

function isUsernameLike(input: HTMLInputElement): boolean {
  if (!TEXT_INPUT_TYPES.has(input.type.toLowerCase())) return false;
  const autocomplete = input.autocomplete.toLowerCase();
  if (autocomplete.includes("username") || autocomplete.includes("email")) return true;
  if (input.type === "email") return true;
  return USERNAME_HINT.test(`${input.name} ${input.id} ${input.placeholder}`);
}

/** Fills an empty field once; `force` is a person picking an account, which replaces the value. */
function setValue(input: HTMLInputElement, value: string, force = false) {
  if (!valueSetter) return;
  if (!force && (input.value !== "" || filled.has(input))) return;
  filled.add(input);
  // The native setter plus input/change events lets React and similar frameworks see the fill.
  valueSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function inputsIn(scope: ParentNode): HTMLInputElement[] {
  return [...scope.querySelectorAll("input")].filter(isFillable);
}

/** The username field just before a password field, within its form when it has one. */
function usernameFor(password: HTMLInputElement): HTMLInputElement | null {
  const inputs = inputsIn(password.form ?? document);
  const before = inputs.slice(0, inputs.indexOf(password));
  return (
    before.findLast(isUsernameLike) ??
    before.findLast((input) => TEXT_INPUT_TYPES.has(input.type.toLowerCase())) ??
    null
  );
}

function findLoginFields(): LoginFields[] {
  const inputs = inputsIn(document);
  // Sign-up and change-password forms carry new-password or several password fields.
  const passwords = inputs.filter(
    (input) =>
      input.type === "password" &&
      input.autocomplete !== "new-password" &&
      inputsIn(input.form ?? document).filter((other) => other.type === "password").length === 1,
  );
  if (passwords.length > 0) {
    return passwords.map((password) => ({ username: usernameFor(password), password }));
  }
  // A first step that asks only for the email or username, before the password page.
  const usernameOnly = inputs.filter(isUsernameLike);
  return usernameOnly.length === 1 ? [{ username: usernameOnly[0] ?? null, password: null }] : [];
}

/** Accounts to offer in a field: all of them, narrowed by what is typed in a username field. */
function offeredCredentials(field: HTMLInputElement): ReadonlyArray<Credential> {
  const fields = loginFieldsByInput.get(field);
  if (!fields || field !== fields.username) return resolvedCredentials;
  const typed = field.value.trim().toLowerCase();
  // A field already holding a saved account offers them all, so the person can switch.
  if (typed === "" || resolvedCredentials.some((entry) => entry.username.toLowerCase() === typed)) {
    return resolvedCredentials;
  }
  return resolvedCredentials.filter((entry) => entry.username.toLowerCase().startsWith(typed));
}

function fillFrom(fields: LoginFields, credential: Credential, force: boolean) {
  filling = true;
  try {
    if (fields.username && credential.username !== "") {
      setValue(fields.username, credential.username, force);
    }
    if (fields.password) setValue(fields.password, credential.password, force);
  } finally {
    filling = false;
  }
}

function openPickerFor(field: HTMLInputElement) {
  const fields = loginFieldsByInput.get(field);
  if (!fields || field === dismissedField || document.activeElement !== field) return;
  const offered = offeredCredentials(field);
  // One saved login fills on its own; its list only comes back once the field is emptied.
  if (resolvedCredentials.length < 2 && field.value !== "") return hidePicker();
  if (offered.length === 0) return hidePicker();
  showPicker(
    field,
    offered.map((entry) => entry.username),
    "(no username)",
    (index) => {
      const credential = offered[index];
      hidePicker();
      if (credential) fillFrom(fields, credential, true);
    },
  );
}

async function scan() {
  const logins = findLoginFields();
  if (logins.length === 0) return;
  const list = await lookupCredentials();
  if (list.length === 0) return;

  for (const fields of logins) {
    if (fields.username) loginFieldsByInput.set(fields.username, fields);
    if (fields.password) loginFieldsByInput.set(fields.password, fields);
    // With several accounts the person picks one from the list, as in Chrome.
    if (list.length === 1 && list[0]) fillFrom(fields, list[0], false);
  }
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && pickerAnchor() !== active) openPickerFor(active);
}

let scanTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => void scan(), SCAN_DELAY_MS);
}

function trackedField(target: EventTarget | null): HTMLInputElement | null {
  return target instanceof HTMLInputElement && loginFieldsByInput.has(target) ? target : null;
}

function installPickerEvents() {
  window.addEventListener(
    "focusin",
    (event) => {
      const field = trackedField(event.target);
      if (field) openPickerFor(field);
    },
    true,
  );
  window.addEventListener(
    "focusout",
    (event) => {
      if (event.target === pickerAnchor()) hidePicker();
      if (event.target === dismissedField) dismissedField = null;
    },
    true,
  );
  // A click in the focused field reopens a list the person closed, as in Chrome.
  window.addEventListener(
    "pointerdown",
    (event) => {
      const field = trackedField(event.target);
      if (!field || document.activeElement !== field || pickerAnchor() === field) return;
      dismissedField = null;
      openPickerFor(field);
    },
    true,
  );
  window.addEventListener(
    "input",
    (event) => {
      const field = trackedField(event.target);
      if (filling || !field || field !== loginFieldsByInput.get(field)?.username) return;
      openPickerFor(field);
    },
    true,
  );
  // Registered before page scripts, so the list sees arrow keys ahead of the page.
  window.addEventListener(
    "keydown",
    (event) => {
      const field = trackedField(event.target);
      if (!field) return;
      if (pickerAnchor() !== field) {
        if (event.key !== "ArrowDown") return;
        dismissedField = null;
        openPickerFor(field);
        if (pickerAnchor() !== field) return;
      } else {
        if (event.key === "Escape") dismissedField = field;
        if (!handlePickerKey(event)) return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
  window.addEventListener("scroll", repositionPicker, { capture: true, passive: true });
  window.addEventListener("resize", repositionPicker);
}

function install() {
  installPickerEvents();
  scheduleScan();
  // Single-page apps render their login forms after load; the picker's own node is not one.
  new MutationObserver((mutations) => {
    const ownNodesOnly = mutations.every((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].every(isPickerHost),
    );
    if (!ownNodesOnly) scheduleScan();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", install, { once: true });
} else {
  install();
}
