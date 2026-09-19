import { Readable } from "node:stream";
import { net } from "electron";

const toHeaders = (values) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(name, item);
    }
  }
  return headers;
};

// Electron fetch rejects manual redirects instead of exposing the 3xx response.
// Forward each redirect to Chromium so it keeps the final document URL/origin
// and applies the normal POST/GET redirect rules. Never replay an OAuth request.
export const forwardRequest = (url, { session, signal, body, ...options }) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("The request was aborted", "AbortError"));
      return;
    }
    const headers = new Headers(options.headers);
    const origin = headers.get("origin") ?? undefined;
    const credentials = options.credentials ?? "same-origin";
    const request = net.request({
      ...options,
      url,
      session,
      origin,
      // Match Electron session.fetch when Chromium omits the Origin header.
      credentials: credentials === "same-origin" && !origin ? "include" : credentials,
      redirect: "manual",
      bypassCustomProtocolHandlers: true,
    });
    let redirected = false;
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => {
      reject(signal.reason ?? new DOMException("The request was aborted", "AbortError"));
      request.abort();
      cleanup();
    };
    signal?.addEventListener("abort", abort, { once: true });
    request.on("redirect", (status, _method, location, values) => {
      try {
        const responseHeaders = toHeaders(values);
        responseHeaders.set("location", location);
        const response = new Response(null, { status, headers: responseHeaders });
        redirected = true;
        cleanup();
        resolve(response);
        // Not calling followRedirect deliberately cancels this upstream request.
        // Chromium receives the 3xx and performs the next navigation itself.
      } catch (error) { cleanup(); reject(error); }
    });
    request.on("response", (response) => {
      try {
        // ClientRequest is a Writable: its close can precede response headers.
        // Keep abort connected until the response finishes or is cancelled.
        response.once("end", cleanup);
        response.once("error", cleanup);
        response.once("close", cleanup);
        const noBody = options.method === "HEAD" || [204, 205, 304].includes(response.statusCode);
        const result = new Response(noBody ? null : Readable.toWeb(response), {
          status: response.statusCode,
          statusText: response.statusMessage,
          headers: toHeaders(response.headers),
        });
        if (noBody) response.resume();
        resolve(result);
      } catch (error) { cleanup(); request.abort(); reject(error); }
    });
    request.on("error", (error) => {
      cleanup();
      if (!redirected) reject(error);
    });
    try { request.end(body); }
    catch (error) { cleanup(); request.abort(); reject(error); }
  });
