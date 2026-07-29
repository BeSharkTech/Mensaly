import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";
import type { AuditList } from "./audit.dto";

function organizationId(auth: AuthenticatedContext): string {
  if (!auth.organizationId) {
    throw new NotFoundException({
      code: "ORGANIZATION_NOT_FOUND",
      message: "Organization context is required",
    });
  }
  return auth.organizationId;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async list(
    auth: AuthenticatedContext,
    query: AuditList,
  ): Promise<{
    items: unknown[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where = {
      organizationId: organizationId(auth),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.auditLog.findMany({
        where,
        select: {
          id: true,
          actorType: true,
          action: true,
          entityType: true,
          entityId: true,
          before: true,
          after: true,
          correlationId: true,
          createdAt: true,
          actor: { select: { id: true, name: true, role: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.client.auditLog.count({ where }),
    ]);
    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
