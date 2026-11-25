import { UsageDay, type UsageSummaryInput } from "@t3tools/contracts";
import { makeWindow } from "@t3tools/shared/usageFormat";

import type { UsageDayRange, UsagePagePreferences } from "./usagePagePreferences";

type UsagePeriodPreferences = Pick<
  UsagePagePreferences,
  "windowDays" | "customRange" | "customRangeActive"
>;

export function isCustomUsagePeriod(preferences: UsagePeriodPreferences): boolean {
  return preferences.customRangeActive === true && preferences.customRange !== undefined;
}

/** The request window for the chosen period: a rolling number of days or a picked range of days. */
export function usagePeriodWindow(
  preferences: UsagePeriodPreferences,
  now = new Date(),
): UsageSummaryInput {
  const { customRange, windowDays } = preferences;
  if (isCustomUsagePeriod(preferences) && customRange !== undefined) {
    // makeWindow resolves the bucketing time zone; the range replaces its days.
    return { ...makeWindow(1, now), ...customRange };
  }
  return makeWindow(windowDays, now, windowDays === 1 ? "hour" : "day");
}

/** The calendar works in local midnights, and usage days are local calendar days. */
export function usageDayFromDate(date: Date): UsageDay {
  const pad = (value: number) => String(value).padStart(2, "0");
  return UsageDay.make(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
}

export function dateFromUsageDay(day: string): Date {
  const [year = 1970, month = 1, dayOfMonth = 1] = day.split("-").map(Number);
  return new Date(year, month - 1, dayOfMonth);
}

export function usageDayRangeFromWindow(window: UsageSummaryInput): UsageDayRange {
  return { sinceDay: window.sinceDay, untilDay: window.untilDay };
}
