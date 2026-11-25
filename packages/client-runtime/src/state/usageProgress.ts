import type { UsageProviderKind, UsageSummary } from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

interface UsageProgressEnvironment {
  readonly label: string;
  readonly isConnected: boolean;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly summary: UsageSummary | null;
}

export function usageEnvironmentProgress(
  environment: UsageProgressEnvironment,
  refreshing = false,
) {
  const { summary } = environment;
  if (!environment.isConnected || environment.error !== null) return { phase: "inactive" } as const;
  if (summary === null) return { phase: "loading" } as const;
  if (refreshing) return { phase: "stale" } as const;
  if (!environment.isPending) return { phase: "ready" } as const;
  const providers = [
    ...new Set(
      summary.sources.flatMap((source) => (source.refreshing ? [source.fingerprint.provider] : [])),
    ),
  ];
  return providers.length > 0
    ? ({ phase: "partway", providers } as const)
    : ({ phase: "stale" } as const);
}

export function updatingProvidersLabel(
  providers: readonly UsageProviderKind[],
  providerLabel: (provider: UsageProviderKind) => string,
  resolve: MFunctionType = mFallback,
) {
  return providers.length === 1
    ? resolve(msg("Updating {provider}…", { provider: providerLabel(providers[0]!) }))
    : resolve(msg("Updating {count} providers…", { count: providers.length }));
}

export function usageProgress(
  environments: readonly UsageProgressEnvironment[],
  {
    refreshing = false,
    providerLabel,
  }: {
    readonly refreshing?: boolean;
    readonly providerLabel: (provider: UsageProviderKind) => string;
  },
  resolve: MFunctionType = mFallback,
) {
  const progress = environments.map((environment) => ({
    label: environment.label,
    ...usageEnvironmentProgress(environment, refreshing),
  }));
  const waiting = progress.filter(({ phase }) => phase === "loading" || phase === "stale");
  const providers = [
    ...new Set(progress.flatMap((entry) => (entry.phase === "partway" ? entry.providers : []))),
  ];
  const answered = progress.some(({ phase }) => phase === "partway" || phase === "ready");
  return {
    dimmed: !answered && progress.some(({ phase }) => phase === "stale"),
    label:
      waiting.length === 0
        ? providers.length === 0
          ? null
          : updatingProvidersLabel(providers, providerLabel, resolve)
        : environments.length === 1
          ? resolve(msg("Updating…"))
          : waiting.length === 1
            ? resolve(msg("Updating {environment}…", { environment: waiting[0]!.label }))
            : resolve(msg("Updating {count} environments…", { count: waiting.length })),
  };
}

/**
 * Share of the selected environments' usage that has answered: whole environments, and within an
 * environment the sources that are no longer refreshing. Null while nothing has answered, because a
 * cold scan reports no progress until its first answer.
 */
export function usageProgressFraction(
  environments: readonly UsageProgressEnvironment[],
  refreshing = false,
  hiddenProviders: ReadonlySet<UsageProviderKind> = new Set(),
): number | null {
  let active = 0;
  let answered = 0;
  let known = false;
  for (const environment of environments) {
    const progress = usageEnvironmentProgress(environment, refreshing);
    if (progress.phase === "inactive") continue;
    active += 1;
    if (progress.phase === "ready") {
      answered += 1;
      known = true;
    } else if (progress.phase === "partway") {
      const sources =
        environment.summary?.sources.filter(
          (source) => !hiddenProviders.has(source.fingerprint.provider),
        ) ?? [];
      const settled = sources.filter((source) => source.refreshing !== true).length;
      answered += sources.length === 0 ? 1 : settled / sources.length;
      known = true;
    }
  }
  return known && active > 0 ? answered / active : null;
}

export function usageLoadingState(
  environments: readonly UsageProgressEnvironment[],
  refreshing = false,
) {
  const providers = new Set<UsageProviderKind>();
  let everyProvider = false;
  for (const environment of environments) {
    const progress = usageEnvironmentProgress(environment, refreshing);
    if (progress.phase === "loading" || progress.phase === "stale") everyProvider = true;
    if (progress.phase === "partway")
      for (const provider of progress.providers) providers.add(provider);
  }
  return { partial: everyProvider || providers.size > 0, everyProvider, providers };
}
