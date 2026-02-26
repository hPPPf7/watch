import { NextResponse } from "next/server";
import { lt } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { tmdbCache } from "@/server/db/schema";

const verifyCronAccess = (request: Request) => {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  const bearer = request.headers.get("authorization");
  if (bearer === `Bearer ${expected}`) return true;
  const fromHeader = request.headers.get("x-cron-secret");
  return fromHeader === expected;
};

export async function GET(request: Request) {
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

  return NextResponse.json({
    ok: true,
    deleted: deleted.length,
    cleanedAt: now.toISOString(),
  });
}
