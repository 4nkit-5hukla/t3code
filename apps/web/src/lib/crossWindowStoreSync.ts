interface PersistedStore {
  persist: {
    getOptions: () => { name?: string };
    rehydrate: () => Promise<void> | void;
  };
}

/**
 * Persisted stores read localStorage once, so a second desktop window (the detached right panel)
 * would drift from the first. Re-read the store whenever another window writes its key.
 * Hydration sets state without writing back, so the windows do not echo each other.
 */
export function syncPersistedStoreAcrossWindows(store: PersistedStore): void {
  if (typeof window === "undefined") return;
  const name = store.persist.getOptions().name;
  if (!name) return;
  window.addEventListener("storage", (event) => {
    if (event.key !== name || event.storageArea !== window.localStorage) return;
    void store.persist.rehydrate();
  });
}
