import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { FriendServiceError } from "@/server/services/friendService";

type ErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

export async function requireViewerId() {
  const session = await auth();
  const viewerId = session?.user?.id;
  if (!viewerId) return null;
  return {
    viewerId,
    viewerMetadata: session.user.user_metadata,
  };
}

export function apiError(status: number, body: ErrorBody) {
  return NextResponse.json(body, { status });
}

export function handleFriendServiceError(error: unknown) {
  if (error instanceof FriendServiceError) {
    return apiError(error.status, { code: error.code, message: error.message });
  }
  if (error instanceof Error && error.message === "DATABASE_URL_MISSING") {
    return apiError(500, {
      code: "CONFIG_MISSING",
      message: "DATABASE_URL is required for friends APIs",
    });
  }
  return apiError(500, {
    code: "INTERNAL_ERROR",
    message: "Unexpected error",
    details: error instanceof Error ? error.message : String(error),
  });
}

