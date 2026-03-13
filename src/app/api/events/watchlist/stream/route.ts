import { auth } from "@/auth";
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
  let unsubscribePoller: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (unsubscribePoller) unsubscribePoller();
        heartbeat = null;
        unsubscribePoller = null;
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // 串流可能已關閉。
        }
      };

      const enqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          // 串流可能已經關閉。
        }
      };

      enqueue(toSseData({ type: "connected", at: Date.now() }));
      // 這裡仍採輪詢 tmdb_cache 的做法，但改成同 user / 同 instance 共用一條 poller，
      // 避免同一時間多個分頁各自每 2 秒查一次資料庫。這不是完整 realtime，因為不同
      // instance 之間仍不共享記憶體；但在不引入 Redis / 外部 pubsub 的前提下，可以先把
      // 重複輪詢收斂成較少的資料庫讀取。
      //
      // 輪詢間隔同步微幅拉長到 3 秒，取捨是多一點點更新延遲，換較低的固定 DB 壓力。
      unsubscribePoller = subscribeToSharedWatchUpdatePoller(userId, (record) => {
        if (closed) return;
        enqueue(
          toSseData({
            type: "watchlist_update",
            reason: record.reason,
            at: record.at,
          }),
        );
      });

      heartbeat = setInterval(() => {
        enqueue(encoder.encode(": ping\n\n"));
      }, 25000);

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribePoller) unsubscribePoller();
      heartbeat = null;
      unsubscribePoller = null;
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
