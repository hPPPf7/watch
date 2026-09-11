let retryUntil = 0;
// API 回覆 429 後，既有重試與其他元件都須等到 Retry-After，不立即再次送出。
export async function fetchTmdbClient(url: string): Promise<Response> {
  if (retryUntil > Date.now()) return new Response(null,{status:429});
  const response = await fetch(url);
  if (response.status === 429) {
    const value=response.headers.get("retry-after");
    const delay=value && /^\d+$/.test(value.trim()) ? Number(value)*1000 : value ? Date.parse(value)-Date.now() : NaN;
    const wait=Number.isSafeInteger(delay) && delay>=0 && Number.isSafeInteger(Date.now()+delay) ? Math.max(1000,delay) : 60000;
    retryUntil=Math.max(retryUntil,Date.now()+wait);
  }
  return response;
}
