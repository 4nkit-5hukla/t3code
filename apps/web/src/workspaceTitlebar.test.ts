import { afterEach, describe, expect, it } from "vite-plus/test";

import { syncDetachedWindowRoute } from "./workspaceTitlebar";

function fakeHistory(pathname: string) {
  const listeners = new Set<() => void>();
  const pushes: string[] = [];
  const pushWaiters: Array<(path: string) => void> = [];
  const history = {
    location: { pathname },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push: (path: string) => {
      pushes.push(path);
      history.location = { pathname: path.split("?")[0] ?? path };
      pushWaiters.shift()?.(path);
    },
    navigate: (path: string) => {
      history.location = { pathname: path };
      for (const listener of listeners) listener();
    },
    /** Resolves on the next push; messages arrive in order, so earlier ones were handled first. */
    nextPush: () => new Promise<string>((resolve) => pushWaiters.push(resolve)),
  };
  return { history, pushes };
}

describe("syncDetachedWindowRoute", () => {
  const disposers: Array<() => void> = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it("moves the detached window to the main window's thread", async () => {
    const main = fakeHistory("/env-1/thread-a");
    const detached = fakeHistory("/env-1/thread-a");
    disposers.push(syncDetachedWindowRoute(main.history, false));
    disposers.push(syncDetachedWindowRoute(detached.history, true));

    const pushed = detached.history.nextPush();
    main.history.navigate("/env-2/thread-b");

    expect(await pushed).toBe("/env-2/thread-b?detached=true");
    expect(detached.pushes).toEqual(["/env-2/thread-b?detached=true"]);
  });

  it("catches up to the main window's thread when the detached window opens", async () => {
    const main = fakeHistory("/env-1/thread-b");
    disposers.push(syncDetachedWindowRoute(main.history, false));
    const detached = fakeHistory("/env-1/thread-a");
    const pushed = detached.history.nextPush();
    disposers.push(syncDetachedWindowRoute(detached.history, true));

    expect(await pushed).toBe("/env-1/thread-b?detached=true");
  });

  it("stays on its thread while the main window shows a page without a thread", async () => {
    const main = fakeHistory("/env-1/thread-a");
    const detached = fakeHistory("/env-1/thread-a");
    disposers.push(syncDetachedWindowRoute(main.history, false));
    disposers.push(syncDetachedWindowRoute(detached.history, true));

    const pushed = detached.history.nextPush();
    main.history.navigate("/settings/general");
    main.history.navigate("/env-1/thread-c");

    // The settings route was announced first; only the thread after it moved the window.
    expect(await pushed).toBe("/env-1/thread-c?detached=true");
    expect(detached.pushes).toEqual(["/env-1/thread-c?detached=true"]);
  });
});
