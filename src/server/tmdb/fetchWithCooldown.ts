// 所有作品／季資料的 TMDB 呼叫共用本機冷卻，不對 Neon 增加任何讀寫。
let retryUntil = 0;
export function tmdbRetryAfterSeconds() { return Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000)); }
export async function fetchTmdbWithCooldown(url: string, init?: RequestInit): Promise<Response> {
  const remaining = tmdbRetryAfterSeconds();
  if (remaining > 0) return new Response(null, {status:429,headers:{"Retry-After":String(remaining)}});
  const response = await fetch(url, init);
  if (response.status === 429) {
    const value = response.headers.get("retry-after");
    const delay = value && /^\d+$/.test(value.trim()) ? Number(value) * 1000 : value ? Date.parse(value) - Date.now() : NaN;
    const wait = Number.isSafeInteger(delay) && delay >= 0 && Number.isSafeInteger(Date.now()+delay) ? Math.max(1000,delay) : 60000;
    retryUntil = Math.max(retryUntil,Date.now()+wait);
  }
  return response;
}
