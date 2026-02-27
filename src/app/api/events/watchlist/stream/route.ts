import { auth } from "@/auth";
import { subscribeWatchUpdates } from "@/server/realtime/watchUpdates";

export const runtime = "nodejs";

const encoder = new TextEncoder();

const toSseData = (payload: unknown) =>
  encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // Stream may already be closed.
        }
      };

      enqueue(toSseData({ type: "connected", at: Date.now() }));

      unsubscribe = subscribeWatchUpdates(userId, (event) => {
        enqueue(toSseData({ type: "watchlist_update", ...event }));
      });

      heartbeat = setInterval(() => {
        enqueue(encoder.encode(": ping\n\n"));
      }, 25000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      unsubscribe?.();
      unsubscribe = null;
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
