import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  verifyPassword,
} from "@mensaly/auth";
import { AuditActorType, Prisma, UserRole, UserStatus } from "@mensaly/database";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

import { PrismaService } from "../infrastructure/database/prisma.service";
import { loginSchema } from "./login.dto";
import { registerSchema } from "./register.dto";

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

type AccessMetadata = {
  ipAddress?: string;
  userAgent?: string;
};

type RegisteredUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  status: UserStatus;
};

type AuthenticatedUser = RegisteredUser & {
  role: UserRole;
};

type LoginResult = {
  token: string;
  user: AuthenticatedUser;
};

function validationError(issues: { path: PropertyKey[]; message: string }[]): BadRequestException {
  return new BadRequestException({
    code: "VALIDATION_ERROR",
    message: "Invalid request data",
    details: issues.map((issue) => ({
      field: issue.path.join(".") || undefined,
      message: issue.message,
    })),
  });
}

function accessMetadata(metadata: AccessMetadata): AccessMetadata {
  return {
    ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress.slice(0, 64) } : {}),
    ...(metadata.userAgent ? { userAgent: metadata.userAgent.slice(0, 1_024) } : {}),
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async register(rawInput: unknown): Promise<RegisteredUser> {
    const result = registerSchema.safeParse(rawInput);

    if (!result.success) {
      throw validationError(result.error.issues);
    }

    const input = result.data;
    const email = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);

    try {
      return await this.prisma.client.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            name: input.name,
            email,
            role: UserRole.COMPANY_ACCOUNT,
            status: UserStatus.PENDING_VERIFICATION,
          },
          select: {
            id: true,
            name: true,
            email: true,
            emailVerified: true,
            status: true,
          },
        });

        await transaction.account.create({
          data: {
            userId: user.id,
            accountId: email,
            providerId: "credential",
            password: passwordHash,
          },
        });

        await transaction.auditLog.create({
          data: {
            actor: { connect: { id: user.id } },
            actorType: AuditActorType.USER,
            action: "auth.registration.created",
            entityType: "User",
            entityId: user.id,
          },
        });

        return user;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException({
          code: "EMAIL_ALREADY_REGISTERED",
          message: "An account with this email already exists",
        });
      }

      throw error;
    }
  }

  async login(
    rawInput: unknown,
    metadata: AccessMetadata,
    sessionTtlHours: number,
  ): Promise<LoginResult> {
    const result = loginSchema.safeParse(rawInput);

    if (!result.success) {
      throw validationError(result.error.issues);
    }

    const email = normalizeEmail(result.data.email);
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionTtlHours * 60 * 60 * 1_000);
    const since = new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MS);
    const auditMetadata = accessMetadata(metadata);

    const outcome = await this.prisma.client.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${email}))
      `;

      const failures = await transaction.auditLog.count({
        where: {
          action: "auth.login.failed",
          entityType: "Credential",
          entityId: email,
          createdAt: { gte: since },
        },
      });

      if (failures >= LOGIN_FAILURE_LIMIT) {
        await transaction.auditLog.create({
          data: {
            actorType: AuditActorType.SYSTEM,
            action: "auth.login.rate_limited",
            entityType: "Credential",
            entityId: email,
            ...auditMetadata,
          },
        });
        return { kind: "rate_limited" as const };
      }

      const account = await transaction.account.findUnique({
        where: {
          providerId_accountId: { providerId: "credential", accountId: email },
        },
        include: { user: true },
      });
      const passwordMatches = account?.password
        ? await verifyPassword(result.data.password, account.password)
        : false;

      if (!account || !passwordMatches) {
        if (!account) {
          await hashPassword(result.data.password);
        }

        await transaction.auditLog.create({
          data: {
            ...(account ? { actor: { connect: { id: account.userId } } } : {}),
            actorType: account ? AuditActorType.USER : AuditActorType.SYSTEM,
            action: "auth.login.failed",
            entityType: "Credential",
            entityId: email,
            ...auditMetadata,
          },
        });
        return { kind: "invalid_credentials" as const };
      }

      if (account.user.status === UserStatus.BLOCKED) {
        return { kind: "blocked" as const };
      }

      if (
        account.user.status !== UserStatus.ACTIVE ||
        !account.user.emailVerified
      ) {
        return { kind: "email_not_verified" as const };
      }

      await transaction.session.deleteMany({
        where: { userId: account.userId, expiresAt: { lte: now } },
      });
      await transaction.session.create({
        data: {
          userId: account.userId,
          tokenHash,
          expiresAt,
          ...auditMetadata,
        },
      });
      await transaction.auditLog.create({
        data: {
          actor: { connect: { id: account.userId } },
          actorType: AuditActorType.USER,
          action: "auth.login.succeeded",
          entityType: "Session",
          entityId: tokenHash,
          ...auditMetadata,
        },
      });

      return {
        kind: "authenticated" as const,
        user: {
          id: account.user.id,
          name: account.user.name,
          email: account.user.email,
          emailVerified: account.user.emailVerified,
          status: account.user.status,
          role: account.user.role,
        },
      };
    });

    if (outcome.kind === "rate_limited") {
      throw new HttpException({
        code: "LOGIN_RATE_LIMITED",
        message: "Too many login attempts. Try again later",
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    if (outcome.kind === "invalid_credentials") {
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
      });
    }

    if (outcome.kind === "blocked") {
      throw new ForbiddenException({
        code: "ACCOUNT_BLOCKED",
        message: "This account is unavailable",
      });
    }

    if (outcome.kind === "email_not_verified") {
      throw new ForbiddenException({
        code: "EMAIL_NOT_VERIFIED",
        message: "Email verification is required before login",
      });
    }

    return { token, user: outcome.user };
  }

  async currentSession(token: string | undefined): Promise<AuthenticatedUser> {
    if (!token) {
      throw new UnauthorizedException({
        code: "SESSION_REQUIRED",
        message: "An active session is required",
      });
    }

    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });

    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.user.status !== UserStatus.ACTIVE ||
      !session.user.emailVerified
    ) {
      throw new UnauthorizedException({
        code: "SESSION_INVALID",
        message: "The session is invalid or expired",
      });
    }

    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      status: session.user.status,
      role: session.user.role,
    };
  }

  async logout(token: string | undefined, metadata: AccessMetadata): Promise<void> {
    if (!token) {
      return;
    }

    const tokenHash = hashSessionToken(token);
    const auditMetadata = accessMetadata(metadata);

    await this.prisma.client.$transaction(async (transaction) => {
      const session = await transaction.session.findUnique({
        where: { tokenHash },
        select: { userId: true },
      });

      if (!session) {
        return;
      }

      await transaction.session.delete({ where: { tokenHash } });
      await transaction.auditLog.create({
        data: {
          actor: { connect: { id: session.userId } },
          actorType: AuditActorType.USER,
          action: "auth.logout",
          entityType: "Session",
          entityId: tokenHash,
          ...auditMetadata,
        },
      });
    });
  }
}
