import type { DateRange } from "@daypicker/react";
import { formatDayShort } from "@t3tools/shared/usageFormat";
import { useGT, useLocale } from "gt-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";
import { weekStartsOn } from "../../timestampFormat";
import { Calendar } from "../ui/calendar";
import type { UsageDayRange } from "./usagePagePreferences";
import { dateFromUsageDay, usageDayFromDate } from "./usagePeriod";

export function UsageDayRangeLabel({ range }: { readonly range: UsageDayRange }) {
  const gt = useGT();
  const locale = useLocale();
  return range.sinceDay === range.untilDay
    ? formatDayShort(range.sinceDay, locale)
    : gt("{start} to {end}", {
        start: formatDayShort(range.sinceDay, locale),
        end: formatDayShort(range.untilDay, locale),
      });
}

/** Picks a range of past days; the second pick completes the range and applies it. */
export function UsageCustomRangeCalendar({
  initialRange,
  onApply,
}: {
  readonly initialRange: UsageDayRange;
  readonly onApply: (range: UsageDayRange) => void;
}) {
  const gt = useGT();
  const [today] = useState(() => new Date());
  const [selected, setSelected] = useState<DateRange>(() => ({
    from: dateFromUsageDay(initialRange.sinceDay),
    to: dateFromUsageDay(initialRange.untilDay),
  }));
  return (
    <div className="flex flex-col gap-1">
      <Calendar
        mode="range"
        required
        resetOnSelect
        selected={selected}
        defaultMonth={selected.to ?? today}
        endMonth={today}
        disabled={{ after: today }}
        {...(weekStartsOn === undefined ? {} : { weekStartsOn })}
        onSelect={(range) => {
          setSelected(range);
          if (range.from !== undefined && range.to !== undefined) {
            onApply({
              sinceDay: usageDayFromDate(range.from),
              untilDay: usageDayFromDate(range.to),
            });
          }
        }}
      />
      <p className="px-1 pb-1 text-xs text-muted-foreground" aria-live="polite">
        {selected.from !== undefined && selected.to === undefined ? (
          gt("Pick the last day")
        ) : (
          <UsageDayRangeLabel range={initialRange} />
        )}
      </p>
    </div>
  );
}

const RING_RADIUS = 5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * A quiet progress ring for usage that is still loading. It fills to the share that has answered,
 * spins while nothing has, and fades out once everything has answered. It always takes its space,
 * so showing or hiding it never moves the controls beside it.
 */
export function UsageLoadingRing({
  loading,
  progress,
}: {
  readonly loading: boolean;
  readonly progress: number | null;
}) {
  const gt = useGT();
  const spinning = loading && progress === null;
  // Fill completely while fading out, so the ring reads as finished.
  const filled = !loading ? 1 : progress === null ? 0.3 : Math.min(1, Math.max(0.08, progress));
  return (
    <span
      data-slot="usage-loading-ring"
      className={cn(
        "flex size-3.5 shrink-0 text-muted-foreground transition-opacity duration-300",
        loading ? "opacity-100 delay-150" : "opacity-0",
      )}
      {...(loading
        ? {
            role: "progressbar",
            "aria-label": gt("Loading usage"),
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            ...(progress === null ? {} : { "aria-valuenow": Math.round(progress * 100) }),
          }
        : { "aria-hidden": true })}
    >
      <svg
        viewBox="0 0 14 14"
        aria-hidden
        ref={spinning ? observeVisibleAnimation : undefined}
        className={cn("size-full -rotate-90", spinning && "motion-safe:visible-animate-spin")}
        style={spinning ? { animationDuration: "1.6s" } : undefined}
      >
        <circle
          cx="7"
          cy="7"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="opacity-25"
        />
        <circle
          cx="7"
          cy="7"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - filled)}
          // Jump to the spinning arc when a load starts, then ease toward each answer.
          className={cn(
            !spinning && "transition-[stroke-dashoffset] duration-300 ease-out",
            "motion-reduce:transition-none",
          )}
        />
      </svg>
    </span>
  );
}
