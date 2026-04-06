import { describe, expect, it } from "vitest";
import { isUtcMidnightDate, isValidDateOnly, toUtcDateOnly } from "@/lib/dateOnly";

describe("dateOnly helpers", () => {
  it("toUtcDateOnly 會建立 UTC 午夜時間", () => {
    const value = toUtcDateOnly("2026-03-01");

    expect(isUtcMidnightDate(value)).toBe(true);
    expect(value.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("isUtcMidnightDate 會拒絕非 UTC 午夜時間", () => {
    expect(isUtcMidnightDate(new Date("2026-03-01T00:00:00.000Z"))).toBe(true);
    expect(isUtcMidnightDate(new Date("2026-03-01T00:30:00.000Z"))).toBe(false);
  });

  it("isValidDateOnly 仍只接受有效 date-only 字串", () => {
    expect(isValidDateOnly("2026-03-01")).toBe(true);
    expect(isValidDateOnly("2026-02-31")).toBe(false);
  });
});
