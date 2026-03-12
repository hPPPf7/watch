import { beforeEach, describe, expect, it, vi } from "vitest";

import { enforceTmdbProxyRateLimit } from "@/server/tmdb/rateLimit";

describe("enforceTmdbProxyRateLimit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.VERCEL;
    delete process.env.CF_PAGES;
    delete process.env.TMDB_RATE_LIMIT_TRUST_CLOUDFLARE_HEADERS;
    delete process.env.TMDB_RATE_LIMIT_TRUST_PROXY_HEADERS;
    delete (globalThis as typeof globalThis & { __watchTmdbRateLimitStore?: Map<string, number[]> })
      .__watchTmdbRateLimitStore;
    delete (globalThis as typeof globalThis & { __watchTmdbRateLimitWarnings?: Set<string> })
      .__watchTmdbRateLimitWarnings;
  });

  it("匿名請求缺少可信 client key 時會記錄告警但不阻擋請求", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = new Request("http://localhost/api/tmdb/search");

    const result = enforceTmdbProxyRateLimit(request, null, "search");

    expect(result.response).toBeNull();
    expect(() => result.beforeStart()).not.toThrow();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]?.[0]).toContain(
      'anonymous rate limiting is disabled for scope "search"',
    );
  });

  it("相同 scope 的匿名告警只記錄一次，避免洗滿 log", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = new Request("http://localhost/api/tmdb/detail");

    enforceTmdbProxyRateLimit(request, null, "detail");
    enforceTmdbProxyRateLimit(request, null, "detail");

    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});
