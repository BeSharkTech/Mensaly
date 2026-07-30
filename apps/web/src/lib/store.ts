import { createCacheStore, useCacheStore } from "@/lib/cache";
import { resetDashboardData } from "@/lib/data";
import { apiRequest, ApiRequestError } from "@/lib/api";
import { currentUser, logout, onAuthChange } from "@/lib/auth";
import { DEFAULT_BRAND_COLOR } from "@/lib/branding";

export type Account = {
  id: string;
  name: string;
  email: string;
};

export type Plan = {
  id: string;
  name: string;
  description: string;
  amountCents: number;
  dueDay: number;
  status: "ACTIVE";
};

export type Business = {
  id?: string;
  name: string;
  segment: string;
  phone: string;
  city: string;
  logoDataUrl: string | null;
  brandColor: string;
};

export type AppState = {
  account: Account | null;
  business: Business | null;
  plans: Plan[];
  onboardingComplete: boolean;
  session: boolean;
};

type ApiOrganization = {
  id: string;
  name: string;
  phone: string | null;
  address: { city?: string } | null;
  brand: {
    primaryColor?: string;
    logoDataUrl?: string;
    segment?: string;
    onboardingComplete?: boolean;
  } | null;
};

type ApiPlan = {
  id: string;
  name: string;
  description: string | null;
  amountCents: number;
  dueDay: number;
  status: "ACTIVE" | "INACTIVE";
};

type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

async function page<T>(path: string): Promise<Page<T>> {
  return apiRequest<Page<T>>(path, {
    query: { page: 1, pageSize: 100 },
  });
}

export const emptyState: AppState = {
  account: null,
  business: null,
  plans: [],
  onboardingComplete: false,
  session: false,
};

export const segments = [
  "Escola infantil",
  "Escola de ensino fundamental/médio",
  "Curso de idiomas",
  "Escola de música",
  "Academia / esportes",
  "Curso preparatório",
  "Outro",
];

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

async function ownOrganization(): Promise<ApiOrganization | null> {
  try {
    return await apiRequest<ApiOrganization>("/organization");
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}

export async function loadState(): Promise<AppState> {
  const user = await currentUser();
  if (!user) return emptyState;

  if (user.role === "PLATFORM_ADMIN") {
    return {
      account: { id: user.id, name: user.name, email: user.email },
      business: {
        id: "platform",
        name: "Mensaly",
        segment: "Plataforma",
        phone: "",
        city: "",
        logoDataUrl: null,
        brandColor: DEFAULT_BRAND_COLOR,
      },
      plans: [],
      onboardingComplete: true,
      session: true,
    };
  }

  const organization = await ownOrganization();
  const planPage = organization
    ? await page<ApiPlan>("/plans")
    : { items: [] };

  const brand = organization?.brand ?? {};
  return {
    account: { id: user.id, name: user.name, email: user.email },
    business: organization
      ? {
          id: organization.id,
          name: organization.name,
          segment: brand.segment ?? "",
          phone: organization.phone ?? "",
          city: organization.address?.city ?? "",
          logoDataUrl: brand.logoDataUrl ?? null,
          brandColor: brand.primaryColor ?? DEFAULT_BRAND_COLOR,
        }
      : null,
    plans: planPage.items
      .filter((plan) => plan.status === "ACTIVE")
      .map((plan) => ({
        id: plan.id,
        name: plan.name,
        description: plan.description ?? "",
        amountCents: plan.amountCents,
        dueDay: plan.dueDay,
        status: "ACTIVE",
      })),
    onboardingComplete: Boolean(organization && brand.onboardingComplete),
    session: true,
  };
}

function organizationPayload(input: {
  business: Business;
  onboardingComplete: boolean;
}) {
  return {
    name: input.business.name,
    phone: input.business.phone || undefined,
    address: input.business.city ? { city: input.business.city } : undefined,
    timezone: "America/Sao_Paulo",
    brand: {
      primaryColor: input.business.brandColor || DEFAULT_BRAND_COLOR,
      logoDataUrl: input.business.logoDataUrl || undefined,
      segment: input.business.segment,
      onboardingComplete: input.onboardingComplete,
    },
  };
}

export async function saveOnboarding(input: {
  business: Business;
  plans: Plan[];
  onboardingComplete: boolean;
}) {
  const user = await currentUser();
  if (!user) throw new Error("Sessão expirada. Entre novamente.");

  const existingOrganization = await ownOrganization();
  const pendingInput = { ...input, onboardingComplete: false };
  if (existingOrganization) {
    await apiRequest("/organization", {
      method: "PATCH",
      body: organizationPayload(pendingInput),
    });
  } else {
    await apiRequest("/organization", {
      method: "POST",
      body: organizationPayload(pendingInput),
    });
  }

  const existingPlans = existingOrganization
    ? await page<ApiPlan>("/plans")
    : { items: [] };
  const submittedIds = new Set(
    input.plans.filter((plan) => /^[0-9a-f-]{36}$/i.test(plan.id)).map((plan) => plan.id),
  );

  await Promise.all([
    ...existingPlans.items
      .filter((plan) => plan.status === "ACTIVE" && !submittedIds.has(plan.id))
      .map((plan) =>
        apiRequest(`/plans/${plan.id}`, {
          method: "PATCH",
          body: { status: "INACTIVE" },
        }),
      ),
    ...input.plans.map((plan) =>
      /^[0-9a-f-]{36}$/i.test(plan.id)
        ? apiRequest(`/plans/${plan.id}`, {
            method: "PATCH",
            body: {
              name: plan.name,
              description: plan.description || undefined,
              amountCents: plan.amountCents,
              dueDay: plan.dueDay,
              status: "ACTIVE",
            },
          })
        : apiRequest("/plans", {
            method: "POST",
            body: {
              name: plan.name,
              description: plan.description || undefined,
              amountCents: plan.amountCents,
              dueDay: plan.dueDay,
            },
          }),
    ),
  ]);

  await apiRequest("/organization", {
    method: "PATCH",
    body: organizationPayload(input),
  });
}

export async function saveBusinessSettings(input: {
  name: string;
  segment: string;
  phone: string;
  city: string;
  logoDataUrl: string | null;
  brandColor: string;
}) {
  const state = await loadState();
  if (!state.account || !state.business) throw new Error("Sessão expirada. Entre novamente.");
  await apiRequest("/organization", {
    method: "PATCH",
    body: organizationPayload({
      business: input,
      onboardingComplete: state.onboardingComplete,
    }),
  });
}

export async function signOut() {
  await logout();
}

const stateStore = createCacheStore(loadState, emptyState);

let authListenerBound = false;
function bindAuthListener() {
  if (authListenerBound || typeof window === "undefined") return;
  authListenerBound = true;
  onAuthChange(() => {
    resetDashboardData();
    void stateStore.refresh();
  });
}

export function useAppState() {
  bindAuthListener();
  const { value, loaded } = useCacheStore(stateStore);
  return { state: value, hydrated: loaded, refresh: stateStore.refresh };
}
