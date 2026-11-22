/**
 * Which pages a saved browser password fills. A domain fills itself and its subdomains on any
 * port; a loopback entry also keys on port (`localhost:3000`), and bare `localhost` fills every port.
 */

export interface BrowserPasswordSite {
  /** Lowercase hostname without a leading `www.`; loopback hosts collapse to `localhost`. */
  readonly host: string;
  /** Only kept for loopback hosts; `null` matches every port. */
  readonly port: string | null;
}

const DEFAULT_PORTS: Readonly<Record<string, string>> = { "http:": "80", "https:": "443" };

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function stripWww(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

function parseUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

/** Parses what a person typed (`github.com`, `https://app.example.com/login`, `localhost:5173`). */
export function parseBrowserPasswordSite(input: string): BrowserPasswordSite | null {
  const url = parseUrl(input);
  if (!url || url.hostname === "") return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const hostname = url.hostname.toLowerCase();
  if (isLoopbackHostname(hostname)) {
    return { host: "localhost", port: url.port === "" ? null : url.port };
  }
  return { host: stripWww(hostname), port: null };
}

/** The canonical text a site is saved and shown as. */
function formatBrowserPasswordSite(site: BrowserPasswordSite): string {
  return site.port === null ? site.host : `${site.host}:${site.port}`;
}

/** Canonical form of typed site text, or `null` when it names no web host. */
export function normalizeBrowserPasswordSite(input: string): string | null {
  const site = parseBrowserPasswordSite(input);
  return site ? formatBrowserPasswordSite(site) : null;
}

/** Whether a saved site fills a page served from `origin` (as `WebFrameMain.origin` reports it). */
export function browserPasswordSiteMatchesOrigin(savedSite: string, origin: string): boolean {
  const site = parseBrowserPasswordSite(savedSite);
  if (!site) return false;
  let page: URL;
  try {
    page = new URL(origin);
  } catch {
    return false;
  }
  if (page.protocol !== "http:" && page.protocol !== "https:") return false;
  const hostname = page.hostname.toLowerCase();
  if (isLoopbackHostname(hostname)) {
    if (site.host !== "localhost") return false;
    const port = page.port === "" ? (DEFAULT_PORTS[page.protocol] ?? "") : page.port;
    return site.port === null || site.port === port;
  }
  if (site.host === "localhost") return false;
  const pageHost = stripWww(hostname);
  return pageHost === site.host || pageHost.endsWith(`.${site.host}`);
}

/** Saved passwords leave the vault only for pages a stranger cannot intercept. */
export function isBrowserPasswordAutofillOrigin(origin: string): boolean {
  try {
    const page = new URL(origin);
    return (
      page.protocol === "https:" ||
      (page.protocol === "http:" && isLoopbackHostname(page.hostname.toLowerCase()))
    );
  } catch {
    return false;
  }
}
