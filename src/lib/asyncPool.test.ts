import { describe, expect, it } from "vitest";
import { createSemaphore, runWithConcurrency } from "@/lib/asyncPool";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runWithConcurrency", () => {
  it("處理完所有項目", async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      await tick();
      seen.push(item);
    });

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("同時進行的工作數不超過上限", async () => {
    let active = 0;
    let maxActive = 0;
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick();
      active -= 1;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("空清單直接完成", async () => {
    let called = false;
    await runWithConcurrency([], 4, async () => {
      called = true;
    });

    expect(called).toBe(false);
  });

  it("worker 失敗時等全部結束後拋出第一個錯誤，不留 unhandled rejection", async () => {
    const completed: number[] = [];
    await expect(
      runWithConcurrency([1, 2, 3, 4], 2, async (item) => {
        await tick();
        if (item === 2) throw new Error(`boom-${item}`);
        completed.push(item);
      }),
    ).rejects.toThrow("boom-2");

    // 其他 runner 的項目仍會被處理完，不會半途丟下。
    expect(completed).toContain(4);
  });
});

describe("createSemaphore", () => {
  it("同時執行的 task 數不超過上限", async () => {
    const semaphore = createSemaphore(2);
    let active = 0;
    let maxActive = 0;

    await Promise.all(
      Array.from({ length: 6 }, () =>
        semaphore.run(async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await tick();
          active -= 1;
        }),
      ),
    );

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("名額釋放後，排隊中的下一個 task 才會開始", async () => {
    const semaphore = createSemaphore(1);
    const order: string[] = [];

    const first = semaphore.run(async () => {
      order.push("first-start");
      await tick();
      order.push("first-end");
    });
    const second = semaphore.run(async () => {
      order.push("second-start");
      await tick();
      order.push("second-end");
    });

    await Promise.all([first, second]);

    expect(order).toEqual([
      "first-start",
      "first-end",
      "second-start",
      "second-end",
    ]);
  });

  it("task 拋出例外時仍會釋放名額，不會卡住後面排隊的工作", async () => {
    const semaphore = createSemaphore(1);

    await expect(
      semaphore.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    let secondRan = false;
    await semaphore.run(async () => {
      secondRan = true;
    });

    expect(secondRan).toBe(true);
  });

  it("回傳值正確地從 task 傳遞出來", async () => {
    const semaphore = createSemaphore(3);

    const result = await semaphore.run(async () => "value");

    expect(result).toBe("value");
  });
});
