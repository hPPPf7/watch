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

// 限制「同時最多 N 個非同步工作在跑」，不像 runWithConcurrency 綁定
// 一份固定清單——這裡是給共用的請求發送點用（例如快取層的 loader），
// 讓「同時最多幾個真正的網路請求」在單一地方統一管理，呼叫端不用再
// 各自猜「外層併發 x 內層併發」的乘積才能間接控制住實際請求數。
export function createSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      queue.push(resolve);
    });
  };

  const release = () => {
    const next = queue.shift();
    if (next) {
      // 名額直接轉交給下一個排隊者，active 計數不變（同一個名額換人用）。
      next();
      return;
    }
    active = Math.max(0, active - 1);
  };

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}
