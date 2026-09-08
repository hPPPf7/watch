import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { fetchNetwork, handle } = vi.hoisted(() => ({ fetchNetwork: vi.fn(), handle: vi.fn() }));
vi.mock("electron", () => ({ session: { defaultSession: { fetch: fetchNetwork, protocol: { handle } } } }));
import { installDesktopApiCache } from "../../desktop/api-cache.mjs";
let root: string;
let request: (request: Request) => Promise<Response>;
const origin = "https://watch.invalid";
const call = (url: string, init: RequestInit = {}) => request(new Request(origin + url, { ...init, headers: { cookie: "test-session", ...init.headers } }));
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "watch-cache-test-"));
  fetchNetwork.mockImplementation(async (url: string) => url.endsWith("/api/profile/me") ? Response.json({ id: "u" }) : url.includes("revision") ? Response.json({ revision: "r1" }) : Response.json({ count: 1 }));
  installDesktopApiCache({ app: { getPath: () => root }, appOrigin: origin });
  request = handle.mock.calls.at(-1)![1];
});
afterEach(async () => {
  // 僅移除這個測試用 mkdtemp 目錄。
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith("watch-cache-test-")) throw new Error("Unexpected test directory");
  await fs.rm(root, { recursive: true, force: true });
});
describe("desktop protocol streaming", () => {
  it.each(["watchlist", "friends"])("%s SSE 不等連線關閉便交付事件，取消讀取傳回 upstream", async kind => {
    const cancel = vi.fn();
    fetchNetwork.mockImplementationOnce(async () => Response.json({ id: "u" })).mockImplementationOnce(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("data: first\n\n")); }, cancel }), { headers: { "content-type": "text/event-stream" } }));
    const response = await call("/api/events/" + kind + "/stream");
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");
    await reader.cancel(); expect(cancel).toHaveBeenCalledOnce();
    expect(fetchNetwork.mock.calls.at(-1)![1].signal.aborted).toBe(true);
  });
  it("保留 POST body、轉址與 cookie，移除解壓縮後的長度標頭", async () => {
    const controller = new AbortController();
    fetchNetwork.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/done", "set-cookie": "session=test; HttpOnly", "content-length": "0" } }));
    const response = await call("/api/auth/callback/test", { method: "POST", body: "a=b", signal: controller.signal });
    const options = fetchNetwork.mock.calls[0][1];
    expect(options.body.toString()).toBe("a=b"); expect(options.redirect).toBe("manual");
    controller.abort();
    expect(response.status).toBe(302); expect(response.headers.get("location")).toBe("/done");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly"); expect(response.headers.has("content-length")).toBe(false);
  });
  it("刪除本網站後清掉磁碟紀錄，先前未完成的回應不可復活快取", async () => {
    const first = await call("/api/detail/history-count?mediaType=movie&tmdbId=1");
    expect(await first.json()).toEqual({ count: 1 });
    expect((await fs.readdir(path.join(root, "api-cache"))).length).toBeGreaterThan(0);
    let deliver!: (response: Response) => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    fetchNetwork.mockImplementation(async (url: string) => {
      if (url.includes("tmdbId=2") && url.includes("history-count")) { started(); return new Promise<Response>(resolve => { deliver = resolve; }); }
      if (url.endsWith("/api/profile/me")) return Response.json({ id: "u" });
      return Response.json(url.includes("revision") ? { revision: "r1" } : { ok: true });
    });
    const pending = call("/api/detail/history-count?mediaType=movie&tmdbId=2");
    await ready;
    expect((await call("/api/account/delete-site", { method: "POST" })).status).toBe(200);
    deliver(Response.json({ count: 9 })); await pending;
    for (const bucket of ["api-cache", "local-watch-history"]) expect(await fs.readdir(path.join(root, bucket)).catch(() => [])).toEqual([]);
  });
});
