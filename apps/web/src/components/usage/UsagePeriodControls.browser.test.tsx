import { UsageDay } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { UsageCustomRangeCalendar, UsageLoadingRing } from "./UsagePeriodControls";

const october = { sinceDay: UsageDay.make("2026-10-01"), untilDay: UsageDay.make("2026-10-31") };
const day = (name: RegExp) => page.getByRole("button", { name });

describe("UsageCustomRangeCalendar", () => {
  it("starts a new range on the first pick and applies it on the second", async () => {
    const onApply = vi.fn();
    await using _screen = await render(
      <UsageCustomRangeCalendar initialRange={october} onApply={onApply} />,
    );
    await expect.element(page.getByText("Oct 1 to Oct 31")).toBeVisible();

    await day(/October 20th, 2026/).click();
    await expect.element(page.getByText("Pick the last day")).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();

    // An earlier second pick becomes the start of the range.
    await day(/October 5th, 2026/).click();
    expect(onApply).toHaveBeenCalledExactlyOnceWith({
      sinceDay: "2026-10-05",
      untilDay: "2026-10-20",
    });
  });

  it("applies a single day picked twice", async () => {
    const onApply = vi.fn();
    await using _screen = await render(
      <UsageCustomRangeCalendar initialRange={october} onApply={onApply} />,
    );
    await day(/October 9th, 2026/).click();
    await day(/October 9th, 2026/).click();
    expect(onApply).toHaveBeenCalledExactlyOnceWith({
      sinceDay: "2026-10-09",
      untilDay: "2026-10-09",
    });
  });
});

describe("UsageLoadingRing", () => {
  it("shows the answered share while loading and keeps its space when done", async () => {
    await using screen = await render(<UsageLoadingRing loading progress={0.4} />);
    const ring = screen.container.querySelector<HTMLElement>("[data-slot=usage-loading-ring]")!;
    await expect
      .element(page.getByRole("progressbar", { name: "Loading usage" }))
      .toHaveAttribute("aria-valuenow", "40");
    const loadingBox = ring.getBoundingClientRect();

    await screen.rerender(<UsageLoadingRing loading={false} progress={null} />);
    await expect.element(page.getByRole("progressbar")).not.toBeInTheDocument();
    expect(ring.getAttribute("aria-hidden")).toBe("true");
    expect(ring.className).toContain("opacity-0");
    const doneBox = ring.getBoundingClientRect();
    expect([doneBox.width, doneBox.height]).toEqual([loadingBox.width, loadingBox.height]);
    expect(doneBox.width).toBeGreaterThan(0);
  });

  it("reports no value while nothing has answered", async () => {
    await using _screen = await render(<UsageLoadingRing loading progress={null} />);
    const ring = page.getByRole("progressbar", { name: "Loading usage" });
    await expect.element(ring).toBeVisible();
    await expect.element(ring).not.toHaveAttribute("aria-valuenow");
  });
});
