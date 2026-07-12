// 查詢 Vercel cron（TMDB 快取清理）最近一次執行摘要。
// 資料來源是正式站共用的 Neon `tmdb_cache` 表，因此不需要登入 Vercel；
// 這是純本機維運工具，網站上沒有任何入口，一般使用者看不到。
//
// 用法：npm run cron:status
// 結束碼：0 正常、1 缺設定、2 距上次執行超過 26 小時（cron 可能失效）。
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { neon } from "@neondatabase/serverless";

const STATUS_KEY = "watch:cron:tmdb-cache-cleanup:last-run";
const STALE_WARN_MS = 26 * 60 * 60 * 1000;

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.resolve(".env.local");
  if (!fs.existsSync(envPath)) return "";
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (match) {
      return match[1].replace(/^["']|["']$/g, "");
    }
  }
  return "";
}

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  console.error("找不到 DATABASE_URL（環境變數或 .env.local 皆無）。");
  process.exit(1);
}

const sql = neon(databaseUrl);
const rows = await sql`
  SELECT payload, updated_at
  FROM tmdb_cache
  WHERE key = ${STATUS_KEY}
  LIMIT 1
`;

if (rows.length === 0) {
  console.log(
    "尚無清理紀錄：cron 可能還沒跑過，或正式站尚未部署會寫入摘要的版本。",
  );
  process.exit(0);
}

const payload = rows[0].payload ?? {};
const cleanedAt = new Date(payload.cleanedAt ?? rows[0].updated_at);
const ageMs = Date.now() - cleanedAt.getTime();
const ageHours = ageMs / (60 * 60 * 1000);

console.log("=== TMDB 快取清理（Vercel cron）最近一次執行 ===");
console.log(`執行時間：${cleanedAt.toISOString()}（約 ${ageHours.toFixed(1)} 小時前）`);
console.log(`刪除過期快取：${payload.deleted ?? "?"} 筆`);
console.log(`重設 stale tv_states：${payload.staleTvStatesCleaned ?? "?"} 筆`);
console.log(`發出清理通知的使用者數：${payload.affectedUsers ?? 0}`);

if (ageMs > STALE_WARN_MS) {
  console.warn("警告：距上次執行超過 26 小時，Vercel cron 可能沒有正常運作。");
  process.exitCode = 2;
}
