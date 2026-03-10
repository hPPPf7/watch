import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { profiles } from "@/server/db/schema";
import { isUuidString } from "@/lib/uuid";

type Body = {
  ids?: string[];
};

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const ids = Array.isArray(body?.ids)
    ? Array.from(
        new Set(
          body!.ids.filter(
            (id): id is string => typeof id === "string" && isUuidString(id),
          ),
        ),
      )
    : [];

  if (Array.isArray(body?.ids) && body.ids.length > 0 && ids.length === 0) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid ids" },
      { status: 400 },
    );
  }

  if (ids.length === 0) {
    return NextResponse.json({ rows: [] as Array<{ id: string; nickname: string | null; avatar_url: string | null }> });
  }

  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  const rows = await db
    .select({
      id: profiles.id,
      nickname: profiles.nickname,
      avatar_url: profiles.avatarUrl,
    })
    .from(profiles)
    .where(inArray(profiles.id, ids));

  return NextResponse.json({ rows });
}
