import { describe, expect, it } from "vite-plus/test";

import {
  browserPasswordSiteMatchesOrigin,
  isBrowserPasswordAutofillOrigin,
  normalizeBrowserPasswordSite,
} from "./browserPasswordSites.ts";

describe("normalizeBrowserPasswordSite", () => {
  it("reduces typed text to a host, keeping the port only for loopback", () => {
    expect(normalizeBrowserPasswordSite("https://www.GitHub.com/login")).toBe("github.com");
    expect(normalizeBrowserPasswordSite("app.example.com:8443")).toBe("app.example.com");
    expect(normalizeBrowserPasswordSite("localhost:3000")).toBe("localhost:3000");
    expect(normalizeBrowserPasswordSite("http://127.0.0.1:5173/")).toBe("localhost:5173");
    expect(normalizeBrowserPasswordSite("localhost")).toBe("localhost");
  });

  it("rejects text that names no web host", () => {
    expect(normalizeBrowserPasswordSite("")).toBeNull();
    expect(normalizeBrowserPasswordSite("   ")).toBeNull();
    expect(normalizeBrowserPasswordSite("ftp://example.com")).toBeNull();
  });
});

describe("browserPasswordSiteMatchesOrigin", () => {
  it("fills a domain and its subdomains", () => {
    expect(browserPasswordSiteMatchesOrigin("github.com", "https://github.com")).toBe(true);
    expect(browserPasswordSiteMatchesOrigin("github.com", "https://www.github.com")).toBe(true);
    expect(browserPasswordSiteMatchesOrigin("github.com", "https://gist.github.com")).toBe(true);
    expect(browserPasswordSiteMatchesOrigin("github.com", "https://notgithub.com")).toBe(false);
    expect(browserPasswordSiteMatchesOrigin("gist.github.com", "https://github.com")).toBe(false);
  });

  it("keys loopback entries by port", () => {
    expect(browserPasswordSiteMatchesOrigin("localhost:3000", "http://localhost:3000")).toBe(true);
    expect(browserPasswordSiteMatchesOrigin("localhost:3000", "http://127.0.0.1:3000")).toBe(true);
    expect(browserPasswordSiteMatchesOrigin("localhost:3000", "http://localhost:5173")).toBe(false);
    expect(browserPasswordSiteMatchesOrigin("localhost:80", "http://localhost")).toBe(true);
    expect(browserPasswordSiteMatchesOrigin("localhost", "http://localhost:5173")).toBe(true);
  });

  it("keeps loopback and public entries apart", () => {
    expect(browserPasswordSiteMatchesOrigin("localhost", "https://example.com")).toBe(false);
    expect(browserPasswordSiteMatchesOrigin("example.com", "http://localhost:3000")).toBe(false);
  });
});

describe("isBrowserPasswordAutofillOrigin", () => {
  it("allows https and loopback http only", () => {
    expect(isBrowserPasswordAutofillOrigin("https://example.com")).toBe(true);
    expect(isBrowserPasswordAutofillOrigin("http://localhost:3000")).toBe(true);
    expect(isBrowserPasswordAutofillOrigin("http://example.com")).toBe(false);
    expect(isBrowserPasswordAutofillOrigin("null")).toBe(false);
  });
});
