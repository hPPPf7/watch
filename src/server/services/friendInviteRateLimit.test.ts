import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
const redis=vi.hoisted(()=>({enabled:false,eval:vi.fn()}));
vi.mock("@/server/realtime/redis",()=>({isRedisRealtimeEnabled:()=>redis.enabled,getRedisPublisher:()=>redis}));
beforeEach(()=>{vi.resetModules();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(100000);redis.enabled=false;redis.eval.mockReset();});
afterEach(()=>vi.useRealTimers());
describe("friend invitation rate limit",()=>{
 it("limits concurrent attempts, keeps users separate, and resets after a minute",async()=>{
  const {limitFriendInvites:limit}=await import("./friendInviteRateLimit");
  const results=await Promise.all(Array.from({length:20},()=>limit("USER")));
  expect(results.filter(r=>r===null)).toHaveLength(10);
  expect(results[10]?.status).toBe(429);expect(results[10]?.headers.get("Retry-After")).toBe("60");
  expect(await limit("other")).toBeNull(); expect((await limit("user"))?.status).toBe(429);
  vi.setSystemTime(160001);expect(await limit("user")).toBeNull();
 });
 it("uses atomic Redis state and does not keep querying Redis while denied",async()=>{
  redis.enabled=true;redis.eval.mockResolvedValue([11,50000]);
  const {limitFriendInvites:limit}=await import("./friendInviteRateLimit");
  expect((await limit("a"))?.status).toBe(429);expect((await limit("a"))?.status).toBe(429);
  expect(redis.eval).toHaveBeenCalledTimes(1);expect(redis.eval.mock.calls[0][0]).toContain("PEXPIRE");
 });
 it("keeps local usage when Redis fails",async()=>{
  redis.enabled=true;redis.eval.mockResolvedValue([1,60000]);
  const {limitFriendInvites:limit}=await import("./friendInviteRateLimit");
  for(let i=0;i<5;i++)expect(await limit("a")).toBeNull();
  redis.eval.mockRejectedValue(new Error("offline"));
  for(let i=0;i<5;i++)expect(await limit("a")).toBeNull();
  expect((await limit("a"))?.status).toBe(429);
 });
 it("bounds local memory without evicting active user counters",async()=>{
  const {limitFriendInvites:limit}=await import("./friendInviteRateLimit");
  for(let i=0;i<5000;i++)await limit(String(i));
  expect((await limit("new"))?.status).toBe(429);
  for(let i=1;i<10;i++)await limit("0");
  expect((await limit("0"))?.status).toBe(429);
  vi.setSystemTime(160001);expect(await limit("new")).toBeNull();
 });
});
