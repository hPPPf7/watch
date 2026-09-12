import {beforeEach,afterEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({read:vi.fn(),write:vi.fn(),auth:vi.fn(),claim:vi.fn(),upstream:vi.fn(),limit:vi.fn()}));
vi.mock("@/auth",()=>({auth:mocks.auth}));
vi.mock("@/server/tmdb/auth",()=>({getOptionalTmdbUserId:async()=>null}));
vi.mock("@/server/tmdb/seasonRepairCooldown",()=>({claimSeasonRepair:mocks.claim}));
vi.mock("@/server/tmdb/fetchWithCooldown",()=>({fetchTmdbWithCooldown:mocks.upstream,tmdbRetryAfterSeconds:()=>120}));
vi.mock("@/server/tmdb/rateLimit",()=>({enforceTmdbProxyRateLimit:()=>({beforeStart:mocks.limit,apply:(r:Response)=>r})}));
vi.mock("@/server/tmdb/cache",()=>({
 readTmdbCache:mocks.read,writeTmdbCache:mocks.write,
 TMDB_CACHE_KEYS:{season:()=>"season",detail:()=>"detail"},tmdbJson:(p:unknown)=>Response.json(p),
 withTmdbInflightGuarded:async(_key:string,start:()=>void,load:()=>Promise<unknown>)=>{start();return load();},
}));
import {GET} from "./route";
const old={episodes:[{episode_number:1,name:"第一集",air_date:"2020-01-01"}]};
const updated={episodes:[...old.episodes,{episode_number:2,name:"第二集",air_date:"2099-01-01"}]};
const request=(query="&refresh=1&repair=1")=>new Request(`https://watch.invalid/api/tmdb/season?type=tv&id=123&season=1${query}`);
beforeEach(()=>{
 vi.stubEnv("TMDB_API_KEY","fixture");
 mocks.auth.mockResolvedValue({user:{id:"user"}});
 mocks.read.mockImplementation(async key=>key==="season"?old:{seasons_info:[{season_number:1,episode_count:2}]});
 mocks.claim.mockResolvedValue(true);mocks.write.mockResolvedValue(undefined);
 mocks.upstream.mockImplementation(async()=>Response.json(updated));
});
afterEach(()=>{vi.clearAllMocks();vi.unstubAllEnvs();});
it("repairs a mismatch validated against server metadata and updates the canonical shared cache",async()=>{
 expect(await(await GET(request())).json()).toEqual(updated);
 expect(mocks.claim).toHaveBeenCalledWith("123","1");
 expect(mocks.upstream).toHaveBeenCalledTimes(1);
 expect(mocks.write).toHaveBeenCalledWith("season",updated,expect.any(Number));
});
it("keeps ordinary cache hits free of auth, metadata lookups and repair cooldown operations",async()=>{
 expect(await(await GET(request(""))).json()).toEqual(old);
 expect(mocks.read).toHaveBeenCalledTimes(1);expect(mocks.auth).not.toHaveBeenCalled();
 expect(mocks.claim).not.toHaveBeenCalled();expect(mocks.upstream).not.toHaveBeenCalled();
});
it.each(["&repair=1","&refresh=1&repair=1"])("requires authentication for repair even without refresh: %s",async query=>{
 mocks.auth.mockResolvedValue(null);
 expect((await GET(request(query))).status).toBe(401);
 expect(mocks.read).not.toHaveBeenCalled();expect(mocks.upstream).not.toHaveBeenCalled();
});
it.each([null,{seasons_info:[{season_number:1,episode_count:1}]}])("does not trust a client supplied expected count or refresh an already consistent season",async detail=>{
 mocks.read.mockImplementation(async key=>key==="season"?old:detail);
 expect(await(await GET(request("&refresh=1&repair=1&expectedCount=999"))).json()).toEqual(old);
 expect(mocks.claim).not.toHaveBeenCalled();expect(mocks.upstream).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();
});
it("returns the existing payload during cooldown without extending its normal expiry",async()=>{
 mocks.claim.mockResolvedValue(false);
 expect(await(await GET(request())).json()).toEqual(old);
 expect(mocks.upstream).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();
});
it("preserves the shared cache after a failed repair and respects upstream 429",async()=>{
 mocks.upstream.mockResolvedValue(new Response(null,{status:429}));
 const response=await GET(request());expect(response.status).toBe(429);expect(response.headers.get("Retry-After")).toBe("120");
 expect(mocks.upstream).toHaveBeenCalledTimes(1);expect(mocks.write).not.toHaveBeenCalled();
});
it("loads an absent season normally rather than assuming zero episodes",async()=>{
 mocks.read.mockResolvedValue(null);
 expect(await(await GET(request())).json()).toEqual(updated);
 expect(mocks.upstream).toHaveBeenCalledTimes(1);expect(mocks.write).toHaveBeenCalledTimes(1);
});
