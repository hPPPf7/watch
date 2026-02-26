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

  try {
    const data = await getProfileMe({
      userId: session.user.id,
      email: session.user.email,
      metadata: session.user.user_metadata,
    });
    return NextResponse.json(data);
  } catch (error) {
    return apiError(500, {
      code: "PROFILE_READ_FAILED",
      message: "Failed to read profile",
      details: error instanceof Error ? error.message : String(error),
    });
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
      details: message,
    });
  }
}

