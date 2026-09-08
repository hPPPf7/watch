import { beforeEach, describe, expect, it, vi } from "vitest";
const { read, metadata, detail, background, auth } = vi.hoisted(() => ({ read: vi.fn(), metadata: vi.fn(), detail: vi.fn(), background: vi.fn(), auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/tmdb/cache", () => ({ readTmdbCache: read, TMDB_CACHE_KEYS: { detail: () => "detail" }, tmdbJson: (p: unknown) => Response.json(p) }));
vi.mock("@/server/tmdb/calendarMetadata", () => ({ readCalendarMetadata: metadata, refreshCalendarMetadataIfTitleNeedsRefresh: background }));
vi.mock("@/server/tmdb/detail", () => ({ getTmdbDetail: detail }));
vi.mock("@/server/tmdb/auth", () => ({ getOptionalTmdbUserId: async () => null }));
vi.mock("@/server/tmdb/rateLimit", () => ({ enforceTmdbProxyRateLimit: () => ({ beforeStart: () => {}, apply: (r: Response) => r }) }));
import { GET } from "./route";
describe("詳情中文標題退避", () => {
  beforeEach(() => { read.mockResolvedValue({ title: "English", original_title: "English" }); background.mockResolvedValue(null); detail.mockResolvedValue({ title: "新標題" }); auth.mockResolvedValue({ user: { id: "u" } }); });
  it("有效 metadata 中的原文標題不會每次強制重查", async () => {
    metadata.mockResolvedValue({ title: "English" });
    for (let i = 0; i < 2; i++) expect((await GET(new Request("https://watch.invalid/api/tmdb/detail?type=movie&id=1"))).status).toBe(200);
    expect(detail).not.toHaveBeenCalled();
  });
  it.each([null, { title: "新標題" }])("到期或已有中文標題會刷新：%j", async state => {
    metadata.mockResolvedValue(state);
    expect(await (await GET(new Request("https://watch.invalid/api/tmdb/detail?type=movie&id=1"))).json()).toEqual({ title: "新標題" });
    expect(detail).toHaveBeenCalledWith("movie", "1", expect.objectContaining({ forceRefresh: true }));
  });
  it("明確重新整理仍可略過退避", async () => {
    metadata.mockResolvedValue({ title: "English" });
    await GET(new Request("https://watch.invalid/api/tmdb/detail?type=movie&id=1&refresh=1"));
    expect(detail).toHaveBeenCalledWith("movie", "1", expect.objectContaining({ forceRefresh: true }));
  });
});
