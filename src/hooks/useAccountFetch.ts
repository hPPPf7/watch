"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

// AuthProvider remounts account-owned views on an identity change.
// Cancel their reads and prevent old async actions from sending another write.
export default function useAccountFetch() {
  const lifetime = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  return useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const owner = lifetime.current;
    if (!owner || owner.signal.aborted) throw new DOMException("Account view closed", "AbortError");
    const signal = init?.signal
      ? AbortSignal.any([owner.signal, init.signal])
      : owner.signal;
    const response = await globalThis.fetch(input, { ...init, signal });
    owner.signal.throwIfAborted();
    const readJson = response.json.bind(response);
    response.json = async () => {
      const payload = await readJson();
      owner.signal.throwIfAborted();
      return payload;
    };
    return response;
  }, []);
}
