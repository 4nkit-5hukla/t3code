import { useSyncExternalStore } from "react";

export const COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS =
  "[[data-sidebar-state=collapsed]_&]:pl-[var(--workspace-titlebar-content-left)] max-md:[[data-sidebar-state=expanded]_&]:pl-[var(--workspace-titlebar-content-left)]";

export function isDetachedWindow(): boolean {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get("detached") === "true" ||
    window.location.hash.includes("detached=true")
  );
}

let isDetachedWindowOpenState = false;
const detachedWindowSubscribers = new Set<() => void>();

function notifyDetachedWindowSubscribers() {
  for (const subscriber of detachedWindowSubscribers) {
    subscriber();
  }
}

interface DetachedSyncHistory {
  readonly location: { readonly pathname: string };
  subscribe: (listener: () => void) => () => void;
  push: (path: string) => void;
}

type DetachedWindowMessage =
  | { readonly type: "main-route"; readonly pathname: string }
  | { readonly type: "request-route" };

const DETACHED_WINDOW_CHANNEL = "t3code:detached-window";
// Routes without a thread panel; the detached window stays on its thread while the main shows these.
const NON_THREAD_ROUTE_SEGMENTS = new Set([
  "",
  "settings",
  "usage",
  "issues",
  "pull-requests",
  "new",
  "connect",
  "connect-agent",
  "approve-agent",
]);

function isThreadRoute(pathname: string): boolean {
  return !NON_THREAD_ROUTE_SEGMENTS.has(pathname.split("/")[1] ?? "");
}

/** Keeps the detached panel window on the thread the main window shows. Returns a disposer. */
export function syncDetachedWindowRoute(
  history: DetachedSyncHistory,
  detached: boolean,
): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(DETACHED_WINDOW_CHANNEL);
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel is same-origin and takes no target
  const post = (message: DetachedWindowMessage) => channel.postMessage(message);

  if (detached) {
    channel.addEventListener("message", (event: MessageEvent<DetachedWindowMessage>) => {
      const message = event.data;
      if (message?.type !== "main-route" || !isThreadRoute(message.pathname)) return;
      if (message.pathname === history.location.pathname) return;
      history.push(`${message.pathname}?detached=true`);
    });
    post({ type: "request-route" });
    return () => channel.close();
  }

  let lastPathname = history.location.pathname;
  const announce = () => post({ type: "main-route", pathname: history.location.pathname });
  const unsubscribe = history.subscribe(() => {
    if (history.location.pathname === lastPathname) return;
    lastPathname = history.location.pathname;
    announce();
  });
  channel.addEventListener("message", (event: MessageEvent<DetachedWindowMessage>) => {
    if (event.data?.type === "request-route") announce();
  });
  return () => {
    unsubscribe();
    channel.close();
  };
}

export function initDetachedWindowSync(history: DetachedSyncHistory): void {
  if (typeof window === "undefined" || !window.desktopBridge) return;
  syncDetachedWindowRoute(history, isDetachedWindow());

  if (window.desktopBridge.getDetachedWindowState) {
    void window.desktopBridge.getDetachedWindowState().then((isOpen) => {
      if (isDetachedWindowOpenState !== isOpen) {
        isDetachedWindowOpenState = isOpen;
        notifyDetachedWindowSubscribers();
      }
    });
  }

  if (window.desktopBridge.onDetachedWindowStateChanged) {
    window.desktopBridge.onDetachedWindowStateChanged((isOpen) => {
      if (isDetachedWindowOpenState !== isOpen) {
        isDetachedWindowOpenState = isOpen;
        notifyDetachedWindowSubscribers();
      }
    });
  }
}

export function useIsDetachedWindowOpen(): boolean {
  return useSyncExternalStore(
    (callback) => {
      detachedWindowSubscribers.add(callback);
      return () => {
        detachedWindowSubscribers.delete(callback);
      };
    },
    () => isDetachedWindowOpenState,
    () => false,
  );
}
