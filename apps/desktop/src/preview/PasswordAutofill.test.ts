import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";

const credentials = vi.hoisted(() => ({
  list: [] as Array<{ username: string; password: string }>,
}));

vi.mock("electron", () => ({
  ipcRenderer: { invoke: async () => credentials.list },
}));

const shadowRoots: ShadowRoot[] = [];

beforeAll(async () => {
  vi.useFakeTimers();
  // jsdom lays nothing out, so every input would look hidden.
  HTMLElement.prototype.getClientRects = () => [new DOMRect(0, 0, 100, 20)] as never;
  HTMLElement.prototype.scrollIntoView ??= () => {};
  // The picker captures attachShadow on import; wrap it first to reach its closed root.
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    const root = attachShadow.call(this, init);
    shadowRoots.push(root);
    return root;
  };
  await import("./PasswordAutofill.ts");
});

afterEach(() => {
  document.body.replaceChildren();
  for (const host of document.querySelectorAll("[data-t3code-password-picker]")) host.remove();
});

// The credential list is looked up once, on the first scan, and carries over between tests.
// Fake timers run the scan's debounce; the lookup and DOM observers settle as microtasks.
async function settle() {
  await vi.advanceTimersByTimeAsync(300);
}

function renderLogin() {
  document.body.innerHTML = `
    <form>
      <input id="email" type="email" autocomplete="username" />
      <input id="password" type="password" autocomplete="current-password" />
    </form>`;
  const email = document.getElementById("email") as HTMLInputElement;
  const password = document.getElementById("password") as HTMLInputElement;
  return { email, password };
}

function pickerItems(): HTMLElement[] {
  const root = shadowRoots.at(-1);
  if (!root?.host.isConnected) return [];
  return [...root.querySelectorAll<HTMLElement>(".item")];
}

it("lists every saved account on focus instead of filling one", async () => {
  credentials.list = [
    { username: "ankit@example.com", password: "first-secret" },
    { username: "team@example.com", password: "second-secret" },
  ];
  const { email, password } = renderLogin();
  await settle();

  expect(email.value).toBe("");
  expect(password.value).toBe("");

  email.focus();
  const items = pickerItems();
  expect(items.map((item) => item.querySelector(".name")?.textContent)).toEqual([
    "ankit@example.com",
    "team@example.com",
  ]);
  expect(items.some((item) => item.textContent?.includes("secret"))).toBe(false);

  items[1]?.click();
  expect(email.value).toBe("team@example.com");
  expect(password.value).toBe("second-secret");
  expect(pickerItems()).toEqual([]);
});

it("narrows the list as a username is typed and picks with the keyboard", async () => {
  const { email, password } = renderLogin();
  await settle();

  email.focus();
  email.value = "te";
  email.dispatchEvent(new Event("input", { bubbles: true }));
  expect(pickerItems().map((item) => item.querySelector(".name")?.textContent)).toEqual([
    "team@example.com",
  ]);

  email.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  email.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(email.value).toBe("team@example.com");
  expect(password.value).toBe("second-secret");
});

it("closes on Escape until the field is clicked again", async () => {
  const { email } = renderLogin();
  await settle();

  email.focus();
  expect(pickerItems()).toHaveLength(2);
  email.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(pickerItems()).toEqual([]);

  email.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(pickerItems()).toHaveLength(2);
});
