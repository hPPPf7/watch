import { NextResponse } from "next/server";
import { auth } from "@/auth";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  title?: string;
  year?: string | null;
  releaseDate?: string | null;
  posterPath?: string | null;
  isAnime?: boolean;
  friendIds?: string[];
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
  const mediaType = body?.mediaType;
  const tmdbId = body?.tmdbId;
  const title = body?.title;
  const friendIds = Array.isArray(body?.friendIds) ? body!.friendIds : [];

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    !tmdbId ||
    !title ||
    friendIds.some((id) => typeof id !== "string" || !id)
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
