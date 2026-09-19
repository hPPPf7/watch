import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { fetchNetwork, forwardNetwork, handle, unhandle, readCookies } = vi.hoisted(() => ({ fetchNetwork: vi.fn(), forwardNetwork: vi.fn(), handle: vi.fn(), unhandle: vi.fn(), readCookies: vi.fn() }));
vi.mock("electron", () => ({ session: { defaultSession: { fetch: fetchNetwork, protocol: { handle, unhandle }, cookies: { get: readCookies } } } }));
vi.mock("../../desktop/forward-request.mjs", () => ({ forwardRequest: forwardNetwork }));
import { installDesktopApiCache } from "../../desktop/api-cache.mjs";
let root: string;
let dispose: () => void;
let onSignedOut = vi.fn<() => void>();
let request: (request: Request) => Promise<Response>;
const origin = "https://watch.invalid";
const call = (url: string, init: RequestInit = {}) => request(new Request(origin + url, { ...init, headers: { cookie: "test-session", ...init.headers } }));
beforeEach(async () => {
  readCookies.mockReset().mockResolvedValue([]);
  unhandle.mockReset();
  onSignedOut = vi.fn<() => void>();
  forwardNetwork.mockReset().mockImplementation((url, options) => fetchNetwork(url, options));
  root = await fs.mkdtemp(path.join(os.tmpdir(), "watch-cache-test-"));
  fetchNetwork.mockImplementation(async (url: string) => url.endsWith("/api/profile/me") ? Response.json({ id: "u" }) : url.includes("revision") ? Response.json({ revision: "r1" }) : Response.json({ count: 1 }));
  dispose = installDesktopApiCache({ app: { getPath: () => root }, appOrigin: origin, onSignedOut });
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
    expect(options.body.toString()).toBe("a=b"); expect(forwardNetwork).toHaveBeenCalledOnce();
    controller.abort();
    expect(response.status).toBe(302); expect(response.headers.get("location")).toBe("/done");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly"); expect(response.headers.has("content-length")).toBe(false);
  });
  it("非 API 的外站導覽也交回轉址，不能把最後的 HTML 留在登入來源", async () => {
    fetchNetwork.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: origin + "/api/auth/callback/test" } }));
    const response = await request(new Request("https://provider.invalid/signin"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(origin + "/api/auth/callback/test");
    expect(forwardNetwork).toHaveBeenCalledWith("https://provider.invalid/signin", expect.objectContaining({ cache: "default" }));
  });
  it("轉送失敗不記錄 OAuth code、state 或例外中的完整網址", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    forwardNetwork.mockRejectedValueOnce(new Error("Failed https://watch.invalid/api/auth/callback/test?code=secret-code&state=secret-state"));
    const response = await call("/api/auth/callback/test?code=secret-code&state=secret-state");
    expect(response.type).toBe("error");
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret-");
    expect(error).toHaveBeenCalledWith("[desktop-cache] request failed", { path: "/api/auth/callback/test", name: "Error" });
    error.mockRestore();
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

it("已完結詳情即使內容未變也在七天後回查", async () => {
 const clock=vi.spyOn(Date,"now");let now=Date.parse("2026-09-11T00:00:00Z");clock.mockImplementation(()=>now);
 fetchNetwork.mockImplementation(async (url:string)=>url.endsWith("/api/profile/me")?Response.json({id:"u"}):Response.json({id:123,media_type:"tv",status:"Ended",title:"測試",seasons_info:[]}));
 try {
  await call("/api/tmdb/detail?type=tv&id=123");
  const calls=()=>fetchNetwork.mock.calls.filter(args=>String(args[0]).includes("/api/tmdb/detail")).length;
  const first=calls();
  now+=6*86400000;await call("/api/tmdb/detail?type=tv&id=123&refresh=1");expect(calls()).toBe(first);
  now+=2*86400000;await call("/api/tmdb/detail?type=tv&id=123&refresh=1");expect(calls()).toBe(first+1);
  now+=8*86400000;await call("/api/tmdb/detail?type=tv&id=123&refresh=1");expect(calls()).toBe(first+2);
 } finally {clock.mockRestore();}
});


it.each([503, 200])("a %s incomplete section response cannot replace the last good desktop history", async status => {
 let failed = false;
 const section = {rows:[{id:"item",tmdb_id:1,media_type:"movie",is_anime:false}], movieHistoryRows:[{tmdb_id:1,watched_at:"2026-09-01",watch_count:1}]};
 fetchNetwork.mockImplementation(async (url:string) => {
   if(url.endsWith("/api/profile/me")) return Response.json({id:"u"});
   if(url.includes("revision")) return Response.json({revision:"r1"});
   if(url.includes("section-data")) return Response.json(failed ? {rows:[],movieHistoryRows:[],historyQueryFailed:true} : section,{status:failed?status:200});
   return Response.json({});
 });
 await call("/api/watchlist/section-data?mediaType=movie");
 const readSaved = async (bucket:string) => {
   const files=await fs.readdir(path.join(root,bucket));
   return await Promise.all(files.map(async file=>JSON.parse(await fs.readFile(path.join(root,bucket,file),"utf8"))));
 };
 failed=true;
 await call("/api/watchlist/section-data?mediaType=movie&refresh=1");
 for(const bucket of ["api-cache","local-watch-history"]) {
   const entries=await readSaved(bucket);
   expect(entries.length).toBeGreaterThan(0);
   for(const entry of entries) expect(JSON.parse(entry.body).movieHistoryRows).toEqual(section.movieHistoryRows);
 }
 const response=await call("/api/watchlist/section-data?mediaType=movie");
 expect((await response.json()).movieHistoryRows).toEqual(section.movieHistoryRows);
});

const cacheBuckets = ["api-cache", "local-watch-history", "media-titles"];
const listBuckets = () => Promise.all(cacheBuckets.map(bucket =>
  fs.readdir(path.join(root, bucket)).catch(() => [])));
const seedAccountCaches = async () => {
  await call("/api/watchlist/section-data?mediaType=movie");
  await call("/api/media/titles", { method: "POST", body: JSON.stringify({ items: [{ media_type: "movie", tmdb_id: 1 }] }) });
  await call("/api/tmdb/season?type=tv&id=1&season=1");
};
const mockAccountNetwork = (sessionPayload: unknown = { user: { id: "u" } }) => {
  fetchNetwork.mockImplementation(async (url: string, options: RequestInit = {}) => {
    if (url.endsWith("/api/auth/session")) return Response.json(sessionPayload);
    if (url.endsWith("/api/profile/me")) return Response.json({ id: "u" });
    if (url.includes("revision")) return Response.json({ revision: "r1" });
    if (url.includes("/section-data")) return Response.json({
      rows: [{ id: "item-u", tmdb_id: 1, media_type: "movie", is_anime: false }],
      movieHistoryRows: [{ tmdb_id: 1, watched_at: "2026-09-01", watch_count: 1 }],
    });
    if (url.includes("/media/titles")) return Response.json({ titles: { "movie:1": { title: "作品", is_anime: false } } });
    if (url.includes("/tmdb/season")) return Response.json({ episodes: [{ episode_number: 1, air_date: "2020-01-01" }] });
    return Response.json({ ok: true, cookie: new Headers(options.headers).get("cookie") });
  });
};

it("同帳號重驗、CSRF 與 providers 查詢保留所有快取，不延長來源期限", async () => {
  mockAccountNetwork();
  await seedAccountCaches();
  const before = await listBuckets();
  expect(before.every(files => files.length > 0)).toBe(true);
  const bodies = await Promise.all(before[0].map(file => fs.readFile(path.join(root, "api-cache", file), "utf8")));
  const countRequests = () => fetchNetwork.mock.calls.filter(([url]) => /section-data|tmdb\/season|media\/titles/.test(String(url))).length;
  const count = countRequests();
  for (const endpoint of ["session", "csrf", "providers", "session"]) await call("/api/auth/" + endpoint);
  expect(await listBuckets()).toEqual(before);
  expect(await Promise.all(before[0].map(file => fs.readFile(path.join(root, "api-cache", file), "utf8")))).toEqual(bodies);
  await seedAccountCaches();
  expect(countRequests()).toBe(count);
});

it.each(["null-session", "changed-session", "signout", "delete-site", "delete"])(
  "%s 仍清除帳號快取及標題副本",
  async kind => {
    mockAccountNetwork();
    await seedAccountCaches();
    if (kind.endsWith("session")) {
      mockAccountNetwork(kind === "null-session" ? null : { user: { id: "other" } });
      await call("/api/auth/session");
    } else {
      await call(kind === "signout" ? "/api/auth/signout" : "/api/account/" + kind, { method: "POST" });
    }
    expect(await listBuckets()).toEqual([[], [], []]);
  },
);

it.each(["malformed", "unavailable", "network"])("session %s 不冒充登出且下一次使用私人快取要重新驗證", async kind => {
  mockAccountNetwork();
  await seedAccountCaches();
  const before = await listBuckets();
  const normal = fetchNetwork.getMockImplementation()!;
  let identityCalls = 0;
  fetchNetwork.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/api/auth/session")) {
      if (kind === "network") throw new TypeError("offline");
      return kind === "malformed"
        ? new Response("{broken", { headers: { "content-type": "application/json" } })
        : Response.json({}, { status: 503 });
    }
    if (url.endsWith("/api/profile/me")) identityCalls++;
    return normal(url, options);
  });
  await call("/api/auth/session");
  expect(await listBuckets()).toEqual(before);
  await call("/api/watchlist/section-data?mediaType=movie");
  expect(identityCalls).toBe(1);
});

it("登出前延遲的身份查詢不能重建身份快取", async () => {
  let deliver!: (response: Response) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let identityCalls = 0;
  fetchNetwork.mockImplementation(async (url: string) => {
    if (url.endsWith("/api/profile/me")) {
      identityCalls++;
      if (identityCalls === 1) {
        started();
        return new Promise<Response>(resolve => { deliver = resolve; });
      }
      return Response.json({}, { status: 401 });
    }
    return Response.json(url.includes("revision") ? { revision: "r1" } : { count: 1 });
  });
  const pending = call("/api/detail/history-count?mediaType=movie&tmdbId=1");
  await ready;
  await call("/api/auth/signout", { method: "POST" });
  deliver(Response.json({ id: "u" }));
  await pending;
  await call("/api/detail/history-count?mediaType=movie&tmdbId=1");
  expect(identityCalls).toBe(2);
  expect(await listBuckets()).toEqual([[], [], []]);
});

it("以另一個 cookie 確認新帳號時不可使用舊帳號回應", async () => {
  mockAccountNetwork();
  await seedAccountCaches();
  fetchNetwork.mockImplementation(async (url: string) => {
    if (url.endsWith("/api/profile/me")) return Response.json({ id: "other" });
    if (url.includes("revision")) return Response.json({ revision: "r2" });
    return Response.json({ rows: [], movieHistoryRows: [] });
  });
  const response = await call("/api/watchlist/section-data?mediaType=movie", { headers: { cookie: "other-session" } });
  expect((await response.json()).rows).toEqual([]);
  expect(await listBuckets()).toEqual([[], [], []]);
});

it.each(["unavailable", "malformed", "network"])("session %s invalidates a profile lookup already in flight", async kind => {
  let deliver!: (response: Response) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let identityCalls = 0;
  let sessionFailed = false;
  fetchNetwork.mockImplementation(async (url: string) => {
    if (url.endsWith("/api/profile/me")) {
      identityCalls++;
      if (identityCalls === 1) {
        started();
        return new Promise<Response>(resolve => { deliver = resolve; });
      }
      return Response.json({}, { status: 401 });
    }
    if (url.endsWith("/api/auth/session")) {
      sessionFailed = true;
      if (kind === "network") throw new TypeError("offline");
      if (kind === "malformed") return new Response("{broken", { headers: { "content-type": "application/json" } });
      return Response.json({}, { status: 503 });
    }
    if (url.includes("revision")) return Response.json({ revision: "r1" });
    return sessionFailed ? Response.json({}, { status: 401 }) : Response.json({ count: 7 });
  });
  const pending = call("/api/detail/history-count?mediaType=movie&tmdbId=1");
  await ready;
  await call("/api/auth/session");
  deliver(Response.json({ id: "u" }));
  await pending;
  const next = await call("/api/detail/history-count?mediaType=movie&tmdbId=1");
  expect(identityCalls).toBe(2);
  expect(next.status).toBe(401);
  expect(await listBuckets()).toEqual([[], [], []]);
});

it("same-origin Electron requests without Cookie headers use the local cookie fingerprint and preserve normal revalidation", async () => {
  mockAccountNetwork();
  readCookies.mockResolvedValue([{ name: "fixture-session", value: "u" }]);
  const rendererCall = (url: string) => request(new Request(origin + url, { referrer: origin + "/", credentials: "same-origin" }));
  await rendererCall("/api/watchlist/section-data?mediaType=movie");
  const before = await listBuckets();
  expect(before[0].length).toBeGreaterThan(0);
  await rendererCall("/api/auth/session");
  await rendererCall("/api/watchlist/section-data?mediaType=movie");
  expect(await listBuckets()).toEqual(before);
  expect(fetchNetwork.mock.calls.filter(([url]) => String(url).includes("section-data"))).toHaveLength(1);
  expect(readCookies).toHaveBeenCalledWith({ url: origin + "/api/profile/me" });
  for (const [, options] of fetchNetwork.mock.calls) {
    expect(new Headers(options?.headers).get("cookie")).toBeNull();
  }
  // A changed cookie must resolve its own identity rather than reuse u.
  readCookies.mockResolvedValue([{ name: "fixture-session", value: "other" }]);
  fetchNetwork.mockImplementation(async (url: string) => {
    if (url.endsWith("/api/profile/me")) return Response.json({ id: "other" });
    if (url.includes("revision")) return Response.json({ revision: "r2" });
    return Response.json({ rows: [], movieHistoryRows: [] });
  });
  expect((await (await rendererCall("/api/watchlist/section-data?mediaType=movie")).json()).rows).toEqual([]);
  expect(await listBuckets()).toEqual([[], [], []]);
});

it.each(["omit", "cross-origin", "no-referrer", "cookie-store-failure"])("%s cannot borrow the local cookie store to return private cached data", async kind => {
  mockAccountNetwork();
  readCookies.mockResolvedValue([{ name: "fixture-session", value: "u" }]);
  await request(new Request(origin + "/api/watchlist/section-data?mediaType=movie", { referrer: origin + "/" }));
  readCookies.mockClear();
  if (kind === "cookie-store-failure") readCookies.mockRejectedValue(new Error("unavailable"));
  fetchNetwork.mockResolvedValue(Response.json({}, { status: 401 }));
  const options: RequestInit = kind === "omit"
    ? { referrer: origin + "/", credentials: "omit" }
    : kind === "cross-origin" ? { referrer: "https://other.invalid/", credentials: "include" }
    : kind === "cookie-store-failure" ? { referrer: origin + "/" } : {};
  const response = await request(new Request(origin + "/api/watchlist/section-data?mediaType=movie", options));
  expect(response.status).toBe(401);
  if (kind !== "cookie-store-failure") expect(readCookies).not.toHaveBeenCalled();
  if (kind === "omit") expect(fetchNetwork.mock.calls.at(-1)?.[1].credentials).toBe("omit");
});

describe("desktop cache installation lifetime", () => {
  it.each([200, 302])("confirmed signout %s completes its response before caching stays suspended", async status => {
    mockAccountNetwork();
    await seedAccountCaches();
    onSignedOut.mockImplementation(dispose);
    forwardNetwork.mockResolvedValueOnce(new Response(status === 200 ? JSON.stringify({ url: "/" }) : null, {
      status, headers: { "content-type": "application/json", "set-cookie": "session=; Max-Age=0", location: "/" },
    }));
    const response = await call("/api/auth/signout", { method: "POST", body: "csrfToken=fixture" });
    expect(response.status).toBe(status);
    if (status === 200) expect(await response.json()).toEqual({ url: "/" });
    expect(response.headers.get("set-cookie")).toBe("session=; Max-Age=0");
    expect(await listBuckets()).toEqual([[], [], []]);
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(unhandle).toHaveBeenCalledExactlyOnceWith("https");
    dispose();
    expect(unhandle).toHaveBeenCalledOnce();
  });

  it.each([403, 503])("unsuccessful signout %s leaves the installation active", async status => {
    onSignedOut.mockImplementation(dispose);
    forwardNetwork.mockResolvedValueOnce(Response.json({ error: "not signed out" }, { status }));
    expect((await call("/api/auth/signout", { method: "POST" })).status).toBe(status);
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(unhandle).not.toHaveBeenCalled();
  });

  it("only an accepted null session suspends caching, not malformed or failed checks", async () => {
    onSignedOut.mockImplementation(dispose);
    for (const response of [Response.json({}, { status: 503 }), Response.json({}), new Response("broken")]) {
      forwardNetwork.mockResolvedValueOnce(response);
      await call("/api/auth/session");
      expect(onSignedOut).not.toHaveBeenCalled();
    }
    forwardNetwork.mockResolvedValueOnce(Response.json(null));
    expect(await (await call("/api/auth/session")).json()).toBeNull();
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(unhandle).toHaveBeenCalledOnce();
  });

  it("a delayed old null session cannot suspend a later installation", async () => {
    let deliver!: (response: Response) => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    forwardNetwork.mockImplementationOnce(() => { started(); return new Promise<Response>(resolve => { deliver = resolve; }); });
    const pending = call("/api/auth/session");
    await ready;
    onSignedOut.mockImplementation(dispose);
    await call("/api/auth/signout", { method: "POST" });
    const nextSignedOut = vi.fn();
    const nextDispose = installDesktopApiCache({ app: { getPath: () => root }, appOrigin: origin, onSignedOut: nextSignedOut });
    deliver(Response.json(null));
    expect(await (await pending).json()).toBeNull();
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(nextSignedOut).not.toHaveBeenCalled();
    expect(unhandle).toHaveBeenCalledOnce();
    nextDispose();
  });

  it("disposal preserves an in-flight write request without replaying or refilling caches", async () => {
    mockAccountNetwork();
    await seedAccountCaches();
    let deliver!: (response: Response) => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const normal = fetchNetwork.getMockImplementation()!;
    fetchNetwork.mockImplementation((url: string, options: RequestInit) => {
      if (url.endsWith("/api/detail/watchlist-upsert")) { started(); return new Promise<Response>(resolve => { deliver = resolve; }); }
      return normal(url, options);
    });
    const pending = call("/api/detail/watchlist-upsert", { method: "POST", body: JSON.stringify({ tmdbId: 1 }) });
    await ready;
    onSignedOut.mockImplementation(dispose);
    await call("/api/auth/signout", { method: "POST" });
    deliver(Response.json({ ok: true }));
    expect(await (await pending).json()).toEqual({ ok: true });
    expect(fetchNetwork.mock.calls.filter(([url]) => String(url).endsWith("/api/detail/watchlist-upsert"))).toHaveLength(1);
    expect(await listBuckets()).toEqual([[], [], []]);
  });

  it("a request already assigned to a disposed handler uses the network once without identity or cache writes", async () => {
    dispose();
    fetchNetwork.mockClear();
    forwardNetwork.mockClear();
    const response = await call("/api/watchlist/section-data?mediaType=movie");
    expect(await response.json()).toEqual({ count: 1 });
    expect(fetchNetwork).toHaveBeenCalledOnce();
    expect(forwardNetwork).toHaveBeenCalledExactlyOnceWith(origin + "/api/watchlist/section-data?mediaType=movie", expect.objectContaining({ cache: "no-store" }));
    expect(await listBuckets()).toEqual([[], [], []]);
  });
});

it("an old installation's delayed private response cannot repopulate the next account's caches", async () => {
  let deliver!: (response: Response) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  fetchNetwork.mockImplementation(async (url: string) => {
    if (url.endsWith("/api/profile/me")) return Response.json({ id: "u" });
    if (url.includes("tmdbId=2")) { started(); return new Promise<Response>(resolve => { deliver = resolve; }); }
    return Response.json({ count: 1 });
  });
  const pending = call("/api/detail/history-count?mediaType=movie&tmdbId=2");
  await ready;
  onSignedOut.mockImplementation(dispose);
  await call("/api/auth/signout", { method: "POST" });
  const nextDispose = installDesktopApiCache({ app: { getPath: () => root }, appOrigin: origin });
  const nextRequest = handle.mock.calls.at(-1)![1];
  await nextRequest(new Request(origin + "/api/detail/history-count?mediaType=movie&tmdbId=1", { headers: { cookie: "new-session" } }));
  const before = await listBuckets();
  expect(before[0]).toHaveLength(1);
  deliver(Response.json({ count: 99 }));
  expect(await (await pending).json()).toEqual({ count: 99 });
  expect(await listBuckets()).toEqual(before);
  nextDispose();
});

it("an old cache cleanup paused before deletion cannot remove a newly installed cache entry", async () => {
  await call("/api/detail/history-count?mediaType=movie&tmdbId=1");
  const [filename] = await fs.readdir(path.join(root, "api-cache"));
  const oldBody = await fs.readFile(path.join(root, "api-cache", filename), "utf8");
  let deliver!: (contents: string) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const read = vi.spyOn(fs, "readFile").mockImplementationOnce(() => {
    started();
    return new Promise<string>(resolve => { deliver = resolve; });
  });
  try {
    const pending = call("/api/detail/watchlist-upsert", { method: "POST", body: "{}" });
    await ready;
    onSignedOut.mockImplementation(dispose);
    await call("/api/auth/signout", { method: "POST" });
    const nextDispose = installDesktopApiCache({ app: { getPath: () => root }, appOrigin: origin });
    const nextRequest = handle.mock.calls.at(-1)![1];
    await nextRequest(new Request(origin + "/api/detail/history-count?mediaType=movie&tmdbId=1", { headers: { cookie: "new-session" } }));
    const before = await listBuckets();
    expect(before[0]).toEqual([filename]);
    deliver(oldBody);
    expect(await (await pending).json()).toEqual({ count: 1 });
    expect(await listBuckets()).toEqual(before);
    nextDispose();
  } finally {
    read.mockRestore();
  }
});
