import { Injectable } from "@nestjs/common";

import { adminInsightsConfiguration } from "./admin-insights.configuration";

type SentryIssue = {
  id?: unknown;
  title?: unknown;
  culprit?: unknown;
  count?: unknown;
  level?: unknown;
  lastSeen?: unknown;
  permalink?: unknown;
};

export type SentryInsights = {
  status: "ready" | "not_configured" | "unavailable";
  periodDays: number;
  totalErrors: number;
  dailyErrors: Array<{ date: string; errors: number }>;
  unresolvedIssues: Array<{
    id: string;
    title: string;
    culprit: string;
    count: number;
    level: string;
    lastSeen: string;
    permalink: string;
  }>;
  checkedAt: string;
};

type CacheEntry = { expiresAt: number; value: SentryInsights };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function dateFromEpoch(value: unknown): string | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed * 1000).toISOString().slice(0, 10);
}

@Injectable()
export class SentryInsightsClient {
  private cache?: CacheEntry;

  async summary(periodDays: number): Promise<SentryInsights> {
    if (this.cache && this.cache.expiresAt > Date.now() && this.cache.value.periodDays === periodDays) {
      return this.cache.value;
    }
    const configuration = adminInsightsConfiguration().sentry;
    const checkedAt = new Date().toISOString();
    if (!configuration.apiToken || !configuration.organizationSlug) {
      return {
        status: "not_configured",
        periodDays,
        totalErrors: 0,
        dailyErrors: [],
        unresolvedIssues: [],
        checkedAt,
      };
    }

    try {
      const base = configuration.apiBaseUrl.replace(/\/$/, "");
      const organization = encodeURIComponent(configuration.organizationSlug);
      const headers = { Authorization: `Bearer ${configuration.apiToken}` };
      const project = configuration.projectId
        ? `&project=${configuration.projectId}`
        : "";
      const statsUrl = `${base}/organizations/${organization}/stats_v2/?groupBy=outcome&field=sum(quantity)&interval=1d&statsPeriod=${periodDays}d&category=error&outcome=accepted${project}`;
      const issuesUrl = `${base}/organizations/${organization}/issues/?query=is%3Aunresolved&sort=freq&statsPeriod=${periodDays}d&limit=5${project}`;
      const [statsResponse, issuesResponse] = await Promise.all([
        fetch(statsUrl, { headers, signal: AbortSignal.timeout(5_000) }),
        fetch(issuesUrl, { headers, signal: AbortSignal.timeout(5_000) }),
      ]);
      if (!statsResponse.ok || !issuesResponse.ok) {
        throw new Error(`Sentry API returned ${statsResponse.status}/${issuesResponse.status}`);
      }
      const stats = (await statsResponse.json()) as {
        groups?: Array<{ series?: Record<string, Array<[unknown, unknown]>> }>;
      };
      const issues = (await issuesResponse.json()) as SentryIssue[];
      const byDate = new Map<string, number>();
      for (const group of Array.isArray(stats.groups) ? stats.groups : []) {
        for (const points of Object.values(group.series ?? {})) {
          for (const [timestamp, value] of Array.isArray(points) ? points : []) {
            const date = dateFromEpoch(timestamp);
            if (date) byDate.set(date, (byDate.get(date) ?? 0) + count(value));
          }
        }
      }
      const dailyErrors = [...byDate.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, errors]) => ({ date, errors }));
      const value: SentryInsights = {
        status: "ready",
        periodDays,
        totalErrors: dailyErrors.reduce((sum, item) => sum + item.errors, 0),
        dailyErrors,
        unresolvedIssues: (Array.isArray(issues) ? issues : []).slice(0, 5).map((issue) => ({
          id: text(issue.id),
          title: text(issue.title) || "Erro sem título",
          culprit: text(issue.culprit),
          count: count(issue.count),
          level: text(issue.level) || "error",
          lastSeen: text(issue.lastSeen),
          permalink: text(issue.permalink),
        })),
        checkedAt,
      };
      this.cache = { expiresAt: Date.now() + 60_000, value };
      return value;
    } catch {
      const value: SentryInsights = {
        status: "unavailable",
        periodDays,
        totalErrors: 0,
        dailyErrors: [],
        unresolvedIssues: [],
        checkedAt,
      };
      this.cache = { expiresAt: Date.now() + 15_000, value };
      return value;
    }
  }
}
