import { NextResponse } from "next/server";
import { getRedisPublisher, isRedisRealtimeEnabled } from "@/server/realtime/redis";
const WINDOW_MS = 60_000;
const LIMIT = 10;
const MAX_BUCKETS = 5000;
const buckets = new Map<string, { count: number; resetAt: number }>();
const SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}
`;
function denied(resetAt: number) {
  const seconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return NextResponse.json({code:"RATE_LIMITED",message:`好友邀請太頻繁，請於 ${seconds} 秒後再試。`}, {status:429,headers:{"Retry-After":String(seconds),"Cache-Control":"no-store"}});
}
/** 登入後、查詢好友資料前執行；無輪詢、無 Neon 寫入。 */
export async function limitFriendInvites(userId: string) {
  const key = userId.toLowerCase();
  const now = Date.now();
  let bucket = buckets.get(key);
  if (bucket && bucket.resetAt <= now) { buckets.delete(key); bucket = undefined; }
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [id, entry] of buckets) if (entry.resetAt <= now) buckets.delete(id);
      if (buckets.size >= MAX_BUCKETS) return denied(now + WINDOW_MS);
    }
    bucket = {count:0,resetAt:now+WINDOW_MS}; buckets.set(key,bucket);
  }
  if (bucket.count >= LIMIT) return denied(bucket.resetAt);
  bucket.count += 1; // await 前計數，並行請求與 Redis 故障仍受本機上限保護。
  if (isRedisRealtimeEnabled()) {
    try {
      const result = await getRedisPublisher().eval(SCRIPT,1,`watch:friends:invite-limit:${key}`,String(WINDOW_MS));
      if (!Array.isArray(result) || result.length !== 2) throw new Error("INVALID_LIMIT_RESULT");
      const count=Number(result[0]); const ttl=Number(result[1]);
      if (!Number.isSafeInteger(count) || count<1 || !Number.isFinite(ttl) || ttl<0) throw new Error("INVALID_LIMIT_RESULT");
      if(count>LIMIT) { bucket.count=LIMIT; bucket.resetAt=Math.max(bucket.resetAt,now+ttl); return denied(bucket.resetAt); }
    } catch { /* Redis 故障時沿用有界本機計數，不增加 DB 查詢。 */ }
  }
  return null;
}
