/** 接受站內路徑，保留原字串，避免重新序列化後產生 protocol-relative URL。 */
export function safeRedirectPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || /^\/[/\\]/.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const base = "https://watch.invalid";
    return new URL(value, base).origin === base ? value : null;
  } catch { return null; }
}
