import { getRedisPublisher, isRedisRealtimeEnabled } from "@/server/realtime/redis";
const TTL = 6 * 3600000;
const MAX_ENTRIES = 5000;
const deadlines = new Map<string, number>();

// 只在伺服器已證實季摘要／清單不一致時使用，不為正常快取命中新增 Redis 或 Neon 工作。
export async function claimSeasonRepair(id: string, season: string) {
  const now = Date.now();
  for (const [key, deadline] of deadlines) if (deadline <= now) deadlines.delete(key);
  const key = `watch:season-repair:${id}:${season}`;
  if (deadlines.has(key) || deadlines.size >= MAX_ENTRIES) return false;
  deadlines.set(key, now + TTL); // 在 await 前保留名額，Redis 故障時也有本機冷卻。
  if (!isRedisRealtimeEnabled()) return true;
  try {
    return await getRedisPublisher().set(key,"1","PX",TTL,"NX") === "OK";
  } catch {
    return true; // 每個 instance 的有界後備；不新增 Neon 查詢。
  }
}
