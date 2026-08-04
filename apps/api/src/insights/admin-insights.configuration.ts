import type { ApiEnvironment } from "@mensaly/config";

export type AdminInsightsConfiguration = {
  monthlyFixedCostCents: number;
  emailCostPerThousandCents: number;
  storageCostPerGbCents: number;
  sentry: {
    apiBaseUrl: string;
    apiToken?: string;
    organizationSlug?: string;
    projectId?: number;
  };
};

let configuration: AdminInsightsConfiguration = {
  monthlyFixedCostCents: 0,
  emailCostPerThousandCents: 0,
  storageCostPerGbCents: 0,
  sentry: { apiBaseUrl: "https://sentry.io/api/0" },
};

export function configureAdminInsights(environment: ApiEnvironment): void {
  configuration = {
    monthlyFixedCostCents: environment.ADMIN_MONTHLY_FIXED_COST_CENTS,
    emailCostPerThousandCents:
      environment.ADMIN_EMAIL_COST_PER_THOUSAND_CENTS,
    storageCostPerGbCents: environment.ADMIN_STORAGE_COST_PER_GB_CENTS,
    sentry: {
      apiBaseUrl: environment.SENTRY_API_BASE_URL,
      apiToken: environment.SENTRY_API_TOKEN,
      organizationSlug: environment.SENTRY_ORG_SLUG,
      projectId: environment.SENTRY_PROJECT_ID,
    },
  };
}

export function adminInsightsConfiguration(): AdminInsightsConfiguration {
  return configuration;
}
