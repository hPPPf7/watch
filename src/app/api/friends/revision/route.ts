import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readFriendRevision } from "@/server/realtime/watchUpdates";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 },
    );
  }

  try {
    const revision = (await readFriendRevision(userId)) ?? "0";
    return NextResponse.json({ revision });
  } catch (error) {
    console.error("[friends/revision] failed", {
      userId,
      error,
    });
    return NextResponse.json(
      { code: "FRIENDS_REVISION_FAILED", message: "Failed to load friends revision" },
      { status: 500 },
    );
  }
}
