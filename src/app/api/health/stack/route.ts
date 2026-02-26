import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  friendRequests,
  friends,
  profiles,
  tmdbCache,
  watchHistory,
  watchlistItems,
} from "@/server/db/schema";

type Status = "ok" | "warning" | "error";

type CheckItem = {
  key: string;
  category: "connection" | "feature";
  source: "auth" | "neon" | "tmdb" | "runtime";
  label: string;
  status: Status;
  rule: string;
  detail: string;
};

export async function GET() {
  const checks: CheckItem[] = [];
  const maskUserId = (value: string) =>
    value.length <= 8 ? "****" : `${value.slice(0, 4)}...${value.slice(-4)}`;

  const hasAuthSecret = Boolean(process.env.AUTH_SECRET);
  checks.push({
    key: "auth_secret",
    category: "connection",
    source: "auth",
    label: "Auth.js 密鑰（AUTH_SECRET）",
    status: hasAuthSecret ? "ok" : "warning",
    rule: "檢查 AUTH_SECRET 是否存在",
    detail: hasAuthSecret ? "已設定 AUTH_SECRET。" : "未設定 AUTH_SECRET。",
  });

  const hasGoogleEnv = Boolean(
    process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
  );
  checks.push({
    key: "auth_google",
    category: "connection",
    source: "auth",
    label: "Google OAuth（AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET）",
    status: hasGoogleEnv ? "ok" : "warning",
    rule: "檢查 AUTH_GOOGLE_ID 與 AUTH_GOOGLE_SECRET 是否存在",
    detail: hasGoogleEnv
      ? "Google OAuth 環境變數已設定。"
      : "缺少 AUTH_GOOGLE_ID 或 AUTH_GOOGLE_SECRET。",
  });

  const session = await auth();
  checks.push({
    key: "auth_session",
    category: "feature",
    source: "auth",
    label: "登入工作階段（Auth.js Session）",
    status: session?.user?.id ? "ok" : "warning",
    rule: "呼叫 auth()，若可取得 session.user.id 則視為正常",
    detail: session?.user?.id
      ? `目前已登入，userId=${maskUserId(session.user.id)}。`
      : "目前未登入，無法驗證使用者範圍功能。",
  });

  const hasTmdbKey = Boolean(process.env.TMDB_API_KEY);
  checks.push({
    key: "tmdb_env",
    category: "connection",
    source: "tmdb",
    label: "TMDB 金鑰（TMDB_API_KEY）",
    status: hasTmdbKey ? "ok" : "warning",
    rule: "檢查 TMDB_API_KEY 是否存在",
    detail: hasTmdbKey
      ? "已設定 TMDB_API_KEY。"
      : "未設定 TMDB_API_KEY，TMDB 功能可能受限。",
  });

  const databaseUrl = process.env.DATABASE_URL;
  let dbReady = false;
  let db: ReturnType<typeof getDb> | null = null;

  if (!databaseUrl) {
    checks.push({
      key: "neon_db",
      category: "connection",
      source: "neon",
      label: "Neon 資料庫（Neon Database）",
      status: "warning",
      rule: "檢查 DATABASE_URL 是否存在，並嘗試連線",
      detail: "未設定 DATABASE_URL。",
    });
  } else {
    try {
      const sql = neon(databaseUrl);
      await sql`select 1 as ok`;
      db = getDb();
      dbReady = true;
      checks.push({
        key: "neon_db",
        category: "connection",
        source: "neon",
        label: "Neon 資料庫（Neon Database）",
        status: "ok",
        rule: "檢查 DATABASE_URL 是否存在，並嘗試連線",
        detail: "資料庫連線正常。",
      });
    } catch (error) {
      checks.push({
        key: "neon_db",
        category: "connection",
        source: "neon",
        label: "Neon 資料庫（Neon Database）",
        status: "error",
        rule: "檢查 DATABASE_URL 是否存在，並嘗試連線",
        detail: `資料庫連線失敗：${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  if (dbReady && db) {
    try {
      await db.select({ id: profiles.id }).from(profiles).limit(1);
      checks.push({
        key: "table_profiles",
        category: "feature",
        source: "neon",
        label: "個人資料表（profiles）",
        status: "ok",
        rule: "執行 select profiles limit 1",
        detail: "可正常讀取 profiles。",
      });
    } catch (error) {
      checks.push({
        key: "table_profiles",
        category: "feature",
        source: "neon",
        label: "個人資料表（profiles）",
        status: "error",
        rule: "執行 select profiles limit 1",
        detail: `讀取失敗：${error instanceof Error ? error.message : String(error)}`,
      });
    }

    try {
      await db.select({ id: watchlistItems.id }).from(watchlistItems).limit(1);
      checks.push({
        key: "table_watchlist_items",
        category: "feature",
        source: "neon",
        label: "片單資料表（watchlist_items）",
        status: "ok",
        rule: "執行 select watchlist_items limit 1",
        detail: "可正常讀取 watchlist_items。",
      });
    } catch (error) {
      checks.push({
        key: "table_watchlist_items",
        category: "feature",
        source: "neon",
        label: "片單資料表（watchlist_items）",
        status: "error",
        rule: "執行 select watchlist_items limit 1",
        detail: `讀取失敗：${error instanceof Error ? error.message : String(error)}`,
      });
    }

    try {
      await db.select({ id: watchHistory.id }).from(watchHistory).limit(1);
      checks.push({
        key: "table_watch_history",
        category: "feature",
        source: "neon",
        label: "觀看紀錄表（watch_history）",
        status: "ok",
        rule: "執行 select watch_history limit 1",
        detail: "可正常讀取 watch_history。",
      });
    } catch (error) {
      checks.push({
        key: "table_watch_history",
        category: "feature",
        source: "neon",
        label: "觀看紀錄表（watch_history）",
        status: "error",
        rule: "執行 select watch_history limit 1",
        detail: `讀取失敗：${error instanceof Error ? error.message : String(error)}`,
      });
    }

    try {
      await db.select({ id: friends.id }).from(friends).limit(1);
      await db.select({ id: friendRequests.id }).from(friendRequests).limit(1);
      checks.push({
        key: "table_friends",
        category: "feature",
        source: "neon",
        label: "好友資料表（friends / friend_requests）",
        status: "ok",
        rule: "執行 select friends limit 1 與 select friend_requests limit 1",
        detail: "可正常讀取 friends 與 friend_requests。",
      });
    } catch (error) {
      checks.push({
        key: "table_friends",
        category: "feature",
        source: "neon",
        label: "好友資料表（friends / friend_requests）",
        status: "error",
        rule: "執行 select friends limit 1 與 select friend_requests limit 1",
        detail: `讀取失敗：${error instanceof Error ? error.message : String(error)}`,
      });
    }

    try {
      await db.select({ key: tmdbCache.key }).from(tmdbCache).limit(1);
      checks.push({
        key: "table_tmdb_cache",
        category: "feature",
        source: "neon",
        label: "TMDB 快取表（tmdb_cache）",
        status: "ok",
        rule: "執行 select tmdb_cache limit 1",
        detail: "可正常讀取 tmdb_cache。",
      });
    } catch (error) {
      checks.push({
        key: "table_tmdb_cache",
        category: "feature",
        source: "neon",
        label: "TMDB 快取表（tmdb_cache）",
        status: "error",
        rule: "執行 select tmdb_cache limit 1",
        detail: `讀取失敗：${error instanceof Error ? error.message : String(error)}`,
      });
    }

    if (session?.user?.id) {
      try {
        await db
          .select({ id: watchlistItems.id })
          .from(watchlistItems)
          .where(eq(watchlistItems.userId, session.user.id))
          .limit(1);
        checks.push({
          key: "feature_watchlist_query",
          category: "feature",
          source: "neon",
          label: "片單使用者查詢（watchlist user scope）",
          status: "ok",
          rule: "已登入時，執行 where user_id = session.user.id 的查詢",
          detail: "目前使用者範圍查詢正常。",
        });
      } catch (error) {
        checks.push({
          key: "feature_watchlist_query",
          category: "feature",
          source: "neon",
          label: "片單使用者查詢（watchlist user scope）",
          status: "error",
          rule: "已登入時，執行 where user_id = session.user.id 的查詢",
          detail: `查詢失敗：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } else {
      checks.push({
        key: "feature_watchlist_query",
        category: "feature",
        source: "neon",
        label: "片單使用者查詢（watchlist user scope）",
        status: "warning",
        rule: "此項需登入後才能驗證",
        detail: "尚未登入，已略過此檢查。",
      });
    }
  } else {
    checks.push({
      key: "db_feature_checks",
      category: "feature",
      source: "neon",
      label: "資料庫功能檢查（database feature checks）",
      status: "warning",
      rule: "需先通過 Neon 連線檢查後才能執行",
      detail: "資料庫連線尚未就緒，已略過資料表與功能檢查。",
    });
  }

  const onVercel = process.env.VERCEL === "1";
  checks.push({
    key: "vercel_runtime",
    category: "connection",
    source: "runtime",
    label: "部署環境（Vercel Runtime）",
    status: onVercel ? "ok" : "warning",
    rule: "檢查 process.env.VERCEL 是否為 1",
    detail: onVercel
      ? `目前在 Vercel 執行（${process.env.VERCEL_URL ?? "unknown host"}）。`
      : "目前不是 Vercel 執行環境（通常是本機開發）。",
  });

  const hasError = checks.some((item) => item.status === "error");
  const hasWarning = checks.some((item) => item.status === "warning");

  return NextResponse.json({
    overall: hasError ? "error" : hasWarning ? "warning" : "ok",
    generatedAt: new Date().toISOString(),
    checks,
  });
}
