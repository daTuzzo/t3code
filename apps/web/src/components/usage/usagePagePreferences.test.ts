import { UsageDay } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { readUsagePagePreferences, saveUsagePagePreferences } from "./usagePagePreferences";

const key = "t3code:usage-page-preferences:v1";
let values: Map<string, string>;
let storage: Pick<Storage, "getItem" | "setItem">;

beforeEach(() => {
  values = new Map();
  storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  vi.stubGlobal("window", { localStorage: storage });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Usage page preferences", () => {
  it("round-trips hidden providers and reads older saves without them", () => {
    saveUsagePagePreferences({ metric: "cost", windowDays: 7, hiddenProviders: ["codex"] });
    expect(readUsagePagePreferences().hiddenProviders).toEqual(["codex"]);

    values.set(key, '{"metric":"tokens","windowDays":30}');
    expect(readUsagePagePreferences()).toEqual({ metric: "tokens", windowDays: 30 });
  });

  it("round-trips longer periods and a custom range beside the rolling period", () => {
    saveUsagePagePreferences({ metric: "cost", windowDays: 365 });
    expect(readUsagePagePreferences().windowDays).toBe(365);

    const customRange = {
      sinceDay: UsageDay.make("2026-10-01"),
      untilDay: UsageDay.make("2026-10-31"),
    };
    saveUsagePagePreferences({
      metric: "tokens",
      windowDays: 180,
      customRange,
      customRangeActive: true,
    });
    expect(readUsagePagePreferences()).toEqual({
      metric: "tokens",
      windowDays: 180,
      customRange,
      customRangeActive: true,
    });
    expect(JSON.parse(values.get(key)!)).toMatchObject({ windowDays: 180 });
  });

  // regression: #10189 an invalid saved usage selection was never replaced
  it.each([
    "not-json",
    '{"metric":"unknown","windowDays":7}',
    '{"metric":"cost","windowDays":400}',
    '{"metric":"cost","windowDays":30,"customRange":{"sinceDay":"2026-11-10","untilDay":"2026-11-01"}}',
    '{"metric":"cost","windowDays":30,"customRange":{"sinceDay":"Nov 1","untilDay":"2026-11-10"}}',
  ])("replaces invalid preferences on the next save: %s", (value) => {
    values.set(key, value);
    expect(readUsagePagePreferences()).toEqual({ metric: "limits", windowDays: 30 });
    saveUsagePagePreferences({ metric: "tokens", windowDays: 7 });
    expect(readUsagePagePreferences()).toEqual({ metric: "tokens", windowDays: 7 });
  });
});
