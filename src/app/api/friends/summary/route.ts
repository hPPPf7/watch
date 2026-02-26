import { NextResponse } from "next/server";
import { getFriendSummary } from "@/server/services/friendService";
import { apiError, handleFriendServiceError, requireViewerId } from "@/app/api/friends/_lib";

export async function GET() {
  const context = await requireViewerId();
  if (!context) {
    return apiError(401, { code: "UNAUTHORIZED", message: "Not signed in" });
  }

  try {
    const data = await getFriendSummary(context.viewerId);
    return NextResponse.json(data);
  } catch (error) {
    return handleFriendServiceError(error);
  }
}

