// 若在註冊前連線就已中止（例如訂閱期間 client 斷線），對已 aborted 的
// signal 註冊 listener 不會觸發，呼叫端需要立即執行一次 cleanup。
export function registerAbortCleanup(signal: AbortSignal, cleanup: () => void) {
  if (signal.aborted) {
    cleanup();
    return;
  }
  signal.addEventListener("abort", cleanup, { once: true });
}
