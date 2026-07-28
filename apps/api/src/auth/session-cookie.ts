import type { ApiEnvironment } from "@mensaly/config";

type SessionCookieEnvironment = Pick<
  ApiEnvironment,
  "NODE_ENV" | "AUTH_SESSION_TTL_HOURS"
>;

export const SESSION_COOKIE_NAME = "mensaly_session";

export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) {
      return value.join("=") || undefined;
    }
  }

  return undefined;
}

export function sessionCookie(
  token: string,
  environment: SessionCookieEnvironment,
): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/api",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${environment.AUTH_SESSION_TTL_HOURS * 60 * 60}`,
  ];

  if (environment.NODE_ENV === "production") {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function expiredSessionCookie(environment: SessionCookieEnvironment): string {
  return sessionCookie("", { ...environment, AUTH_SESSION_TTL_HOURS: 0 });
}
