import { hashPassword, normalizeEmail } from "@mensaly/auth";
import type { PrismaClient } from "@mensaly/database";

const ids = {
  user: "10000000-0000-4000-8000-000000000001",
  organization: "10000000-0000-4000-8000-000000000002",
  plan: "10000000-0000-4000-8000-000000000003",
  student: "10000000-0000-4000-8000-000000000004",
  guardian: "10000000-0000-4000-8000-000000000005",
  link: "10000000-0000-4000-8000-000000000006",
  enrollment: "10000000-0000-4000-8000-000000000007",
} as const;

export type DemoSeedEnvironment = {
  DATABASE_URL?: string;
  DEMO_SEED_EMAIL?: string;
  DEMO_SEED_ENABLED?: string;
  DEMO_SEED_PASSWORD?: string;
  NODE_ENV?: string;
};

export function validateDemoSeedEnvironment(environment: DemoSeedEnvironment): {
  email: string;
  password: string;
} {
  if (environment.DEMO_SEED_ENABLED !== "true") {
    throw new Error("Demo seed is disabled; set DEMO_SEED_ENABLED=true");
  }
  if (environment.NODE_ENV === "production") {
    throw new Error("Demo seed is forbidden in production");
  }
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const database = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(database.hostname)) {
    throw new Error("Demo seed only accepts a local database host");
  }
  const password = environment.DEMO_SEED_PASSWORD;
  if (!password || password.length < 12 || password.length > 128) {
    throw new Error("DEMO_SEED_PASSWORD must contain 12 to 128 characters");
  }
  return {
    email: normalizeEmail(
      environment.DEMO_SEED_EMAIL ?? "owner.demo@mensaly.local",
    ),
    password,
  };
}

export async function seedDemo(
  prisma: PrismaClient,
  environment: DemoSeedEnvironment,
): Promise<{ email: string; organizationId: string }> {
  const input = validateDemoSeedEnvironment(environment);
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing && existing.id !== ids.user) {
    throw new Error("Demo email belongs to a non-demo account");
  }
  const password = await hashPassword(input.password);

  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: ids.user },
      create: {
        id: ids.user,
        name: "Responsável Demonstração",
        email: input.email,
        emailVerified: true,
        role: "COMPANY_ACCOUNT",
        status: "ACTIVE",
      },
      update: {
        name: "Responsável Demonstração",
        email: input.email,
        emailVerified: true,
        role: "COMPANY_ACCOUNT",
        status: "ACTIVE",
      },
    });
    await tx.account.upsert({
      where: {
        providerId_accountId: {
          providerId: "credential",
          accountId: input.email,
        },
      },
      create: {
        userId: ids.user,
        providerId: "credential",
        accountId: input.email,
        password,
      },
      update: { userId: ids.user, password },
    });
    await tx.organization.upsert({
      where: { id: ids.organization },
      create: {
        id: ids.organization,
        ownerUserId: ids.user,
        name: "Escola Demonstração",
        taxId: "90000000000100",
        phone: "5511999999999",
      },
      update: {
        ownerUserId: ids.user,
        name: "Escola Demonstração",
        status: "ACTIVE",
      },
    });
    await tx.plan.upsert({
      where: { id: ids.plan },
      create: {
        id: ids.plan,
        organizationId: ids.organization,
        name: "Mensalidade padrão",
        amountCents: 15000,
        dueDay: 10,
      },
      update: { amountCents: 15000, dueDay: 10, status: "ACTIVE" },
    });
    await tx.student.upsert({
      where: { id: ids.student },
      create: {
        id: ids.student,
        organizationId: ids.organization,
        name: "Aluno Demonstração",
      },
      update: { name: "Aluno Demonstração", status: "ACTIVE" },
    });
    await tx.guardian.upsert({
      where: { id: ids.guardian },
      create: {
        id: ids.guardian,
        organizationId: ids.organization,
        name: "Responsável Demonstração",
        phone: "5511988888888",
        taxId: "90000000002",
      },
      update: { phone: "5511988888888", status: "ACTIVE" },
    });
    await tx.studentGuardian.upsert({
      where: { id: ids.link },
      create: {
        id: ids.link,
        organizationId: ids.organization,
        studentId: ids.student,
        guardianId: ids.guardian,
        relationship: "Responsável",
      },
      update: { active: true, endedAt: null },
    });
    await tx.enrollment.upsert({
      where: { id: ids.enrollment },
      create: {
        id: ids.enrollment,
        organizationId: ids.organization,
        studentId: ids.student,
        guardianId: ids.guardian,
        planId: ids.plan,
        amountCents: 15000,
        dueDay: 10,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        planNameSnapshot: "Mensalidade padrão",
      },
      update: { status: "ACTIVE", amountCents: 15000, dueDay: 10 },
    });
  });

  return { email: input.email, organizationId: ids.organization };
}
