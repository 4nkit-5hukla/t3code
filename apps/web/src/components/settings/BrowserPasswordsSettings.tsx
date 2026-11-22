import type { BrowserPasswordEntry } from "@t3tools/contracts";
import {
  normalizeBrowserPasswordSite,
  parseBrowserPasswordSite,
} from "@t3tools/shared/browserPasswordSites";
import { EyeIcon, EyeOffIcon, KeyRoundIcon, MoreVertical, Plus as PlusIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const passwordsBridge =
  typeof window === "undefined" ? null : window.desktopBridge?.browserPasswords;

interface Draft {
  readonly id?: string;
  readonly site: string;
  readonly username: string;
  readonly password: string;
}

const EMPTY_DRAFT: Draft = { site: "", username: "", password: "" };

function bySite(left: BrowserPasswordEntry, right: BrowserPasswordEntry) {
  return left.site.localeCompare(right.site) || left.username.localeCompare(right.username);
}

/** Logins the in-app browser fills, saved on this device and encrypted with the OS keychain. */
export function BrowserPasswordsSetting({ disabled }: { readonly disabled: boolean }) {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const [entries, setEntries] = useState<ReadonlyArray<BrowserPasswordEntry> | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingRemoval, setPendingRemoval] = useState<BrowserPasswordEntry | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the desktop vault once when the settings page mounts
  useEffect(() => {
    if (!passwordsBridge) return;
    let cancelled = false;
    void passwordsBridge
      .list()
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch(() => {
        if (cancelled) return;
        setEntries([]);
        toastManager.add({ type: "error", title: gt("Could not read saved passwords") });
      });
    return () => {
      cancelled = true;
    };
  }, [gt]);

  const save = async (next: Draft) => {
    if (!passwordsBridge || saving) return;
    setSaving(true);
    try {
      const saved = await passwordsBridge.save({
        ...(next.id ? { id: next.id } : {}),
        site: next.site,
        username: next.username,
        password: next.password,
      });
      setEntries((current) => [...(current ?? []).filter((entry) => entry.id !== saved.id), saved]);
      setDraft(null);
    } catch {
      toastManager.add({
        type: "error",
        title: gt("Could not save the password"),
        description: gt("The system keychain must be available to store passwords."),
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: BrowserPasswordEntry) => {
    if (!passwordsBridge) return;
    try {
      await passwordsBridge.remove(entry.id);
      setEntries((current) => (current ?? []).filter((candidate) => candidate.id !== entry.id));
    } catch {
      toastManager.add({ type: "error", title: gt("Could not delete the password") });
    }
    setPendingRemoval(null);
  };

  const toggleReveal = (id: string) =>
    setRevealedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const writesDisabled = disabled || !passwordsBridge || entries === null;
  const sorted = [...(entries ?? [])].toSorted(bySite);

  return (
    <SettingsRow
      {...searchableSetting("browser-passwords")}
      devicePreference
      description={gt(
        "The in-app browser fills these logins. A domain also fills its subdomains; a localhost entry with a port fills only that port.",
      )}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={writesDisabled}
          onClick={() => setDraft(EMPTY_DRAFT)}
        >
          <PlusIcon />
          <T>Add password</T>
        </Button>
      }
    >
      {sorted.length > 0 ? (
        <div className="mt-2 mb-2 overflow-hidden rounded-lg border border-border/60">
          {sorted.map((entry, index) => {
            const revealed = revealedIds.has(entry.id);
            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2",
                  index > 0 && "border-t border-border/60",
                )}
              >
                <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">{entry.site}</div>
                  <div className="truncate text-muted-foreground text-xs">
                    {entry.username || gt("No username")}
                  </div>
                </div>
                <span className="max-w-40 truncate font-mono text-muted-foreground text-xs">
                  {revealed ? entry.password : "••••••••"}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={revealed ? gt("Hide password") : gt("Show password")}
                  onClick={() => toggleReveal(entry.id)}
                >
                  {revealed ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        size="icon-xs"
                        variant="ghost-muted"
                        disabled={writesDisabled}
                        aria-label={gt("{site} options", { site: entry.site })}
                      />
                    }
                  >
                    <MoreVertical />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <MenuItem
                      onClick={() =>
                        setDraft({
                          id: entry.id,
                          site: entry.site,
                          username: entry.username,
                          password: entry.password,
                        })
                      }
                    >
                      <T>Edit</T>
                    </MenuItem>
                    <MenuItem onClick={() => void navigator.clipboard?.writeText(entry.password)}>
                      <T>Copy password</T>
                    </MenuItem>
                    <MenuItem variant="destructive" onClick={() => setPendingRemoval(entry)}>
                      <T>Delete</T>
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              </div>
            );
          })}
        </div>
      ) : null}
      {draft ? (
        <BrowserPasswordDialog
          draft={draft}
          busy={saving}
          onClose={() => setDraft(null)}
          onSave={(next) => void save(next)}
        />
      ) : null}
      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {gt("Delete the password for {site}?", { site: pendingRemoval?.site ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>The in-app browser will stop filling this login.</T>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingRemoval) void remove(pendingRemoval);
              }}
            >
              <T>Delete</T>
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsRow>
  );
}

function BrowserPasswordDialog(props: {
  readonly draft: Draft;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSave: (draft: Draft) => void;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState(props.draft);
  const [showPassword, setShowPassword] = useState(false);
  const site = parseBrowserPasswordSite(draft.site);
  const normalizedSite = normalizeBrowserPasswordSite(draft.site);
  const valid = normalizedSite !== null && draft.password !== "";
  const siteHint =
    draft.site.trim() === ""
      ? gt("A domain such as github.com, or localhost:3000 for a local dev server.")
      : site === null
        ? gt("Enter a domain or a localhost address.")
        : site.host === "localhost"
          ? site.port === null
            ? gt("Fills localhost pages on every port.")
            : gt("Fills localhost pages on port {port} only.", { port: site.port })
          : gt("Fills {host} and its subdomains.", { host: site.host });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose();
      }}
    >
      <DialogPopup showCloseButton={!props.busy}>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !props.busy) props.onSave(draft);
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.draft.id ? gt("Edit password") : gt("Add password")}</DialogTitle>
            <DialogDescription>
              <T>Saved on this device and encrypted with the system keychain.</T>
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <label className="block space-y-1.5 text-sm">
                <span>
                  <T>Site</T>
                </span>
                <Input
                  autoFocus
                  required
                  spellCheck={false}
                  placeholder="github.com"
                  value={draft.site}
                  disabled={props.busy}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((current) => ({ ...current, site: value }));
                  }}
                />
                <span
                  className={cn(
                    "block text-xs",
                    draft.site.trim() !== "" && site === null
                      ? "text-destructive-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {siteHint}
                </span>
              </label>
              <label className="block space-y-1.5 text-sm">
                <span>
                  <T>Email or username</T>
                </span>
                <Input
                  spellCheck={false}
                  autoComplete="off"
                  value={draft.username}
                  disabled={props.busy}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((current) => ({ ...current, username: value }));
                  }}
                />
              </label>
              <div className="space-y-1.5 text-sm">
                <label htmlFor="browser-password-input" className="block">
                  <T>Password</T>
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="browser-password-input"
                    className="min-w-0 flex-1"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={draft.password}
                    disabled={props.busy}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft((current) => ({ ...current, password: value }));
                    }}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={showPassword ? gt("Hide password") : gt("Show password")}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                </div>
              </div>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={props.busy} onClick={props.onClose}>
              <T>Cancel</T>
            </Button>
            <Button type="submit" disabled={props.busy || !valid}>
              <T>Save</T>
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
