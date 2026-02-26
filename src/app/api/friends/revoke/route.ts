import { NextResponse } from "next/server";
import { revokeOutgoingFriendRequest } from "@/server/services/friendService";
import { apiError, handleFriendServiceError, requireViewerId } from "@/app/api/friends/_lib";

export async function POST(request: Request) {
  const context = await requireViewerId();
  if (!context) {
    return apiError(401, { code: "UNAUTHORIZED", message: "Not signed in" });
  }

  const body = (await request.json().catch(() => null)) as
    | { requestId?: string }
    | null;
  if (!body?.requestId) {
    return apiError(400, { code: "BAD_REQUEST", message: "requestId is required" });
  }

  try {
    await revokeOutgoingFriendRequest({
      viewerId: context.viewerId,
      requestId: body.requestId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleFriendServiceError(error);
  }
}

