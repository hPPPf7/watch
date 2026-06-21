import {
  publishScopedWatchUpdates,
  resolveWatchlistScopedTargets,
} from "@/server/realtime/watchUpdates";

export async function runBestEffortPublish(
  label: string,
  run: () => Promise<void>
) {
  try {
    await run();
  } catch (error) {
    console.error(`[${label}] publish failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function publishWatchUpdatesWithScopeFallback(input: {
  label: string;
  userIds: string[];
  mediaType: "movie" | "tv";
  tmdbId: number;
  reason: string;
}) {
  const userIds = Array.from(new Set(input.userIds.filter(Boolean)));
  if (userIds.length === 0) return;

  let targets: Awaited<ReturnType<typeof resolveWatchlistScopedTargets>> = userIds;
  try {
    targets = await resolveWatchlistScopedTargets({
      userIds,
      mediaType: input.mediaType,
      tmdbId: input.tmdbId,
    });
  } catch (error) {
    console.error(`[${input.label}] resolve scopes failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    targets = userIds.map((userId) => ({
      userId,
      revisionScopes: [
        { mediaType: "movie", isAnime: false },
        { mediaType: "tv", isAnime: false },
        { mediaType: "tv", isAnime: true },
      ],
    }));
  }

  await runBestEffortPublish(input.label, async () => {
    await publishScopedWatchUpdates(targets, input.reason);
  });
}
