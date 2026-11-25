import { UsageDay } from "@t3tools/contracts";
import { enumerateDays, makeWindow } from "@t3tools/shared/usageFormat";
import { describe, expect, it } from "vite-plus/test";

import {
  dateFromUsageDay,
  isCustomUsagePeriod,
  usageDayFromDate,
  usageDayRangeFromWindow,
  usagePeriodWindow,
} from "./usagePeriod";

const now = new Date("2026-11-24T12:00:00Z");
const customRange = {
  sinceDay: UsageDay.make("2026-10-01"),
  untilDay: UsageDay.make("2026-10-31"),
};

describe("usagePeriodWindow", () => {
  it.each([180, 365] as const)("asks for the last %i days by day", (windowDays) => {
    const window = usagePeriodWindow({ windowDays }, now);
    expect(window).toEqual(makeWindow(windowDays, now, "day"));
    expect(enumerateDays(window.sinceDay, window.untilDay)).toHaveLength(windowDays);
  });

  it("keeps the hourly window for the past 24 hours", () => {
    expect(usagePeriodWindow({ windowDays: 1 }, now)).toEqual(makeWindow(1, now, "hour"));
  });

  it("asks for exactly the picked days in the local time zone", () => {
    const window = usagePeriodWindow({ windowDays: 30, customRange, customRangeActive: true }, now);
    expect(window).toEqual({
      sinceDay: "2026-10-01",
      untilDay: "2026-10-31",
      timeZone: makeWindow(1, now).timeZone,
      resolution: "day",
    });
    expect(usageDayRangeFromWindow(window)).toEqual(customRange);
  });

  it("falls back to the rolling period when the range is not chosen or missing", () => {
    for (const preferences of [
      { windowDays: 30, customRange, customRangeActive: false },
      { windowDays: 30, customRangeActive: true },
    ] as const) {
      expect(isCustomUsagePeriod(preferences)).toBe(false);
      expect(usagePeriodWindow(preferences, now)).toEqual(makeWindow(30, now, "day"));
    }
  });
});

describe("usage day dates", () => {
  it("round-trips calendar dates as local days", () => {
    const date = dateFromUsageDay("2026-03-09");
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([
      2026, 2, 9, 0,
    ]);
    expect(usageDayFromDate(date)).toBe("2026-03-09");
    expect(usageDayFromDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});
