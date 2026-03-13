import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { friends } from "@/server/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
    );
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

  try {
    const rows = await db
      .select({
        friend_id: friends.friendId,
        friend_nickname: friends.friendNickname,
      })
      .from(friends)
      .where(
        and(eq(friends.userId, session.user.id), eq(friends.projectId, "watch"))
      )
      .orderBy(desc(friends.createdAt));

    return NextResponse.json({ rows });
  } catch (error) {
    console.error("[detail/friends] failed", { userId: session.user.id, error });
    return NextResponse.json(
      { code: "FRIENDS_LOAD_FAILED", message: "Failed to load friends" },
      { status: 500 },
    );
  }
}
