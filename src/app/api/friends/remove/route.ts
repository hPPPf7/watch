import { NextResponse } from "next/server";
import { removeFriend } from "@/server/services/friendService";
import { apiError, handleFriendServiceError, requireViewerId } from "@/app/api/friends/_lib";

export async function POST(request: Request) {
  const context = await requireViewerId();
  if (!context) {
    return apiError(401, { code: "UNAUTHORIZED", message: "Not signed in" });
  }

  const body = (await request.json().catch(() => null)) as
    | { targetUserId?: string }
    | null;
  if (!body?.targetUserId) {
    return apiError(400, {
      code: "BAD_REQUEST",
      message: "targetUserId is required",
    });
  }

  try {
    await removeFriend({
      viewerId: context.viewerId,
      targetUserId: body.targetUserId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleFriendServiceError(error);
  }
}

