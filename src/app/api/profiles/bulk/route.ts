import { NextResponse } from "next/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { auth } from "@/auth";
import { getAuthDb, getDb } from "@/server/db/client";
import {
  friendRequests,
  friends,
  profiles,
  watchHistoryShares,
} from "@/server/db/schema";
import { MAX_PROFILE_BULK_IDS } from "@/lib/profileBulk";
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
  const rawIds = Array.isArray(body?.ids)
    ? body.ids.filter((id): id is string => typeof id === "string")
    : [];
  const hasInvalidIds =
    Array.isArray(body?.ids) &&
    (body.ids.some((id) => typeof id !== "string") ||
      rawIds.some((id) => !isUuidString(id)));
  if (hasInvalidIds) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid ids" },
      { status: 400 },
    );
  }

  const ids = Array.from(new Set(rawIds));
  if (ids.length > MAX_PROFILE_BULK_IDS) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Too many ids" },
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
    .select({ friendId: friends.friendId })
    .from(friends)
    .where(
      and(
        eq(friends.projectId, "watch"),
        eq(friends.userId, session.user.id),
        inArray(friends.friendId, ids),
      ),
    );
  const friendIds = rows.map((row) => row.friendId);

  const requestRows = await db
    .select({
      fromUserId: friendRequests.fromUserId,
      toUserId: friendRequests.toUserId,
    })
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.projectId, "watch"),
        eq(friendRequests.status, "pending"),
        or(
          and(
            eq(friendRequests.fromUserId, session.user.id),
            inArray(friendRequests.toUserId, ids),
          ),
          and(
            eq(friendRequests.toUserId, session.user.id),
            inArray(friendRequests.fromUserId, ids),
          ),
        ),
      ),
    );

  const shareRows = await db
    .select({
      ownerId: watchHistoryShares.ownerId,
      targetUserId: watchHistoryShares.targetUserId,
    })
    .from(watchHistoryShares)
    .where(
      and(
        eq(watchHistoryShares.projectId, "watch"),
        or(
          and(
            eq(watchHistoryShares.ownerId, session.user.id),
            inArray(watchHistoryShares.targetUserId, ids),
          ),
          and(
            eq(watchHistoryShares.targetUserId, session.user.id),
            inArray(watchHistoryShares.ownerId, ids),
          ),
        ),
      ),
    );

  const visibleIds = new Set<string>([
    session.user.id,
    ...friendIds,
    ...requestRows.flatMap((row) => [row.fromUserId, row.toUserId]),
    ...shareRows.flatMap((row) => [row.ownerId, row.targetUserId]),
  ]);

  const visibleRequestIds = ids.filter((id) => visibleIds.has(id));

  if (visibleRequestIds.length === 0) {
    return NextResponse.json({ rows: [] as Array<{ id: string; nickname: string | null; avatar_url: string | null }> });
  }

  let authDb;
  try {
    authDb = getAuthDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "AUTH_DATABASE_URL is required" },
      { status: 500 },
    );
  }

  const profileRows = await authDb
    .select({
      id: profiles.id,
      nickname: profiles.nickname,
      avatar_url: profiles.avatarUrl,
    })
    .from(profiles)
    .where(inArray(profiles.id, visibleRequestIds));

  return NextResponse.json({ rows: profileRows });
}
