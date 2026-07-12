// 以固定 worker 數把非同步工作小批並行。
// 用途：清單這種「每個項目互相獨立、但各自要打 1~2 個 API」的迴圈，
// 串行跑會讓等待時間隨清單長度線性成長；小批並行（3~4）可以把
// 體感時間壓到約 1/3，又不會瞬間對後端打出大量請求。
export async function runWithConcurrency<T>(
  list: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (list.length === 0) return;
  const workerCount = Math.max(1, Math.min(Math.floor(limit), list.length));
  let nextIndex = 0;
  const runners = Array.from({ length: workerCount }, async () => {
    while (nextIndex < list.length) {
      const current = list[nextIndex];
      nextIndex += 1;
      await worker(current);
    }
  });
  // 用 allSettled 等所有 runner 結束後才拋第一個錯誤：
  // 若用 Promise.all，第一個 runner 失敗後其他 runner 的後續失敗
  // 會變成 unhandled rejection。
  const results = await Promise.allSettled(runners);
  const firstFailure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (firstFailure) throw firstFailure.reason;
}
