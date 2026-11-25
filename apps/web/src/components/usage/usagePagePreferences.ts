import { UsageDay, UsageProviderKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";

const STORAGE_KEY = "t3code:usage-page-preferences:v1";
const UsageDayRange = Schema.Struct({ sinceDay: UsageDay, untilDay: UsageDay }).check(
  Schema.makeFilter((range) => range.sinceDay <= range.untilDay),
);
export type UsageDayRange = typeof UsageDayRange.Type;
const UsagePagePreferencesSchema = Schema.Struct({
  metric: Schema.Literals(["cost", "tokens", "limits"]),
  /** Kept while a custom range shows, so a saved custom choice falls back to a rolling period. */
  windowDays: Schema.Literals([1, 7, 30, 90, 180, 365]),
  hiddenProviders: Schema.optional(Schema.Array(UsageProviderKind)),
  /** The last picked range stays for the picker after a rolling period is chosen again. */
  customRange: Schema.optional(UsageDayRange),
  customRangeActive: Schema.optional(Schema.Boolean),
});
export type UsagePagePreferences = typeof UsagePagePreferencesSchema.Type;

const DEFAULT_PREFERENCES: UsagePagePreferences = { metric: "limits", windowDays: 30 };

export function readUsagePagePreferences(): UsagePagePreferences {
  try {
    return getLocalStorageItem(STORAGE_KEY, UsagePagePreferencesSchema) ?? DEFAULT_PREFERENCES;
  } catch (error) {
    console.error("Could not read Usage page preferences.", error);
    return DEFAULT_PREFERENCES;
  }
}

export function saveUsagePagePreferences(preferences: UsagePagePreferences): void {
  try {
    setLocalStorageItem(STORAGE_KEY, preferences, UsagePagePreferencesSchema);
  } catch (error) {
    console.error("Could not save Usage page preferences.", error);
  }
}
