import { NextResponse } from "next/server";
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { tmdbCache, watchlistTvStates } from "@/server/db/schema";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";
import { writeTmdbCache } from "@/server/tmdb/cache";

const TV_STATE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

// 每次清理完寫回一筆執行摘要（同一顆 Neon），讓維運可以在本機用
// `npm run cron:status` 直接確認 Vercel cron 是否正常運作，
// 不需要登入 Vercel 後台；一般使用者沒有任何入口看得到。
export const CLEANUP_STATUS_KEY = "watch:cron:tmdb-cache-cleanup:last-run";
const CLEANUP_STATUS_TTL_MS = 40 * 24 * 60 * 60 * 1000;

const verifyCronAccess = (request: Request) => {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = request.headers.get("authorization");
  if (bearer === `Bearer ${expected}`) return true;
  const fromHeader = request.headers.get("x-cron-secret");
  return fromHeader === expected;
};

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "CRON_SECRET is required" },
      { status: 500 },
    );
  }
  if (!verifyCronAccess(request)) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Invalid cron secret" },
      { status: 401 },
    );
  }

  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 },
    );
  }

  const now = new Date();
  const deleted = await db
    .delete(tmdbCache)
    .where(lt(tmdbCache.expiresAt, now))
    .returning({ key: tmdbCache.key });
  const staleBefore = new Date(now.getTime() - TV_STATE_MAX_AGE_MS);
  const cleanedTvStates = await db
    .update(watchlistTvStates)
    .set({
      lastTotalAired: null,
      alertActive: false,
      alertStartedAt: null,
      alertGeneration: null,
      alertAcknowledgedGeneration: null,
      firstReleaseAlertState: sql<string | null>`CASE
        WHEN ${watchlistTvStates.firstReleaseAlertState} = 'active'
        THEN 'acknowledged'
        ELSE ${watchlistTvStates.firstReleaseAlertState}
      END`,
      nextEpisodeSeason: null,
      nextEpisodeNumber: null,
      nextEpisodeName: null,
      nextEpisodeAirDate: null,
      tmdbMetadataFetchedAt: null,
      checkedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        sql`COALESCE(
          ${watchlistTvStates.tmdbMetadataFetchedAt},
          ${watchlistTvStates.createdAt},
          '-infinity'::timestamptz
        ) < ${staleBefore}`,
        or(
          isNotNull(watchlistTvStates.lastTotalAired),
          eq(watchlistTvStates.alertActive, true),
          isNotNull(watchlistTvStates.alertGeneration),
          isNotNull(watchlistTvStates.alertAcknowledgedGeneration),
          isNotNull(watchlistTvStates.nextEpisodeSeason),
          isNotNull(watchlistTvStates.nextEpisodeNumber),
          isNotNull(watchlistTvStates.nextEpisodeName),
          isNotNull(watchlistTvStates.nextEpisodeAirDate),
        ),
      ),
    )
    .returning({
      id: watchlistTvStates.id,
      userId: watchlistTvStates.userId,
    });

  // 清理直接改了 tv_states 欄位（屬於 revision 簽章的一部分），不發通知
  // 的話，受影響使用者要等 revision 快取 TTL 過期才會看到變化。
  // 注意：這個 cron 跑在 Vercel 那份部署上，若該環境沒設 REDIS_URL，
  // publish 只會寫入 Neon 的 latest record（Redis KV 與 pub/sub 皆 no-op），
  // Redis 模式下的即時性仍由 revision TTL 兜底。
  const affectedUserIds = Array.from(
    new Set(cleanedTvStates.map((state) => state.userId)),
  );
  // publishScopedWatchUpdates 會把整批做成單一多列 upsert，每個使用者約 4 個
  // bind 參數；Postgres 上限 65535，超過約 16k 使用者就會整批失敗（雖然
  // publish 內部會吞例外、退回 TTL 兜底，但整批通知就都沒送出）。180 天清理
  // 首次執行有可能一次掃到大量休眠 state，因此分批送出。
  const PUBLISH_CHUNK = 500;
  for (let i = 0; i < affectedUserIds.length; i += PUBLISH_CHUNK) {
    await publishScopedWatchUpdates(
      affectedUserIds.slice(i, i + PUBLISH_CHUNK),
      "tv_state_metadata_cleanup",
    );
  }

  const summary = {
    ok: true,
    deleted: deleted.length,
    staleTvStatesCleaned: cleanedTvStates.length,
    affectedUsers: affectedUserIds.length,
    cleanedAt: now.toISOString(),
  };

  // best-effort：摘要寫入失敗不影響清理本身的回應。這筆是維運用的執行
  // 摘要、不是 TMDB 快取，只借用同一張 Neon 表存 key-value；跳過 Redis
  // 鏡像（skipRedisMirror），因為 npm run cron:status 只讀 Neon，鏡像
  // 進 Redis 不會被用到，白白多佔 tmdb-cache: 命名空間跟指令額度。
  await writeTmdbCache(CLEANUP_STATUS_KEY, summary, CLEANUP_STATUS_TTL_MS, {
    skipRedisMirror: true,
  });

  return NextResponse.json(summary);
}
