import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "@/lib/asyncPool";

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
