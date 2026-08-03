import { apiRequest, ApiRequestError } from "@/lib/api";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "COMPANY_ACCOUNT" | "PLATFORM_ADMIN";
  organizationId?: string | null;
};

type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "USER_UPDATED";
type AuthListener = (event: AuthEvent) => void;

const listeners = new Set<AuthListener>();

function notify(event: AuthEvent) {
  listeners.forEach((listener) => listener(event));
}

export async function currentUser(): Promise<SessionUser | null> {
  try {
    return await apiRequest<SessionUser>("/auth/session");
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

export async function register(input: { name: string; email: string; password: string }) {
  return apiRequest<{ devVerificationToken?: string }>("/auth/register", {
    method: "POST",
    body: input,
  });
}

export async function login(input: { email: string; password: string }) {
  const user = await apiRequest<SessionUser>("/auth/login", {
    method: "POST",
    body: input,
  });
  notify("SIGNED_IN");
  return user;
}

export async function logout() {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } finally {
    notify("SIGNED_OUT");
  }
}

export async function requestPasswordReset(email: string) {
  await apiRequest("/auth/password-reset/request", {
    method: "POST",
    body: { email },
  });
}

export async function requestEmailVerification(email: string) {
  await apiRequest("/auth/verify-email/request", {
    method: "POST",
    body: { email },
  });
}

export async function verifyEmail(token: string) {
  await apiRequest("/auth/verify-email/confirm", {
    method: "POST",
    body: { token },
  });
  notify("USER_UPDATED");
}

export async function confirmPasswordReset(token: string, password: string) {
  await apiRequest("/auth/password-reset/confirm", {
    method: "POST",
    body: { token, password },
  });
  notify("USER_UPDATED");
}

export function onAuthChange(listener: AuthListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
