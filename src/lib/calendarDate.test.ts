import { describe, expect, it } from "vitest";

import {
  extractDateOnlyKey,
  formatLocalDateKey,
  getCalendarGridRange,
  parseDateOnlyKeyToLocalDate,
} from "@/lib/calendarDate";

describe("calendarDate", () => {
  it("從 ISO watched_at 萃取 date-only key，不受時區換日影響", () => {
    expect(extractDateOnlyKey("2026-03-01T00:00:00.000Z")).toBe("2026-03-01");
    expect(extractDateOnlyKey("2026-03-01T00:30:00+08:00")).toBe("2026-03-01");
  });

  it("把 local Date 格式化成 YYYY-MM-DD key", () => {
    expect(formatLocalDateKey(new Date(2026, 2, 1, 23, 59, 59))).toBe("2026-03-01");
  });

  it("把 date-only key 轉回 local 月曆 Date，不經過 UTC 午夜偏移", () => {
    const parsed = parseDateOnlyKeyToLocalDate("2026-03-01");

    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(2);
    expect(parsed?.getDate()).toBe(1);
  });

  it("回傳月曆可見格子的完整日期範圍", () => {
    const range = getCalendarGridRange(2026, 3);

    expect(formatLocalDateKey(range.startDate)).toBe("2026-03-29");
    expect(formatLocalDateKey(range.endExclusive)).toBe("2026-05-03");
    expect(range.weekCount).toBe(5);
  });
});
