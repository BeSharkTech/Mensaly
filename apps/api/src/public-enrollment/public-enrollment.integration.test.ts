import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import {
  disconnectPrismaClient,
  getPrismaClient,
  StoredFileStatus,
  UserRole,
  UserStatus,
} from "@mensaly/database";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";
import { PublicEnrollmentService } from "./public-enrollment.service";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname.slice(1) !== "mensaly_test") {
  throw new Error(
    "Public enrollment integration tests require the isolated mensaly_test database.",
  );
}

process.env.PUBLIC_ENROLLMENT_LINK_SECRET = Buffer.alloc(32, 31).toString(
  "base64",
);
process.env.WEB_APP_URL = "https://app.example.test";

function submission(
  planId: string,
  document: { value: string },
  photoFileId: string,
  guardianCpf = "52998224725",
) {
  return {
    student: {
      name: `Aluno ${document.value}`,
      document,
      photoFileId,
      birthDate: "2015-03-10",
      phone: "11988887777",
    },
    guardian: {
      name: "Responsável Integração",
      cpf: guardianCpf,
      phone: "11999998888",
      relationship: "Mãe",
    },
    selfResponsible: false,
    planId,
    studentValues: {},
    guardianValues: {},
    privacyAccepted: true as const,
    privacyNoticeVersion: "2026-08-01",
    companyWebsite: "",
  };
}

describe("Public student enrollment", () => {
  it("stores a pending request without creating operational records and protects replay, duplicates and tenants", async () => {
    const prisma = getPrismaClient();
    const suffix = randomUUID();
    const owner = await prisma.user.create({
      data: {
        name: "Enrollment Owner",
        email: `enrollment-${suffix}@example.test`,
        emailVerified: true,
        role: UserRole.COMPANY_ACCOUNT,
        status: UserStatus.ACTIVE,
      },
    });
    const organization = await prisma.organization.create({
      data: {
        ownerUserId: owner.id,
        name: `Local ${suffix}`,
        timezone: "America/Sao_Paulo",
      },
    });
    const plan = await prisma.plan.create({
      data: {
        organizationId: organization.id,
        name: "Mensal",
        description: "Plano mensal",
        amountCents: 18_500,
        dueDay: 10,
      },
    });
    const auth: AuthenticatedContext = {
      userId: owner.id,
      email: owner.email,
      role: "COMPANY_ACCOUNT",
      organizationId: organization.id,
    };
    const deletedStorageKeys: string[] = [];
    const service = new PublicEnrollmentService(new PrismaService(), {
      deletePublicStudentPhotoObject: async ({ storageKey }: { storageKey: string }) => {
        deletedStorageKeys.push(storageKey);
      },
    } as never);

    const settings = await service.create(auth, {
      correlationId: randomUUID(),
      ipAddress: "203.0.113.10",
    });
    assert.equal(settings.configured, true);
    const token = new URL(settings.link).pathname.split("/").at(-1)!;
    const publicPhoto = async () => {
      const id = randomUUID();
      return prisma.storedFile.create({
        data: {
          id,
          organizationId: organization.id,
          storageKey: `${organization.id}/public-enrollment/student-photo/${id}`,
          originalName: "student.png",
          contentType: "image/png",
          sizeBytes: 8,
          checksumSha256: "a".repeat(64),
          status: StoredFileStatus.ACTIVE,
        },
      });
    };
    const input = submission(
      plan.id,
      { value: "12.345.678-X" },
      (await publicPhoto()).id,
    );
    const correlationId = randomUUID();
    const first = await service.submit(token, "public-test-attempt-1", input, {
      correlationId,
      ipAddress: "203.0.113.11",
      userAgent: "integration-test",
    });
    assert.equal(first.replayed, false);
    assert.ok("submissionId" in first);
    assert.equal(first.status, "PENDING");
    assert.equal(
      await prisma.student.count({ where: { organizationId: organization.id } }),
      0,
    );
    assert.equal(
      await prisma.enrollment.count({ where: { organizationId: organization.id } }),
      0,
    );

    const replay = await service.submit(token, "public-test-attempt-1", input, {
      correlationId,
      ipAddress: "203.0.113.11",
    });
    assert.equal(replay.replayed, true);
    assert.ok("submissionId" in replay);
    assert.equal(replay.submissionId, first.submissionId);

    const stored = await prisma.publicEnrollmentSubmission.findUniqueOrThrow({
      where: { id: first.submissionId },
    });
    assert.equal(stored.status, "PENDING");
    assert.equal(stored.studentRg, "12345678X");
    assert.equal(stored.studentId, null);
    assert.equal(stored.guardianId, null);
    assert.equal(stored.enrollmentId, null);
    assert.equal(stored.consentVersion, "2026-08-01");
    assert.equal(stored.ipHash.length, 64);

    await assert.rejects(
      service.submit(token, "public-test-attempt-2", input, {
        ipAddress: "203.0.113.12",
      }),
      (error: unknown) =>
        JSON.stringify(error).includes("STUDENT_ALREADY_REGISTERED"),
    );
    const toRejectPhoto = await publicPhoto();
    const toReject = await service.submit(
      token,
      "public-test-to-reject",
      submission(plan.id, { value: "11144477735" }, toRejectPhoto.id),
      { ipAddress: "203.0.113.13" },
    );
    assert.equal(toReject.status, "PENDING");

    const concurrentInput = submission(
      plan.id,
      { value: "CONCURRENT-99" },
      (await publicPhoto()).id,
    );
    const concurrent = await Promise.allSettled([
      service.submit(token, "public-concurrent-a", concurrentInput, {
        ipAddress: "203.0.113.14",
      }),
      service.submit(token, "public-concurrent-b", concurrentInput, {
        ipAddress: "203.0.113.15",
      }),
    ]);
    assert.equal(
      concurrent.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      concurrent.filter((result) => result.status === "rejected").length,
      1,
    );

    const secondOwner = await prisma.user.create({
      data: {
        name: "Other Owner",
        email: `enrollment-other-${suffix}@example.test`,
        emailVerified: true,
        role: UserRole.COMPANY_ACCOUNT,
        status: UserStatus.ACTIVE,
      },
    });
    const secondOrganization = await prisma.organization.create({
      data: { ownerUserId: secondOwner.id, name: `Other ${suffix}` },
    });
    const foreignPlan = await prisma.plan.create({
      data: {
        organizationId: secondOrganization.id,
        name: "Foreign",
        amountCents: 1,
        dueDay: 1,
      },
    });
    await assert.rejects(
      service.submit(
        token,
        "public-foreign-plan",
        submission(
          foreignPlan.id,
          { value: "FOREIGN-991" },
          (await publicPhoto()).id,
        ),
        { ipAddress: "203.0.113.16" },
      ),
      (error: unknown) => JSON.stringify(error).includes("PLAN_NOT_AVAILABLE"),
    );

    const approved = await service.approve(auth, first.submissionId, {
      correlationId,
    });
    assert.equal(approved.status, "APPROVED");
    const approvedSubmission =
      await prisma.publicEnrollmentSubmission.findUniqueOrThrow({
        where: { id: first.submissionId },
        include: { student: true, guardian: true, enrollment: { include: { charges: true } } },
      });
    assert.equal(approvedSubmission.student?.rg, "12345678X");
    assert.equal(approvedSubmission.guardian?.taxId, "52998224725");
    assert.equal(approvedSubmission.enrollment?.amountCents, 18_500);
    assert.equal(approvedSubmission.enrollment?.charges.length, 0);

    const rejected = await service.reject(auth, toReject.submissionId, {
      correlationId,
    });
    assert.equal(rejected.deleted, true);
    assert.equal(
      await prisma.publicEnrollmentSubmission.findUnique({
        where: { id: toReject.submissionId },
      }),
      null,
    );
    assert.equal(
      await prisma.storedFile.findUnique({ where: { id: toRejectPhoto.id } }),
      null,
    );
    assert.equal(deletedStorageKeys.includes(toRejectPhoto.storageKey), true);

    await service.rotate(auth);
    await assert.rejects(service.publicConfiguration(token), (error: unknown) =>
      JSON.stringify(error).includes("PUBLIC_ENROLLMENT_LINK_INVALID"),
    );
  });
});

after(async () => {
  await disconnectPrismaClient();
});
