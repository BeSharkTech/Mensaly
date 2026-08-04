import * as Sentry from "@sentry/node";

import type { ApiEnvironment } from "@mensaly/config";

let enabled = false;

export function configureObservability(environment: ApiEnvironment): void {
  if (!environment.SENTRY_DSN || enabled) {
    return;
  }
  Sentry.init({
    dsn: environment.SENTRY_DSN,
    environment: environment.NODE_ENV,
    tracesSampleRate: environment.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
  });
  enabled = true;
}

export function reportUnhandledException(
  exception: unknown,
  context: { correlationId: string; method: string; path: string; organizationId?: string },
): void {
  if (!enabled) {
    return;
  }
  Sentry.withScope((scope) => {
    scope.setTag("correlation_id", context.correlationId);
    scope.setTag("http.method", context.method);
    scope.setTag("http.path", context.path);
    if (context.organizationId) {
      scope.setTag("organization_id", context.organizationId);
    }
    Sentry.captureException(exception);
  });
}

export function observabilityStatus(): "configured" | "disabled" {
  return enabled ? "configured" : "disabled";
}
