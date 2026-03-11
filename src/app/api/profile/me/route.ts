import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProfileMe, updateNickname } from "@/server/services/profileService";

type ErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

function apiError(status: number, body: ErrorBody) {
  return NextResponse.json(body, { status });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return apiError(401, { code: "UNAUTHORIZED", message: "Not signed in" });
  }
  const metadata = session.user.user_metadata;
  const fallback = {
    id: session.user.id,
    email: session.user.email ?? null,
    nickname:
      metadata?.full_name ??
      metadata?.name ??
      metadata?.preferred_username ??
      null,
    avatarUrl:
      metadata?.avatar_url ??
      metadata?.picture ??
      metadata?.avatar ??
      null,
  };

  try {
    const data = await getProfileMe({
      userId: session.user.id,
      email: session.user.email,
      metadata,
    });
    return NextResponse.json(data);
  } catch (error) {
    console.warn("[profile/me] fallback due to read failure", {
      userId: session.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(fallback);
  }
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return apiError(401, { code: "UNAUTHORIZED", message: "Not signed in" });
  }

  const body = (await request.json().catch(() => null)) as
    | { nickname?: string }
    | null;
  if (!body?.nickname || typeof body.nickname !== "string") {
    return apiError(400, {
      code: "BAD_REQUEST",
      message: "nickname is required",
    });
  }

  try {
    const data = await updateNickname({
      userId: session.user.id,
      nickname: body.nickname,
    });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "INVALID_NICKNAME") {
      return apiError(400, {
        code: "INVALID_NICKNAME",
        message: "nickname cannot be empty",
      });
    }
    return apiError(500, {
      code: "PROFILE_UPDATE_FAILED",
      message: "Failed to update profile",
      ...(process.env.NODE_ENV !== "production" ? { details: message } : {}),
    });
  }
}
