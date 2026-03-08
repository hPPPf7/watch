import { auth } from "@/auth";
import { readLatestWatchUpdate } from "@/server/realtime/watchUpdates";

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
  let poller: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let lastNonce: string | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // 串流可能已經關閉。
        }
      };

      enqueue(toSseData({ type: "connected", at: Date.now() }));
      const poll = async () => {
        if (closed) return;
        try {
          const record = await readLatestWatchUpdate(userId);
          if (!record) return;
          if (record.nonce === lastNonce) return;
          lastNonce = record.nonce;
          enqueue(
            toSseData({
              type: "watchlist_update",
              reason: record.reason,
              at: record.at,
            })
          );
        } catch {
          // 暫時性的資料庫錯誤先忽略，下一次輪詢會再重試。
        }
      };
      void poll();
      poller = setInterval(() => {
        void poll();
      }, 2000);

      heartbeat = setInterval(() => {
        enqueue(encoder.encode(": ping\n\n"));
      }, 25000);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (poller) clearInterval(poller);
      heartbeat = null;
      poller = null;
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
