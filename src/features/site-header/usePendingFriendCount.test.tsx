// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => false }));
import usePendingFriendCount from "./usePendingFriendCount";
import { FRIEND_NOTICE_REFRESH_EVENT, getFriendGraphRevision } from "@/lib/friendNoticeEvents";
const session = { user: { id: "pending-count-user" } };
const summary = { incoming: [{ id: "request-1", fromUserId: "friend-1" }, { id: "request-2", fromUserId: "friend-2" }], outgoing: [], friends: [{ friendId: "friend-3" }] };
const empty = { incoming: [], outgoing: [], friends: [] };
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
function Harness() { return <output>{usePendingFriendCount({ session, sessionLoading: false })}</output>; }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); vi.stubGlobal("EventSource", undefined);
  host = document.createElement("div"); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); globalThis.IS_REACT_ACT_ENVIRONMENT = false; });
const tick = () => act(async () => vi.advanceTimersByTimeAsync(60_000));
const notice = () => act(async () => window.dispatchEvent(new Event(FRIEND_NOTICE_REFRESH_EVENT)));
it("real realtime hook preserves count/signature on failed reads and only accepts a successful empty graph", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(summary));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<Harness />));
  expect(host.textContent).toBe("2"); const revision = getFriendGraphRevision();
  const failures = [
    () => Promise.resolve(new Response(null, { status: 503 })),
    () => Promise.reject(new TypeError("offline")),
    () => Promise.reject(new DOMException("closed", "AbortError")),
    () => Promise.resolve(Response.json({})),
    () => Promise.resolve(Response.json({ ...empty, incoming: [null] })),
    () => Promise.resolve(new Response("invalid json")),
  ];
  for (const fail of failures) {
    fetcher.mockImplementationOnce(fail);
    await tick(); expect(host.textContent).toBe("2"); expect(getFriendGraphRevision()).toBe(revision);
  }
  fetcher.mockImplementationOnce(async () => Response.json(summary));
  await tick(); expect(getFriendGraphRevision()).toBe(revision);
  fetcher.mockImplementationOnce(async () => Response.json(empty));
  await tick(); expect(host.textContent).toBe("0"); expect(getFriendGraphRevision()).toBe(revision + 1);
});
it("notice-triggered rejection and unmount abort settle without an unhandled promise", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(summary));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<Harness />));
  fetcher.mockRejectedValueOnce(new TypeError("offline"));
  await notice(); expect(host.textContent).toBe("2");
  let aborted = false;
  fetcher.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => { aborted = true; reject(new DOMException("closed", "AbortError")); }, { once: true });
  }));
  await notice();
  await act(async () => root.render(null));
  expect(aborted).toBe(true);
});
it("a late successful notice read cannot overwrite a newer count", async () => {
  let resolveOld!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(summary));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<Harness />));
  fetcher.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  await notice();
  fetcher.mockImplementationOnce(async () => Response.json(empty));
  await notice(); expect(host.textContent).toBe("0");
  await act(async () => resolveOld(Response.json(summary)));
  expect(host.textContent).toBe("0");
});
