import { auth } from "@/auth";
import {
  getWatchUpdateTransportMode,
  subscribeToWatchUpdateEvents,
} from "@/server/realtime/watchEventBus";
import { readLatestWatchUpdate } from "@/server/realtime/watchUpdates";
import { subscribeToSharedWatchUpdatePoller } from "@/server/realtime/watchUpdatePoller";

export const runtime = "nodejs";

const encoder = new TextEncoder();

const toSseData = (payload: unknown) =>
  encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribeTransport: (() => void | Promise<void>) | null = null;
  let closed = false;
  let lastDeliveredUpdateKey: string | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (unsubscribeTransport) {
          void unsubscribeTransport();
        }
        heartbeat = null;
        unsubscribeTransport = null;
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // Ignore controller close failures on already-closed streams.
        }
      };

      const enqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // Ignore enqueue failures after the connection is closed.
        }
      };

      const toUpdateKey = (record: {
        reason: string;
        at: number;
        nonce?: string;
      }) => record.nonce ?? `${record.reason}:${record.at}`;

      const emitUpdate = (record: {
        reason: string;
        at: number;
        nonce?: string;
      }) => {
        if (closed) return;
        const updateKey = toUpdateKey(record);
        if (lastDeliveredUpdateKey === updateKey) return;
        lastDeliveredUpdateKey = updateKey;
        enqueue(
          toSseData({
            type: "watchlist_update",
            reason: record.reason,
            at: record.at,
          }),
        );
      };

      const subscribeWithFallback = async () => {
        if (getWatchUpdateTransportMode() === "redis") {
          try {
            const unsubscribe = await subscribeToWatchUpdateEvents(
              userId,
              emitUpdate,
            );
            if (closed) {
              void unsubscribe();
              return;
            }
            unsubscribeTransport = unsubscribe;
            const latestRecord = await readLatestWatchUpdate(userId).catch(() => null);
            if (closed) {
              void unsubscribe();
              return;
            }
            if (latestRecord) {
              emitUpdate(latestRecord);
            }
            return;
          } catch {
            // Fall through to the shared DB poller if Redis is unavailable.
          }
        }

        const unsubscribe = subscribeToSharedWatchUpdatePoller(
          userId,
          emitUpdate,
        );
        if (closed) {
          unsubscribe();
          return;
        }
        unsubscribeTransport = unsubscribe;
      };

      enqueue(toSseData({ type: "connected", at: Date.now() }));
      void subscribeWithFallback();

      heartbeat = setInterval(() => {
        enqueue(encoder.encode(": ping\n\n"));
      }, 25000);

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribeTransport) {
        void unsubscribeTransport();
      }
      heartbeat = null;
      unsubscribeTransport = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
