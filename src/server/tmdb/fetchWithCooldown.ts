// All TMDB upstream paths share this process cooldown without Neon reads or writes.
let retryUntil = 0;

export function tmdbRetryAfterSeconds() {
  return Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000));
}

export function extendTmdbCooldown(until: number) {
  if (Number.isSafeInteger(until)) retryUntil = Math.max(retryUntil, until);
}

export function tmdbRetryDelayMs(value: string | null, fallback = 60_000) {
  if (!value) return fallback;
  const now = Date.now();
  const delay = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isSafeInteger(delay) && delay >= 0 && Number.isSafeInteger(now + delay)
    ? Math.max(1000, delay) : fallback;
}

export async function fetchTmdbWithCooldown(url: string, init?: RequestInit): Promise<Response> {
  const remaining = tmdbRetryAfterSeconds();
  if (remaining > 0) {
    return new Response(null, { status: 429, headers: { "Retry-After": String(remaining) } });
  }
  const response = await fetch(url, init);
  if (response.status === 429) {
    extendTmdbCooldown(Date.now() + tmdbRetryDelayMs(response.headers.get("retry-after")));
  }
  return response;
}
