import {beforeEach,afterEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({set:vi.fn(),enabled:vi.fn()}));
vi.mock("@/server/realtime/redis",()=>({getRedisPublisher:()=>({set:mocks.set}),isRedisRealtimeEnabled:mocks.enabled}));
beforeEach(()=>{vi.resetModules();vi.useFakeTimers();mocks.enabled.mockReturnValue(true);mocks.set.mockResolvedValue("OK");});
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
it("atomically shares a six-hour cooldown across processes and bounds local repeated work",async()=>{
 let {claimSeasonRepair}=await import("./seasonRepairCooldown");
 expect(await claimSeasonRepair("1","2")).toBe(true);
 expect(await claimSeasonRepair("1","2")).toBe(false);
 expect(mocks.set).toHaveBeenCalledTimes(1);
 expect(mocks.set).toHaveBeenCalledWith("watch:season-repair:1:2","1","PX",21600000,"NX");
 vi.resetModules();({claimSeasonRepair}=await import("./seasonRepairCooldown"));mocks.set.mockResolvedValue(null);
 expect(await claimSeasonRepair("1","2")).toBe(false);
});
it("retains a bounded local fallback when Redis is unavailable, allowing retry after expiry",async()=>{
 mocks.set.mockRejectedValue(new Error("offline"));
 const {claimSeasonRepair}=await import("./seasonRepairCooldown");
 expect(await claimSeasonRepair("3","1")).toBe(true);
 expect(await claimSeasonRepair("3","1")).toBe(false);
 vi.advanceTimersByTime(21600001);expect(await claimSeasonRepair("3","1")).toBe(true);
});
it("does not evict active cooldowns when the fallback reaches capacity",async()=>{
 mocks.enabled.mockReturnValue(false);
 const {claimSeasonRepair}=await import("./seasonRepairCooldown");
 for(let i=1;i<=5000;i++) expect(await claimSeasonRepair(String(i),"1")).toBe(true);
 expect(await claimSeasonRepair("5001","1")).toBe(false);
 expect(await claimSeasonRepair("1","1")).toBe(false);
 expect(mocks.set).not.toHaveBeenCalled();
});
