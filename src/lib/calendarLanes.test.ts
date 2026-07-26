import { describe, expect, it } from "vitest";
import { buildLaneLayout } from "./calendarLanes";

type TestCard = { id: string; groupKey: string };

const week = (start: number) =>
  Array.from({ length: 7 }, (_, index) => `2026-03-${String(start + index).padStart(2, "0")}`);

const card = (groupKey: string, day: string): TestCard => ({
  id: `${groupKey}@${day}`,
  groupKey,
});

const laneOf = (
  layout: ReturnType<typeof buildLaneLayout<TestCard>>,
  dayKey: string,
  groupKey: string,
) => (layout[dayKey] ?? []).findIndex((slot) => slot?.card.groupKey === groupKey);

describe("buildLaneLayout", () => {
  it("讓連續日期的同一部作品落在同一條車道", () => {
    const days = week(1);
    const layout = buildLaneLayout([days], {
      [days[1]]: [card("tv:A", days[1])],
      [days[2]]: [card("tv:A", days[2])],
      [days[3]]: [card("tv:A", days[3])],
    });

    expect(laneOf(layout, days[1], "tv:A")).toBe(0);
    expect(laneOf(layout, days[2], "tv:A")).toBe(0);
    expect(laneOf(layout, days[3], "tv:A")).toBe(0);
  });

  it("只在段落內部標記相連，兩端維持圓角", () => {
    const days = week(1);
    const layout = buildLaneLayout([days], {
      [days[1]]: [card("tv:A", days[1])],
      [days[2]]: [card("tv:A", days[2])],
      [days[3]]: [card("tv:A", days[3])],
    });

    expect(layout[days[1]][0]).toMatchObject({
      continuesLeft: false,
      continuesRight: true,
    });
    expect(layout[days[2]][0]).toMatchObject({
      continuesLeft: true,
      continuesRight: true,
    });
    expect(layout[days[3]][0]).toMatchObject({
      continuesLeft: true,
      continuesRight: false,
    });
  });

  it("中斷一天就拆成兩段，不會誤接", () => {
    const days = week(1);
    const layout = buildLaneLayout([days], {
      [days[0]]: [card("tv:A", days[0])],
      [days[2]]: [card("tv:A", days[2])],
    });

    expect(layout[days[0]][0]).toMatchObject({
      continuesLeft: false,
      continuesRight: false,
    });
    expect(layout[days[2]][0]).toMatchObject({
      continuesLeft: false,
      continuesRight: false,
    });
  });

  it("跨週斷行仍算相連：週六向右、週日向左都維持方角", () => {
    const first = week(1);
    const second = week(8);
    const layout = buildLaneLayout([first, second], {
      [first[5]]: [card("tv:A", first[5])],
      [first[6]]: [card("tv:A", first[6])],
      [second[0]]: [card("tv:A", second[0])],
      [second[1]]: [card("tv:A", second[1])],
    });

    // 上一列結尾：右側不收邊
    expect(layout[first[6]][0]).toMatchObject({
      continuesLeft: true,
      continuesRight: true,
    });
    // 下一列開頭：左側不收邊
    expect(layout[second[0]][0]).toMatchObject({
      continuesLeft: true,
      continuesRight: true,
    });
    // 整段的真正兩端仍要收邊
    expect(layout[first[5]][0]).toMatchObject({ continuesLeft: false });
    expect(layout[second[1]][0]).toMatchObject({ continuesRight: false });
  });

  it("跨月相連：補格的鄰月日期與當月首日視為同一段", () => {
    // 2026-03-01 是週日，這裡刻意排成 2/25 起的一列，讓月界落在列中間
    const first = ["2026-02-22", "2026-02-23", "2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27", "2026-02-28"];
    const second = ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07"];
    const layout = buildLaneLayout([first, second], {
      "2026-02-27": [card("tv:A", "2026-02-27")],
      "2026-02-28": [card("tv:A", "2026-02-28")],
      "2026-03-01": [card("tv:A", "2026-03-01")],
    });

    expect(layout["2026-02-28"][0]).toMatchObject({
      continuesLeft: true,
      continuesRight: true,
    });
    expect(layout["2026-03-01"][0]).toMatchObject({
      continuesLeft: true,
      continuesRight: false,
    });
    // 三格同一條車道
    expect(laneOf(layout, "2026-02-27", "tv:A")).toBe(0);
    expect(laneOf(layout, "2026-03-01", "tv:A")).toBe(0);
  });

  it("跨週但中間斷掉一天時不相連", () => {
    const first = week(1);
    const second = week(8);
    const layout = buildLaneLayout([first, second], {
      [first[6]]: [card("tv:A", first[6])],
      [second[1]]: [card("tv:A", second[1])],
    });

    expect(layout[first[6]][0]).toMatchObject({ continuesRight: false });
    expect(layout[second[1]][0]).toMatchObject({ continuesLeft: false });
  });

  it("跨日段落優先占低車道，重疊的單日卡片被推到下一條", () => {
    const days = week(1);
    const layout = buildLaneLayout([days], {
      [days[0]]: [card("tv:A", days[0])],
      [days[1]]: [card("tv:A", days[1]), card("movie:X", days[1])],
      [days[2]]: [card("tv:A", days[2])],
    });

    expect(laneOf(layout, days[0], "tv:A")).toBe(0);
    expect(laneOf(layout, days[1], "tv:A")).toBe(0);
    expect(laneOf(layout, days[2], "tv:A")).toBe(0);
    expect(laneOf(layout, days[1], "movie:X")).toBe(1);
  });

  it("被跨日段落跳過的日期會留下空車道佔位，讓後續車道對齊", () => {
    const days = week(1);
    const layout = buildLaneLayout([days], {
      [days[0]]: [card("tv:A", days[0])],
      [days[1]]: [card("movie:X", days[1])],
      [days[2]]: [card("tv:A", days[2])],
      [days[3]]: [card("tv:A", days[3])],
    });

    // tv:A 在 days[2]-days[3] 是較長的段落，先取得 lane 0；
    // days[0] 的單日 tv:A 自成一段，movie:X 與它不重疊也落在 lane 0。
    expect(laneOf(layout, days[2], "tv:A")).toBe(0);
    expect(laneOf(layout, days[3], "tv:A")).toBe(0);
    // days[1] 只有一張卡，lane 0 被 movie:X 用掉，沒有多餘的 null 佔位
    expect(layout[days[1]]).toHaveLength(1);
  });

  it("重疊的兩段跨日紀錄不會擠在同一條車道", () => {
    const days = week(1);
    const layout = buildLaneLayout([days], {
      [days[0]]: [card("tv:A", days[0])],
      [days[1]]: [card("tv:A", days[1]), card("tv:B", days[1])],
      [days[2]]: [card("tv:B", days[2])],
    });

    expect(laneOf(layout, days[0], "tv:A")).toBe(laneOf(layout, days[1], "tv:A"));
    expect(laneOf(layout, days[1], "tv:B")).toBe(laneOf(layout, days[2], "tv:B"));
    expect(laneOf(layout, days[1], "tv:A")).not.toBe(laneOf(layout, days[1], "tv:B"));
  });

  it("同一天的重複 groupKey 會各自佔一條車道，不會互相覆蓋", () => {
    const days = week(1);
    const layout = buildLaneLayout([days], {
      [days[0]]: [card("movie:X", days[0]), card("movie:X", days[0])],
    });

    const slots = layout[days[0]].filter((slot) => slot !== null);
    expect(slots).toHaveLength(2);
  });

  it("探針顯示畫面外還有延續時，最外緣不收邊", () => {
    const days = week(1);
    const layout = buildLaneLayout(
      [days],
      {
        [days[0]]: [card("tv:A", days[0])],
        [days[6]]: [card("tv:B", days[6])],
      },
      {
        continuingBefore: new Set(["tv:A"]),
        continuingAfter: new Set(["tv:B"]),
      },
    );

    expect(layout[days[0]][0]).toMatchObject({ continuesLeft: true });
    expect(layout[days[6]][0]).toMatchObject({ continuesRight: true });
  });

  it("沒有探針資訊時最外緣一律收邊", () => {
    const days = week(1);
    const layout = buildLaneLayout([days], {
      [days[0]]: [card("tv:A", days[0])],
      [days[6]]: [card("tv:B", days[6])],
    });

    expect(layout[days[0]][0]).toMatchObject({ continuesLeft: false });
    expect(layout[days[6]][0]).toMatchObject({ continuesRight: false });
  });

  it("探針只影響貼齊最外緣的段落，內側的同名段落不受影響", () => {
    const days = week(1);
    const layout = buildLaneLayout(
      [days],
      {
        // tv:A 出現在 days[2]，沒有貼到首格
        [days[2]]: [card("tv:A", days[2])],
      },
      { continuingBefore: new Set(["tv:A"]) },
    );

    expect(layout[days[2]][0]).toMatchObject({
      continuesLeft: false,
      continuesRight: false,
    });
  });

  it("探針方向不會互串：延續在前不會讓末格不收邊", () => {
    const days = week(1);
    const layout = buildLaneLayout(
      [days],
      { [days[6]]: [card("tv:A", days[6])] },
      { continuingBefore: new Set(["tv:A"]) },
    );

    expect(layout[days[6]][0]).toMatchObject({
      continuesLeft: false,
      continuesRight: false,
    });
  });

  it("沒有紀錄的日期回傳空車道陣列", () => {
    const days = week(1);
    const layout = buildLaneLayout([days], {});
    expect(layout[days[3]]).toEqual([]);
  });
});
