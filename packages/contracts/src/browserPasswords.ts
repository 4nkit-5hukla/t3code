import * as Schema from "effect/Schema";

/** A login the in-app browser fills on pages whose origin matches `site`. */
export const BrowserPasswordEntry = Schema.Struct({
  id: Schema.String,
  /** Canonical site text: a domain, or `localhost[:port]` for loopback pages. */
  site: Schema.String,
  username: Schema.String,
  password: Schema.String,
  updatedAt: Schema.String,
});
export type BrowserPasswordEntry = typeof BrowserPasswordEntry.Type;

/** Without an `id` the vault adds an entry; with one it replaces that entry. */
export const BrowserPasswordSaveInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  site: Schema.String,
  username: Schema.String,
  password: Schema.String,
});
export type BrowserPasswordSaveInput = typeof BrowserPasswordSaveInput.Type;

/** What the browser page receives: only the matching logins, never their ids or other sites. */
export const BrowserPasswordAutofillCredential = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
});
export type BrowserPasswordAutofillCredential = typeof BrowserPasswordAutofillCredential.Type;
