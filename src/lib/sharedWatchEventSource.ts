type Listener = Pick<EventSource, "onopen" | "onmessage" | "onerror"> & { close: () => void };
let source: EventSource | null = null;
let connected = false;
let latestUpdate: MessageEvent<string> | null = null;
const listeners = new Set<Listener>();

// One connection per active tab, shared by the header, page and detail dialog.
export function openWatchEventSource(): Listener {
  const listener: Listener = {
    onopen: null, onmessage: null, onerror: null,
    close() {
      listeners.delete(listener);
      if (listeners.size === 0) {
        source?.close();
        source = null;
        connected = false;
        latestUpdate = null;
      }
    },
  };
  listeners.add(listener);
  if (!source) {
    source = new EventSource("/api/events/watchlist/stream");
    source.onopen = event => {
      connected = true;
      for (const item of listeners) item.onopen?.call(source!, event);
    };
    source.onmessage = event => {
      try {
        if (JSON.parse(event.data)?.type === "watchlist_update") latestUpdate = event;
      } catch { /* Consumers also ignore malformed messages. */ }
      for (const item of listeners) item.onmessage?.call(source!, event);
    };
    source.onerror = event => {
      connected = false;
      for (const item of listeners) item.onerror?.call(source!, event);
    };
  } else if (connected) {
    queueMicrotask(() => {
      if (source && connected && listeners.has(listener)) {
        listener.onopen?.call(source, new Event("open"));
        if (latestUpdate && listeners.has(listener)) listener.onmessage?.call(source, latestUpdate);
      }
    });
  }
  return listener;
}
