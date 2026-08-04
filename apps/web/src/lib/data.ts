import { apiEnvelopeRequest, apiRequest, ApiRequestError } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { createCacheStore, useCacheStore } from "@/lib/cache";
import { currentReferenceMonth } from "@/lib/format";
import type {
  ChargeStatus,
  MessageScheduleStatus,
  PaymentMethod,
  PaymentStatus,
} from "@/lib/format";

export type Guardian = {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: "ACTIVE" | "INACTIVE";
  studentsCount: number;
};

export type Student = {
  id: string;
  name: string;
  cpf: string;
  birthDate: string | null;
  guardian: string;
  guardianId: string | null;
  plan: string;
  planId: string | null;
  enrollmentId: string | null;
  status: "ACTIVE" | "INACTIVE";
};

export type CustomFieldType = "TEXT" | "NUMBER" | "DATE" | "SELECT" | "BOOLEAN";
export type CustomField = {
  id: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  required: boolean;
  sortOrder: number;
  active: boolean;
};
export type StudentFieldValues = Record<string, Record<string, string>>;

export type Enrollment = {
  id: string;
  student: string;
  plan: string;
  startDate: string;
  endDate: string | null;
  discountCents: number;
  status: "ACTIVE" | "ENDED" | "CANCELLED";
};

export type Charge = {
  id: string;
  studentId: string | null;
  student: string;
  plan: string;
  referenceMonth: string;
  dueDate: string;
  amountCents: number;
  discountCents: number;
  finalAmountCents: number;
  status: ChargeStatus;
};

export type Payment = {
  id: string;
  chargeId: string | null;
  student: string;
  amountCents: number;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: string;
  idempotencyKey: string;
};

export type MessageTemplate = {
  id: string;
  name: string;
  timing: "BEFORE_DUE" | "ON_DUE" | "AFTER_DUE";
  body: string;
  active: boolean;
};

export type MessageSchedule = {
  id: string;
  recipient: string;
  student: string;
  template: string;
  scheduledFor: string;
  status: MessageScheduleStatus;
  attempts: number;
};

export type StoredFile = {
  id: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
};
export type AuditLog = {
  id: string;
  action: string;
  entity: string;
  actor: string;
  actorType: "USER" | "SYSTEM";
  correlationId: string;
  createdAt: string;
};
export type WebhookEvent = {
  id: string;
  provider: string;
  eventType: string;
  status: string;
  attempts: number;
  receivedAt: string;
};
export type Organization = {
  id: string;
  name: string;
  owner: string;
  segment: string;
  city: string;
  students: number;
  status: "ACTIVE" | "INACTIVE" | "BLOCKED" | "PENDING";
  createdAt: string;
};
export type Failure = {
  id: string;
  type: string;
  reference: string;
  organization: string;
  code: string;
  occurredAt: string;
  retryable: boolean;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  stockQuantity: number;
  imageDataUrl: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
};
export type EventItem = {
  id: string;
  name: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string | null;
  priceCents: number;
  imageDataUrl: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
};
export type BroadcastTarget = "GENERAL" | "PLAN" | "PRODUCT" | "EVENT" | "FORM";
export type BroadcastScheduleType = "MANUAL" | "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY";
export type BroadcastMessage = {
  id: string;
  name: string;
  body: string;
  targetType: BroadcastTarget;
  planId: string | null;
  productId: string | null;
  eventId: string | null;
  active: boolean;
  scheduledFor: string | null;
  scheduleType: BroadcastScheduleType;
  dayOfMonth: number | null;
  weekday: number | null;
  sendTime: string;
  repeatUntil: string | null;
  createdAt: string;
};
export type BroadcastSend = {
  id: string;
  messageId: string;
  studentId: string | null;
  studentName: string;
  recipient: string;
  status: string;
  sentAt: string;
  scheduledFor: string | null;
};
export type PlanRow = {
  id: string;
  name: string;
  description: string;
  amountCents: number;
  chargeOpenDay: number;
  chargeOpenTime: string;
  dueDay: number;
  status: "ACTIVE" | "INACTIVE";
  enrollments: number;
};

export type DashboardData = {
  guardians: Guardian[];
  students: Student[];
  plans: PlanRow[];
  enrollments: Enrollment[];
  charges: Charge[];
  payments: Payment[];
  templates: MessageTemplate[];
  schedules: MessageSchedule[];
  files: StoredFile[];
  auditLogs: AuditLog[];
  webhookEvents: WebhookEvent[];
  organizations: Organization[];
  failures: Failure[];
  customFields: CustomField[];
  products: Product[];
  events: EventItem[];
  broadcasts: BroadcastMessage[];
  broadcastSends: BroadcastSend[];
  studentFieldValues: StudentFieldValues;
  overview: {
    monthlyBilledCents: number;
    monthlyReceivedCents: number;
    openChargesCents: number;
    overdueChargesCents: number;
    overdueChargesCount: number;
    activeStudents: number;
    activeEnrollments: number;
    messagesDelivered: number;
    messageFailures: number;
    messagesQueued: number;
  };
  monthlyEvolution: { month: string; billed: number; received: number }[];
  referenceMonth: string;
};

export const emptyData: DashboardData = {
  guardians: [],
  students: [],
  plans: [],
  enrollments: [],
  charges: [],
  payments: [],
  templates: [],
  schedules: [],
  files: [],
  auditLogs: [],
  webhookEvents: [],
  organizations: [],
  failures: [],
  customFields: [],
  products: [],
  events: [],
  broadcasts: [],
  broadcastSends: [],
  studentFieldValues: {},
  overview: {
    monthlyBilledCents: 0,
    monthlyReceivedCents: 0,
    openChargesCents: 0,
    overdueChargesCents: 0,
    overdueChargesCount: 0,
    activeStudents: 0,
    activeEnrollments: 0,
    messagesDelivered: 0,
    messageFailures: 0,
    messagesQueued: 0,
  },
  monthlyEvolution: [],
  referenceMonth: currentReferenceMonth(),
};

type Page<T> = { items: T[]; page: number; pageSize: number; total: number };
type RawAdminOverview = {
  organizations: { total: number; active: number; inactive: number; blocked: number };
  activeStudents: number;
  charges: number;
  confirmedAmountCents: number;
  pendingAmountCents: number;
  failures: { messages: number; webhooks: number };
};
type RawAdminOrganization = {
  id: string;
  name: string;
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
  createdAt: string;
  owner: { name: string; email: string };
  _count: { students: number };
};
type RawAdminFailures = {
  messages: Array<{
    id: string;
    organizationId: string;
    status: string;
    lastErrorCode: string | null;
    lastAttemptAt: string | null;
  }>;
  webhooks: Array<{
    id: string;
    organizationId: string;
    provider: string;
    eventType: string;
    status: string;
    lastErrorCode: string | null;
    failedAt: string | null;
  }>;
};
type RawWebhookEvent = {
  id: string;
  provider: string;
  eventType: string;
  status: string;
  attemptCount: number;
  receivedAt: string;
};
type RawOrganization = {
  id: string;
  name: string;
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
  address: { city?: string } | null;
  brand: { segment?: string; onboardingComplete?: boolean } | null;
  createdAt: string;
};
type RawPlan = {
  id: string;
  name: string;
  description: string | null;
  amountCents: number;
  chargeOpenDay: number;
  chargeOpenTime: string;
  dueDay: number;
  status: "ACTIVE" | "INACTIVE";
};
type RawStudent = {
  id: string;
  name: string;
  cpf: string | null;
  birthDate?: string | null;
  status: "ACTIVE" | "INACTIVE";
};
type RawGuardian = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  status: "ACTIVE" | "INACTIVE";
};
type RawEnrollment = {
  id: string;
  studentId: string;
  guardianId: string;
  planId: string;
  startDate: string;
  endDate: string | null;
  discountCents: number;
  status: Enrollment["status"];
  student: RawStudent;
  guardian: RawGuardian;
  plan: RawPlan;
};
type RawCharge = {
  id: string;
  enrollmentId: string;
  referenceMonth: string;
  dueDate: string;
  amountCents: number;
  discountCents: number;
  finalAmountCents: number;
  status: ChargeStatus;
  enrollment: RawEnrollment;
};
type RawTemplate = {
  id: string;
  name: string;
  body: string;
  active: boolean;
};
type RawSchedule = {
  id: string;
  recipientNameSnapshot: string;
  recipientPhoneSnapshot: string;
  scheduledFor: string;
  status: MessageScheduleStatus;
  attemptCount: number;
  template: { id: string; name: string };
};
type RawFile = {
  id: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
};
type RawPayment = {
  id: string;
  chargeId: string;
  amountCents: number;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: string;
  idempotencyKey: string;
  charge: { enrollment: { student: { name: string } } };
};
type RawOverview = {
  referenceMonth: string;
  activeStudents: number;
  expectedAmountCents: number;
  receivedAmountCents: number;
  pendingAmountCents: number;
  overdueCharges: number;
};
type RawEvolution = {
  month: string;
  expectedAmountCents: number;
  receivedAmountCents: number;
};
type WorkspaceData = {
  customFields: CustomField[];
  studentFieldValues: StudentFieldValues;
  products: Product[];
  events: EventItem[];
  broadcasts: BroadcastMessage[];
  broadcastSends: BroadcastSend[];
};

function list<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

async function optional<T>(request: Promise<T>, fallback: T): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return fallback;
    throw error;
  }
}

async function page<T>(path: string): Promise<Page<T>> {
  const result = await apiEnvelopeRequest<T[] | Partial<Page<T>>>(path, {
    query: { page: 1, pageSize: 100 },
  });
  const meta = result.meta ?? {};
  const legacyPage =
    !Array.isArray(result.data) && result.data && typeof result.data === "object"
      ? result.data
      : null;
  const items = Array.isArray(result.data)
    ? result.data
    : Array.isArray(legacyPage?.items)
      ? legacyPage.items
      : [];
  return {
    items,
    page:
      typeof meta.page === "number"
        ? meta.page
        : typeof legacyPage?.page === "number"
          ? legacyPage.page
          : 1,
    pageSize:
      typeof meta.limit === "number"
        ? meta.limit
        : typeof meta.pageSize === "number"
          ? meta.pageSize
          : typeof legacyPage?.pageSize === "number"
            ? legacyPage.pageSize
            : 100,
    total:
      typeof meta.total === "number"
        ? meta.total
        : typeof legacyPage?.total === "number"
          ? legacyPage.total
          : items.length,
  };
}

function isoDate(value: string) {
  return value.slice(0, 10);
}

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

async function loadAdminDashboardData(): Promise<DashboardData> {
  const [overview, organizations, failures, webhookEvents] = await Promise.all([
    apiRequest<RawAdminOverview>("/admin/overview"),
    apiRequest<RawAdminOrganization[]>("/admin/organizations", {
      query: { page: 1, pageSize: 100 },
    }),
    apiRequest<RawAdminFailures>("/admin/failures", { query: { limit: 100 } }),
    apiRequest<RawWebhookEvent[]>("/admin/webhook-events", {
      query: { page: 1, pageSize: 100 },
    }),
  ]);
  const names = new Map(organizations.map((organization) => [organization.id, organization.name]));
  const failureRows: Failure[] = [
    ...failures.messages.map((failure) => ({
      id: `message-${failure.id}`,
      type: "Mensagem",
      reference: failure.id.slice(0, 8),
      organization: names.get(failure.organizationId) ?? failure.organizationId.slice(0, 8),
      code: failure.lastErrorCode ?? failure.status,
      occurredAt: failure.lastAttemptAt ?? new Date(0).toISOString(),
      retryable: failure.status === "FAILED_RETRYABLE",
    })),
    ...failures.webhooks.map((failure) => ({
      id: `webhook-${failure.id}`,
      type: "Webhook",
      reference: failure.id.slice(0, 8),
      organization: names.get(failure.organizationId) ?? failure.organizationId.slice(0, 8),
      code: failure.lastErrorCode ?? failure.status,
      occurredAt: failure.failedAt ?? new Date(0).toISOString(),
      retryable: failure.status === "FAILED_RETRYABLE",
    })),
  ];
  return {
    ...emptyData,
    organizations: organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      owner: organization.owner.name || organization.owner.email,
      segment: "",
      city: "",
      students: organization._count.students,
      status: organization.status,
      createdAt: organization.createdAt,
    })),
    failures: failureRows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    webhookEvents: webhookEvents.map((event) => ({
      id: event.id,
      provider: event.provider,
      eventType: event.eventType,
      status: event.status,
      attempts: event.attemptCount,
      receivedAt: event.receivedAt,
    })),
    overview: {
      ...emptyData.overview,
      monthlyBilledCents: overview.confirmedAmountCents + overview.pendingAmountCents,
      monthlyReceivedCents: overview.confirmedAmountCents,
      openChargesCents: overview.pendingAmountCents,
      activeStudents: overview.activeStudents,
      messageFailures: overview.failures.messages + overview.failures.webhooks,
    },
  };
}

export async function loadDashboardData(): Promise<DashboardData> {
  const user = await currentUser();
  if (!user) return emptyData;
  if (user.role === "PLATFORM_ADMIN") return loadAdminDashboardData();

  const [
    organization,
    planPage,
    studentPage,
    guardianPage,
    enrollmentPage,
    chargePage,
    templatePage,
    schedulePage,
    filePage,
    workspace,
    rawPayments,
    rawOverview,
    rawEvolution,
  ] = await Promise.all([
    optional(apiRequest<RawOrganization>("/organization"), null),
    optional(page<RawPlan>("/plans"), {
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    }),
    optional(page<RawStudent>("/students"), {
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    }),
    optional(page<RawGuardian>("/guardians"), {
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    }),
    optional(page<RawEnrollment>("/enrollments"), {
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    }),
    optional(page<RawCharge>("/charges"), {
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    }),
    optional(page<RawTemplate>("/message-templates"), {
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    }),
    optional(page<RawSchedule>("/message-schedules"), {
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    }),
    optional(page<RawFile>("/files"), {
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    }),
    optional(apiRequest<WorkspaceData>("/workspace"), {
      customFields: [],
      studentFieldValues: {},
      products: [],
      events: [],
      broadcasts: [],
      broadcastSends: [],
    }),
    optional(
      apiRequest<RawPayment[]>("/dashboard/recent-payments", {
        query: { limit: 50 },
      }),
      [],
    ),
    optional(apiRequest<RawOverview>("/dashboard/overview"), {
      referenceMonth: currentReferenceMonth(),
      activeStudents: 0,
      expectedAmountCents: 0,
      receivedAmountCents: 0,
      pendingAmountCents: 0,
      overdueCharges: 0,
    }),
    optional(
      apiRequest<RawEvolution[]>("/dashboard/monthly-evolution", {
        query: { months: 6 },
      }),
      [],
    ),
  ]);

  const activeEnrollment = new Map<string, RawEnrollment>();
  list(enrollmentPage.items)
    .filter((enrollment) => enrollment.status === "ACTIVE")
    .forEach((enrollment) => {
      if (!activeEnrollment.has(enrollment.studentId)) {
        activeEnrollment.set(enrollment.studentId, enrollment);
      }
    });

  const students: Student[] = list(studentPage.items).filter((student) => student.status === "ACTIVE").map((student) => {
    const enrollment = activeEnrollment.get(student.id);
    return {
      id: student.id,
      name: student.name,
      cpf: student.cpf ?? "",
      birthDate: student.birthDate ?? null,
      guardian: enrollment?.guardian.name ?? "—",
      guardianId: enrollment?.guardianId ?? null,
      plan: enrollment?.plan.name ?? "—",
      planId: enrollment?.planId ?? null,
      enrollmentId: enrollment?.id ?? null,
      status: student.status,
    };
  });

  const guardians: Guardian[] = list(guardianPage.items).map((guardian) => ({
    id: guardian.id,
    name: guardian.name,
    email: guardian.email ?? "",
    phone: guardian.phone,
    status: guardian.status,
    studentsCount: list(enrollmentPage.items).filter(
      (enrollment) => enrollment.guardianId === guardian.id && enrollment.status === "ACTIVE",
    ).length,
  }));
  const enrollments: Enrollment[] = list(enrollmentPage.items).map((enrollment) => ({
    id: enrollment.id,
    student: enrollment.student.name,
    plan: enrollment.plan.name,
    startDate: isoDate(enrollment.startDate),
    endDate: enrollment.endDate ? isoDate(enrollment.endDate) : null,
    discountCents: enrollment.discountCents,
    status: enrollment.status,
  }));
  const plans: PlanRow[] = list(planPage.items).filter((plan) => plan.status === "ACTIVE").map((plan) => ({
    id: plan.id,
    name: plan.name,
    description: plan.description ?? "Plano mensal",
    amountCents: plan.amountCents,
    chargeOpenDay: plan.chargeOpenDay,
    chargeOpenTime: plan.chargeOpenTime,
    dueDay: plan.dueDay,
    status: plan.status,
    enrollments: list(enrollmentPage.items).filter(
      (enrollment) => enrollment.planId === plan.id && enrollment.status === "ACTIVE",
    ).length,
  }));
  const charges: Charge[] = list(chargePage.items).map((charge) => ({
    id: charge.id,
    studentId: charge.enrollment.studentId,
    student: charge.enrollment.student.name,
    plan: charge.enrollment.plan.name,
    referenceMonth: isoDate(charge.referenceMonth).slice(0, 7),
    dueDate: isoDate(charge.dueDate),
    amountCents: charge.amountCents,
    discountCents: charge.discountCents,
    finalAmountCents: charge.finalAmountCents,
    status: charge.status,
  }));
  const templates: MessageTemplate[] = list(templatePage.items).map((template) => ({
    ...template,
    timing: "BEFORE_DUE",
  }));
  const schedules: MessageSchedule[] = list(schedulePage.items).map((schedule) => ({
    id: schedule.id,
    recipient: schedule.recipientNameSnapshot || schedule.recipientPhoneSnapshot,
    student: schedule.recipientNameSnapshot,
    template: schedule.template.name,
    scheduledFor: schedule.scheduledFor,
    status: schedule.status,
    attempts: schedule.attemptCount,
  }));
  const files: StoredFile[] = list(filePage.items).map((file) => ({
    id: file.id,
    originalName: file.originalName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    status: file.status,
    createdAt: file.createdAt,
  }));
  const payments: Payment[] = (Array.isArray(rawPayments) ? rawPayments : []).map((payment) => ({
    id: payment.id,
    chargeId: payment.chargeId,
    student: payment.charge.enrollment.student.name,
    amountCents: payment.amountCents,
    method: payment.method,
    status: payment.status,
    paidAt: payment.paidAt,
    idempotencyKey: payment.idempotencyKey,
  }));

  const today = new Date().toISOString().slice(0, 10);
  const reference = currentReferenceMonth();
  const monthCharges = charges.filter((charge) => charge.referenceMonth === reference);
  const openCharges = monthCharges.filter((charge) => charge.status === "PENDING");
  const overdue = openCharges.filter((charge) => charge.dueDate < today);
  const sum = <T,>(rows: T[], pick: (row: T) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const failures: Failure[] = schedules
    .filter((message) => message.status.startsWith("FAILED"))
    .map((message) => ({
      id: `msg-${message.id}`,
      type: "Mensagem",
      reference: message.id.slice(0, 8),
      organization: organization?.name ?? "—",
      code: message.status,
      occurredAt: message.scheduledFor,
      retryable: message.status === "FAILED_RETRYABLE",
    }));

  return {
    ...emptyData,
    guardians,
    students,
    plans,
    enrollments,
    charges,
    payments,
    templates,
    schedules,
    files,
    organizations: organization
      ? [
          {
            id: organization.id,
            name: organization.name,
            owner: user.name,
            segment: organization.brand?.segment ?? "",
            city: organization.address?.city ?? "",
            students: students.length,
            status: organization.brand?.onboardingComplete ? "ACTIVE" : "PENDING",
            createdAt: organization.createdAt,
          },
        ]
      : [],
    failures,
    customFields: list(workspace?.customFields),
    studentFieldValues: workspace?.studentFieldValues ?? {},
    products: list(workspace?.products),
    events: list(workspace?.events),
    broadcasts: list(workspace?.broadcasts),
    broadcastSends: list(workspace?.broadcastSends),
    overview: {
      monthlyBilledCents: rawOverview.expectedAmountCents,
      monthlyReceivedCents: rawOverview.receivedAmountCents,
      openChargesCents: rawOverview.pendingAmountCents,
      overdueChargesCents: sum(overdue, (charge) => charge.finalAmountCents),
      overdueChargesCount: rawOverview.overdueCharges,
      activeStudents: rawOverview.activeStudents,
      activeEnrollments: enrollments.filter((enrollment) => enrollment.status === "ACTIVE").length,
      messagesDelivered: schedules.filter(
        (message) => message.status === "DELIVERED" || message.status === "READ",
      ).length,
      messageFailures: failures.length,
      messagesQueued: schedules.filter((message) =>
        ["SCHEDULED", "QUEUED", "PROCESSING"].includes(message.status),
      ).length,
    },
    monthlyEvolution: (Array.isArray(rawEvolution) ? rawEvolution : []).map((item) => ({
      month: MONTH_LABELS[Number(item.month.slice(5, 7)) - 1] ?? item.month,
      billed: item.expectedAmountCents / 100_000,
      received: item.receivedAmountCents / 100_000,
    })),
    referenceMonth: rawOverview.referenceMonth || reference,
  };
}

const dashboardStore = createCacheStore(loadDashboardData, emptyData);

export function useDashboardData() {
  const { value, loaded } = useCacheStore(dashboardStore);
  return { data: value, loading: !loaded, refresh: dashboardStore.refresh };
}

export function resetDashboardData() {
  dashboardStore.reset();
}

export async function updateOrganizationStatus(
  organizationId: string,
  status: "ACTIVE" | "INACTIVE" | "BLOCKED",
) {
  await apiRequest(`/admin/organizations/${organizationId}/status`, {
    method: "PATCH",
    body: { status },
  });
  await dashboardStore.refresh();
}

export async function organizationHistory(organizationId: string) {
  return apiRequest<Array<{
    action: string;
    createdAt: string;
    actor: { name: string; email: string } | null;
  }>>(`/admin/organizations/${organizationId}/history`, {
    query: { page: 1, pageSize: 20 },
  });
}

export async function reprocessWebhook(eventId: string) {
  await apiRequest(`/admin/webhook-events/${eventId}/process`, {
    method: "POST",
  });
  await dashboardStore.refresh();
}
