import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";

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
  reason: string;
}) {
  const userIds = Array.from(new Set(input.userIds.filter(Boolean)));
  if (userIds.length === 0) return;

  await runBestEffortPublish(input.label, async () => {
    await publishScopedWatchUpdates(userIds, input.reason);
  });
}
