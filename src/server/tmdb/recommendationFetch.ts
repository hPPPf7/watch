import { NextResponse } from "next/server";
import { getRedisPublisher, isRedisRealtimeEnabled } from "@/server/realtime/redis";

type Cooldown = { until: number; status: 429 | 502 };
const REDIS_KEY = "watch:tmdb:recommendations:cooldown";
let cooldown: Cooldown | null = null;
let sharedCheck: Promise<void> | null = null;
// 原子比較期限，其他 instance 的短暫錯誤不可縮短已收到的 Retry-After。
const EXTEND_COOLDOWN = `
local old = redis.call('GET', KEYS[1])
local incoming = cjson.decode(ARGV[1])
if old then
  local ok, previous = pcall(cjson.decode, old)
  if ok and tonumber(previous["until"]) and tonumber(previous["until"]) >= tonumber(incoming["until"]) then return old end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return ARGV[1]
`;

function mergeCooldown(value: unknown) {
  if (!value || typeof value !== "object") return;
  const next = value as Cooldown;
  if (!Number.isSafeInteger(next.until) || next.until <= Date.now() || (next.status !== 429 && next.status !== 502)) return;
  if (!cooldown || next.until > cooldown.until) cooldown = next;
}

class RecommendationCooldownError extends Error {
  constructor(readonly state: Cooldown) { super("TMDB_RECOMMENDATIONS_COOLDOWN"); }
}
function assertLocalAvailability() {
  if (cooldown && cooldown.until > Date.now()) throw new RecommendationCooldownError(cooldown);
}

/** 只在推薦快取 miss 時使用；跨使用者與三種推薦共用。無輪詢、無 Neon 寫入。 */
export async function assertRecommendationsAvailable() {
  assertLocalAvailability();
  if (isRedisRealtimeEnabled()) {
    if (!sharedCheck) {
      sharedCheck = (async () => {
        try {
          const raw = await getRedisPublisher().get(REDIS_KEY);
          if (raw) mergeCooldown(JSON.parse(raw));
        } catch { /* Redis 暫時故障時，仍保留本機 cooldown。 */ }
        finally { sharedCheck = null; }
      })();
    }
    await sharedCheck;
  }
  assertLocalAvailability();
}

function retryDelay(value: string | null, fallback: number) {
  if (!value) return fallback;
  const delay = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  // 不縮短合法的 Retry-After；不合法或已過去的日期使用預設冷卻。
  return Number.isSafeInteger(delay) && delay >= 0 && Number.isSafeInteger(Date.now() + delay)
    ? Math.max(1000, delay) : fallback;
}

async function fail(status: 429 | 502, retryAfter: string | null = null): Promise<never> {
  const next = { until: Date.now() + retryDelay(retryAfter, status === 429 ? 60_000 : 15_000), status };
  mergeCooldown(next); // 先停止同 instance 的其他分頁，不等 Redis 網路完成。
  if (isRedisRealtimeEnabled()) {
    try {
      const raw = await getRedisPublisher().eval(EXTEND_COOLDOWN, 1, REDIS_KEY, JSON.stringify(next), String(next.until - Date.now()));
      if (typeof raw === "string") mergeCooldown(JSON.parse(raw));
    } catch { /* 跨 instance 協調不可讓正常功能依賴 Redis 可用性。 */ }
  }
  throw new RecommendationCooldownError(cooldown ?? next);
}

export async function fetchRecommendationJson<T>(url: string): Promise<T> {
  await assertRecommendationsAvailable();
  let response: Response;
  try { response = await fetch(url); }
  catch { return fail(502); }
  if (!response.ok) {
    // 非成功內容不再使用，釋放連線；429 的狀態與等待時間必須保留。
    void response.body?.cancel().catch(() => undefined);
    return fail(response.status === 429 ? 429 : 502, response.headers.get("retry-after"));
  }
  try { return await response.json() as T; }
  catch { return fail(502); }
}

export function recommendationErrorResponse(error: unknown) {
  if (error instanceof RecommendationCooldownError) {
    const state = cooldown && cooldown.until > error.state.until ? cooldown : error.state;
    return NextResponse.json({ error: state.status === 429 ? "TMDB_RATE_LIMITED" : "TMDB_UPSTREAM_FAILED" }, {
      status: state.status,
      headers: { "Retry-After": String(Math.max(1, Math.ceil((state.until - Date.now()) / 1000))), "Cache-Control": "no-store" },
    });
  }
  return NextResponse.json({ error: "TMDB_UPSTREAM_FAILED" }, { status: 502 });
}
