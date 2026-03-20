import { auth } from "@/auth";
import {
  getFriendNoticeTransportMode,
  subscribeToFriendNoticeEvents,
  type FriendNoticeEvent,
} from "@/server/realtime/friendNoticeEventBus";

export const runtime = "nodejs";

const encoder = new TextEncoder();

const toSseData = (payload: unknown) =>
  encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

async function resolveUserId() {
  const session = await auth();
  const userId = session?.user?.id;
  return userId ?? null;
}

export async function HEAD() {
  const userId = await resolveUserId();
  if (!userId) {
    return new Response(null, { status: 401 });
  }

  if (getFriendNoticeTransportMode() !== "redis") {
    return new Response(null, { status: 409 });
  }

  return new Response(null, { status: 200 });
}

export async function GET(request: Request) {
  const userId = await resolveUserId();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (getFriendNoticeTransportMode() !== "redis") {
    return new Response("Friend realtime unavailable", { status: 503 });
  }

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribeTransport: (() => void | Promise<void>) | null = null;
  let closed = false;
  let emitEvent:
    | ((event: FriendNoticeEvent | { reason: "bootstrap"; at: number }) => void)
    | null = null;
  const pendingEvents: Array<
    FriendNoticeEvent | { reason: "bootstrap"; at: number }
  > = [];

  const forwardEvent = (
    event: FriendNoticeEvent | { reason: "bootstrap"; at: number },
  ) => {
    if (emitEvent) {
      emitEvent(event);
      return;
    }
    pendingEvents.push(event);
  };

  try {
    unsubscribeTransport = await subscribeToFriendNoticeEvents(userId, (event) => {
      if (closed) return;
      forwardEvent(event);
    });
  } catch {
    return new Response("Friend realtime subscribe failed", { status: 503 });
  }

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

      emitEvent = (event) => {
        if (closed) return;
        enqueue(
          toSseData({
            type: "friend_notice_update",
            reason: event.reason,
            at: event.at,
          }),
        );
      };

      enqueue(toSseData({ type: "connected", at: Date.now() }));
      forwardEvent({ reason: "bootstrap", at: Date.now() });
      while (pendingEvents.length > 0) {
        const next = pendingEvents.shift();
        if (!next) continue;
        emitEvent(next);
      }

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
