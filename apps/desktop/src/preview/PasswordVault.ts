import {
  BrowserPasswordEntry,
  type BrowserPasswordAutofillCredential,
  type BrowserPasswordSaveInput,
} from "@t3tools/contracts";
import {
  browserPasswordSiteMatchesOrigin,
  isBrowserPasswordAutofillOrigin,
  normalizeBrowserPasswordSite,
} from "@t3tools/shared/browserPasswordSites";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import { PASSWORD_AUTOFILL_LOOKUP_CHANNEL } from "./GuestProtocol.ts";

const PasswordVaultDocument = Schema.Struct({
  version: Schema.Literal(1),
  /** Base64 of the safeStorage-encrypted JSON entry list. */
  encryptedEntries: Schema.String,
});
const decodeDocumentJson = Schema.decodeEffect(Schema.fromJsonString(PasswordVaultDocument));
const encodeDocumentJson = Schema.encodeEffect(Schema.fromJsonString(PasswordVaultDocument));
const PasswordEntries = Schema.Array(BrowserPasswordEntry);
const decodeEntriesJson = Schema.decodeEffect(Schema.fromJsonString(PasswordEntries));
const encodeEntriesJson = Schema.encodeEffect(Schema.fromJsonString(PasswordEntries));

export class PreviewPasswordVaultError extends Schema.TaggedError<PreviewPasswordVaultError>()(
  "PreviewPasswordVaultError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Saved browser passwords failed during ${this.operation}.`;
  }
}

export class PreviewPasswordVault extends Context.Service<
  PreviewPasswordVault,
  {
    readonly list: Effect.Effect<ReadonlyArray<BrowserPasswordEntry>, PreviewPasswordVaultError>;
    readonly save: (
      input: BrowserPasswordSaveInput,
    ) => Effect.Effect<BrowserPasswordEntry, PreviewPasswordVaultError>;
    readonly remove: (id: string) => Effect.Effect<void, PreviewPasswordVaultError>;
    /** Logins whose site matches a page origin; empty for origins autofill must not reach. */
    readonly lookup: (
      origin: string,
    ) => Effect.Effect<ReadonlyArray<BrowserPasswordAutofillCredential>, PreviewPasswordVaultError>;
  }
>()("@t3tools/desktop/preview/PasswordVault/PreviewPasswordVault") {}

const failWith = (operation: string) => (cause: unknown) =>
  new PreviewPasswordVaultError({ operation, cause });

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const random = yield* SecureRandom.SecureRandom;
  const vaultPath = path.join(environment.stateDir, "browser-passwords.json");
  const gate = yield* Semaphore.make(1);
  let cache: ReadonlyArray<BrowserPasswordEntry> | undefined;

  const readEntries = Effect.gen(function* () {
    if (cache !== undefined) return cache;
    const raw = yield* fileSystem
      .readFileString(vaultPath)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed<string | null>(null)
            : Effect.fail(failWith("read")(error)),
        ),
      );
    if (raw === null) {
      cache = [];
      return cache;
    }
    const document = yield* decodeDocumentJson(raw).pipe(Effect.mapError(failWith("decode")));
    const encrypted = yield* Effect.fromResult(Base64.decode(document.encryptedEntries)).pipe(
      Effect.mapError(failWith("decode")),
    );
    const json = yield* safeStorage
      .decryptString(encrypted)
      .pipe(Effect.mapError(failWith("decrypt")));
    cache = yield* decodeEntriesJson(json).pipe(Effect.mapError(failWith("decode")));
    return cache;
  });

  const writeEntries = Effect.fn("PreviewPasswordVault.writeEntries")(function* (
    entries: ReadonlyArray<BrowserPasswordEntry>,
  ) {
    const available = yield* safeStorage.isEncryptionAvailable.pipe(
      Effect.mapError(failWith("check-encryption")),
    );
    // Never write passwords in the clear when the keychain is unavailable.
    if (!available) return yield* new PreviewPasswordVaultError({ operation: "encrypt" });
    const json = yield* encodeEntriesJson(entries).pipe(Effect.mapError(failWith("encode")));
    const encrypted = yield* safeStorage
      .encryptString(json)
      .pipe(Effect.mapError(failWith("encrypt")));
    const document = yield* encodeDocumentJson({
      version: 1,
      encryptedEntries: Base64.encode(encrypted),
    }).pipe(Effect.mapError(failWith("encode")));
    const suffix = (yield* random.uuidV4()).replace(/-/g, "");
    const tempPath = `${vaultPath}.${suffix}.tmp`;
    yield* fileSystem
      .makeDirectory(path.dirname(vaultPath), { recursive: true })
      .pipe(Effect.mapError(failWith("write")));
    yield* fileSystem
      .writeFileString(tempPath, `${document}\n`, { mode: 0o600 })
      .pipe(Effect.mapError(failWith("write")));
    yield* fileSystem.rename(tempPath, vaultPath).pipe(Effect.mapError(failWith("write")));
    cache = entries;
  });

  const list = gate.withPermits(1)(readEntries);

  const save = Effect.fn("PreviewPasswordVault.save")(function* (input: BrowserPasswordSaveInput) {
    const site = normalizeBrowserPasswordSite(input.site);
    if (site === null) return yield* new PreviewPasswordVaultError({ operation: "validate-site" });
    if (input.password === "") {
      return yield* new PreviewPasswordVaultError({ operation: "validate-password" });
    }
    return yield* gate.withPermits(1)(
      Effect.gen(function* () {
        const entries = yield* readEntries;
        const updatedAt = DateTime.formatIso(yield* DateTime.now);
        const id = input.id ?? (yield* random.uuidV4());
        const entry: BrowserPasswordEntry = {
          id,
          site,
          username: input.username.trim(),
          password: input.password,
          updatedAt,
        };
        const exists = entries.some((candidate) => candidate.id === id);
        yield* writeEntries(
          exists
            ? entries.map((candidate) => (candidate.id === id ? entry : candidate))
            : [...entries, entry],
        );
        return entry;
      }),
    );
  });

  const remove = Effect.fn("PreviewPasswordVault.remove")(function* (id: string) {
    yield* gate.withPermits(1)(
      Effect.gen(function* () {
        const entries = yield* readEntries;
        if (!entries.some((entry) => entry.id === id)) return;
        yield* writeEntries(entries.filter((entry) => entry.id !== id));
      }),
    );
  });

  const lookup = Effect.fn("PreviewPasswordVault.lookup")(function* (origin: string) {
    if (!isBrowserPasswordAutofillOrigin(origin)) return [];
    const entries = yield* list;
    return entries
      .filter((entry) => browserPasswordSiteMatchesOrigin(entry.site, origin))
      .map(({ username, password }) => ({ username, password }));
  });

  // Browser pages ask through the preview preload. Only a <webview> guest's main frame may ask,
  // and the frame's committed origin, not anything the page sends, picks the logins.
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      ipcMain.removeHandler(PASSWORD_AUTOFILL_LOOKUP_CHANNEL);
      ipcMain.handle(PASSWORD_AUTOFILL_LOOKUP_CHANNEL, (event: IpcMainInvokeEvent) => {
        const frame = event.senderFrame;
        if (event.sender.getType() !== "webview" || !frame || frame !== event.sender.mainFrame) {
          return [];
        }
        return runPromise(lookup(frame.origin).pipe(Effect.orElseSucceed(() => [])));
      });
    }),
    () => Effect.sync(() => ipcMain.removeHandler(PASSWORD_AUTOFILL_LOOKUP_CHANNEL)),
  );

  return PreviewPasswordVault.of({ list, save, remove, lookup });
}).pipe(Effect.withSpan("PreviewPasswordVault.make"));

export const layer = Layer.effect(PreviewPasswordVault, make);
