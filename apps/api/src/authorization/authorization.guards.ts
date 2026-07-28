import { OrganizationStatus, UserRole } from "@mensaly/database";
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { AuthService } from "../auth/auth.service";
import { readSessionToken } from "../auth/session-cookie";
import { PrismaService } from "../infrastructure/database/prisma.service";
import { contextRequest, currentAuthContext } from "./authorization-context";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = await this.authService.currentSession(readSessionToken(request.headers.cookie));
    contextRequest(request).authContext = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };
    return true;
  }
}

@Injectable()
export class CompanyAccountGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = currentAuthContext(request);
    if (!auth || auth.role !== UserRole.COMPANY_ACCOUNT) {
      throw new ForbiddenException({
        code: "COMPANY_ACCOUNT_REQUIRED",
        message: "A company account is required",
      });
    }

    const organization = await this.prisma.client.organization.findUnique({
      where: { ownerUserId: auth.userId },
      select: { id: true, status: true },
    });
    if (!organization) {
      return true;
    }
    if (organization.status !== OrganizationStatus.ACTIVE) {
      throw new ForbiddenException({
        code: "ORGANIZATION_INACTIVE",
        message: "This organization is unavailable",
      });
    }
    contextRequest(request).authContext = { ...auth, organizationId: organization.id };
    return true;
  }
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = currentAuthContext(request);
    if (!auth || auth.role !== UserRole.PLATFORM_ADMIN) {
      throw new ForbiddenException({
        code: "PLATFORM_ADMIN_REQUIRED",
        message: "A platform administrator is required",
      });
    }
    return true;
  }
}
