import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import {
  AuditActorType,
  Prisma,
  PrismaClient,
  UserRole,
  UserStatus,
} from "@prisma/client";

import { seedPlatformAdmin } from "../prisma/seed-lib";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database integration tests.");
}

const databaseName = new URL(databaseUrl).pathname.slice(1);

if (databaseName !== "mensaly_test") {
  throw new Error(
    `Database integration tests refuse to use "${databaseName || "unknown"}"; expected "mensaly_test".`,
  );
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const testEmailSuffix = "@schema.example.test";

describe("foundation database schema", () => {
  it("enforces a one-to-one organization owner and records audit data", async () => {
    const email = `owner-${randomUUID()}${testEmailSuffix}`;
    const owner = await prisma.user.create({
      data: {
        name: "Test owner",
        email,
        role: UserRole.COMPANY_ACCOUNT,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });

    const organization = await prisma.organization.create({
      data: {
        ownerUserId: owner.id,
        name: "Test organization",
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: organization.id,
        actorUserId: owner.id,
        actorType: AuditActorType.USER,
        action: "organization.created",
        entityType: "Organization",
        entityId: organization.id,
      },
    });

    await assert.rejects(
      prisma.organization.create({
        data: {
          ownerUserId: owner.id,
          name: "Duplicate organization",
        },
      }),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002",
    );

    const persisted = await prisma.organization.findUniqueOrThrow({
      where: { id: organization.id },
      include: { owner: true, auditLogs: true },
    });

    assert.equal(persisted.owner.email, email);
    assert.equal(persisted.auditLogs.length, 1);
  });

  it("enforces case-insensitive unique user emails", async () => {
    const email = `case-${randomUUID()}${testEmailSuffix}`;

    await prisma.user.create({
      data: { name: "First", email: email.toLowerCase() },
    });

    await assert.rejects(
      prisma.user.create({ data: { name: "Second", email: email.toUpperCase() } }),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002",
    );
  });

  it("seeds exactly one passwordless platform administrator", async () => {
    const email = `admin-${randomUUID()}${testEmailSuffix}`;
    const environment = {
      NODE_ENV: "test",
      SEED_PLATFORM_ADMIN_EMAIL: email.toUpperCase(),
    };

    await seedPlatformAdmin(prisma, environment);
    await seedPlatformAdmin(prisma, environment);

    const users = await prisma.user.findMany({
      where: { email },
      include: { accounts: true, organization: true },
    });

    assert.equal(users.length, 1);
    assert.equal(users[0]?.role, UserRole.PLATFORM_ADMIN);
    assert.equal(users[0]?.status, UserStatus.ACTIVE);
    assert.equal(users[0]?.emailVerified, true);
    assert.equal(users[0]?.accounts.length, 0);
    assert.equal(users[0]?.organization, null);
  });

  it("refuses to seed a platform administrator in production", async () => {
    await assert.rejects(
      seedPlatformAdmin(prisma, {
        NODE_ENV: "production",
        SEED_PLATFORM_ADMIN_EMAIL: `admin${testEmailSuffix}`,
      }),
      /cannot run in production/,
    );
  });
});

after(async () => {
  await prisma.auditLog.deleteMany({
    where: { actor: { email: { endsWith: testEmailSuffix } } },
  });
  await prisma.organization.deleteMany({
    where: { owner: { email: { endsWith: testEmailSuffix } } },
  });
  await prisma.user.deleteMany({
    where: { email: { endsWith: testEmailSuffix } },
  });
  await prisma.$disconnect();
});
