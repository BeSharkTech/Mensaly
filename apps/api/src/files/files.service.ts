import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";

import {
  AuditActorType,
  Prisma,
  StoredFileStatus,
  type StoredFile,
} from "@mensaly/database";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";
import type { FileList } from "./files.dto";
import {
  FILE_SIZE_LIMIT,
  STORAGE_ADAPTER,
  type StorageAdapter,
} from "./storage.adapter";

const SUPPORTED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);
const CLEANUP_LEASE_MS = 5 * 60 * 1000;

function organizationId(auth: AuthenticatedContext): string {
  if (!auth.organizationId) {
    throw new NotFoundException({
      code: "ORGANIZATION_NOT_FOUND",
      message: "Organization context is required",
    });
  }
  return auth.organizationId;
}

function validSignature(contentType: string, body: Buffer): boolean {
  if (contentType === "application/pdf") {
    return body.subarray(0, 5).toString("ascii") === "%PDF-";
  }
  if (contentType === "image/png") {
    return body
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (contentType === "image/jpeg") {
    return (
      body.length >= 4 &&
      body[0] === 0xff &&
      body[1] === 0xd8 &&
      body[body.length - 2] === 0xff &&
      body[body.length - 1] === 0xd9
    );
  }
  return false;
}

function view(file: StoredFile) {
  return {
    id: file.id,
    originalName: file.originalName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    checksumSha256: file.checksumSha256,
    status: file.status,
    createdAt: file.createdAt.toISOString(),
    deletedAt: file.deletedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class FilesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(FILE_SIZE_LIMIT) private readonly sizeLimit: number,
  ) {}

  async upload(
    auth: AuthenticatedContext,
    input: { filename: string; contentType: string; body: Buffer },
  ) {
    const orgId = organizationId(auth);
    const originalName = basename(input.filename.trim());
    if (
      !originalName ||
      originalName.length > 255 ||
      originalName.includes("\0")
    ) {
      throw new BadRequestException({
        code: "INVALID_FILE_NAME",
        message: "File name is invalid",
      });
    }
    if (
      input.body.length === 0 ||
      input.body.length > this.sizeLimit
    ) {
      throw new BadRequestException({
        code: "INVALID_FILE_SIZE",
        message: `File size must be between 1 and ${this.sizeLimit} bytes`,
      });
    }
    if (
      !SUPPORTED_TYPES.has(input.contentType) ||
      !validSignature(input.contentType, input.body)
    ) {
      throw new BadRequestException({
        code: "INVALID_FILE_TYPE",
        message: "Only valid PDF, PNG and JPEG files are accepted",
      });
    }

    const id = randomUUID();
    const storageKey = `${orgId}/${id}`;
    const checksumSha256 = createHash("sha256")
      .update(input.body)
      .digest("hex");
    const metadata = await this.prisma.client.storedFile.create({
      data: {
        id,
        organizationId: orgId,
        uploadedByUserId: auth.userId,
        storageKey,
        originalName,
        contentType: input.contentType,
        sizeBytes: input.body.length,
        checksumSha256,
      },
    });
    try {
      await this.storage.put(storageKey, input.body);
      const active = await this.prisma.client.$transaction(async (tx) => {
        const activated = await tx.storedFile.updateMany({
          where: { id, status: StoredFileStatus.UPLOADING },
          data: { status: StoredFileStatus.ACTIVE },
        });
        if (activated.count !== 1) {
          throw new Error("Upload ownership was lost before activation");
        }
        const file = await tx.storedFile.findUniqueOrThrow({ where: { id } });
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorUserId: auth.userId,
            actorType: AuditActorType.USER,
            action: "file.uploaded",
            entityType: "StoredFile",
            entityId: id,
            after: {
              originalName,
              contentType: input.contentType,
              sizeBytes: input.body.length,
              checksumSha256,
            },
          },
        });
        return file;
      });
      return view(active);
    } catch {
      await Promise.allSettled([
        this.storage.delete(storageKey),
        this.prisma.client.storedFile.update({
          where: { id: metadata.id },
          data: { status: StoredFileStatus.FAILED },
        }),
      ]);
      throw new ServiceUnavailableException({
        code: "FILE_STORAGE_UNAVAILABLE",
        message: "The file could not be persisted",
      });
    }
  }

  async list(auth: AuthenticatedContext, query: FileList) {
    const orgId = organizationId(auth);
    const where = {
      organizationId: orgId,
      status: StoredFileStatus.ACTIVE,
    };
    const [items, total] = await Promise.all([
      this.prisma.client.storedFile.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.client.storedFile.count({ where }),
    ]);
    return {
      items: items.map(view),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(auth: AuthenticatedContext, id: string) {
    return view(await this.activeFile(organizationId(auth), id));
  }

  async download(auth: AuthenticatedContext, id: string) {
    const file = await this.activeFile(organizationId(auth), id);
    const object = await this.storage.get(file.storageKey);
    if (
      !object ||
      object.body.length !== file.sizeBytes ||
      createHash("sha256").update(object.body).digest("hex") !==
        file.checksumSha256
    ) {
      throw new ServiceUnavailableException({
        code: "FILE_STORAGE_CORRUPT",
        message: "The stored file is missing or failed integrity validation",
      });
    }
    return { metadata: view(file), body: object.body };
  }

  async delete(auth: AuthenticatedContext, id: string): Promise<void> {
    const orgId = organizationId(auth);
    const now = new Date();
    const claim = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`stored-file:${id}`}))`,
      );
      const current = await tx.storedFile.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!current) {
        throw new NotFoundException({
          code: "FILE_NOT_FOUND",
          message: "File was not found",
        });
      }
      if (current.status === StoredFileStatus.DELETED) {
        return { kind: "done" as const };
      }
      if (
        current.status === StoredFileStatus.DELETING &&
        current.updatedAt > new Date(now.getTime() - CLEANUP_LEASE_MS)
      ) {
        return { kind: "pending" as const };
      }
      const file = await tx.storedFile.update({
        where: { id },
        data: { status: StoredFileStatus.DELETING },
      });
      return { kind: "claimed" as const, file };
    });
    if (claim.kind !== "claimed") {
      return;
    }
    const { file } = claim;
    try {
      await this.storage.delete(file.storageKey);
      await this.prisma.client.$transaction([
        this.prisma.client.storedFile.update({
          where: { id },
          data: {
            status: StoredFileStatus.DELETED,
            deletedAt: now,
          },
        }),
        this.prisma.client.auditLog.create({
          data: {
            organizationId: orgId,
            actorUserId: auth.userId,
            actorType: AuditActorType.USER,
            action: "file.deleted",
            entityType: "StoredFile",
            entityId: id,
            before: { status: file.status },
            after: { status: StoredFileStatus.DELETED },
          },
        }),
      ]);
    } catch {
      throw new ServiceUnavailableException({
        code: "FILE_CLEANUP_PENDING",
        message: "File cleanup is pending and can be retried safely",
      });
    }
  }

  async cleanup(auth: AuthenticatedContext) {
    const orgId = organizationId(auth);
    const cutoff = new Date(Date.now() - CLEANUP_LEASE_MS);
    const candidates = await this.prisma.client.storedFile.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { status: StoredFileStatus.FAILED },
          {
            status: {
              in: [
                StoredFileStatus.UPLOADING,
                StoredFileStatus.DELETING,
              ],
            },
            updatedAt: { lte: cutoff },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    let cleaned = 0;
    for (const candidate of candidates) {
      try {
        const claimed = await this.prisma.client.$transaction(async (tx) => {
          await tx.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`stored-file:${candidate.id}`}))`,
          );
          const result = await tx.storedFile.updateMany({
            where: {
              id: candidate.id,
              organizationId: orgId,
              status: candidate.status,
              updatedAt: candidate.updatedAt,
            },
            data: { status: StoredFileStatus.DELETING },
          });
          return result.count === 1;
        });
        if (!claimed) {
          continue;
        }
        await this.storage.delete(candidate.storageKey);
        await this.prisma.client.storedFile.update({
          where: { id: candidate.id },
          data: {
            status: StoredFileStatus.DELETED,
            deletedAt: new Date(),
          },
        });
        cleaned += 1;
      } catch {
        // A later controlled cleanup can retry this isolated object.
      }
    }
    if (cleaned > 0) {
      await this.prisma.client.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "file.cleanup_completed",
          entityType: "StoredFile",
          after: { cleaned },
        },
      });
    }
    return { examined: candidates.length, cleaned };
  }

  private async activeFile(organizationId: string, id: string) {
    const file = await this.prisma.client.storedFile.findFirst({
      where: {
        id,
        organizationId,
        status: StoredFileStatus.ACTIVE,
      },
    });
    if (!file) {
      throw new NotFoundException({
        code: "FILE_NOT_FOUND",
        message: "File was not found",
      });
    }
    return file;
  }
}
