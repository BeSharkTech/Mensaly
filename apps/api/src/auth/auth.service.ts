import {
  createSessionToken,
  createVerificationToken,
  hashPassword,
  hashSessionToken,
  hashVerificationToken,
  normalizeEmail,
  verifyPassword,
} from "@mensaly/auth";
import {
  AuditActorType,
  Prisma,
  UserRole,
  UserStatus,
  VerificationType,
} from "@mensaly/database";
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
import { logger } from "@mensaly/logger";

import { PrismaService } from "../infrastructure/database/prisma.service";
import { loginSchema } from "./login.dto";
import { EmailDeliveryService } from "./email-delivery.service";
import { registerSchema } from "./register.dto";
import {
  emailRequestSchema,
  passwordResetSchema,
  tokenSchema,
} from "./verification.dto";

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const VERIFICATION_COOLDOWN_MS = 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

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
  devVerificationToken?: string;
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
    message: "Confira os dados informados.",
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
    @Inject(EmailDeliveryService)
    private readonly emailDelivery: EmailDeliveryService,
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
      const user = await this.prisma.client.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            name: input.name,
            email,
            role: UserRole.COMPANY_ACCOUNT,
            emailVerified: false,
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

      const verificationToken = await this.requestEmailVerificationFor(
        email,
        user.id,
      );
      return {
        ...user,
        ...(process.env.NODE_ENV !== "production" &&
        (process.env.EMAIL_DELIVERY_MODE ?? "local") === "local" &&
        verificationToken
          ? { devVerificationToken: verificationToken }
          : {}),
      };
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

  private async issueVerification(
    email: string,
    type: VerificationType,
    expiresInMs: number,
  ): Promise<string | undefined> {
    const token = createVerificationToken();
    const tokenHash = hashVerificationToken(token);
    const now = new Date();

    const created = await this.prisma.client.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`${type}:${email}`}))
      `;
      const latest = await transaction.verification.findFirst({
        where: { identifier: email, type },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      if (latest && now.getTime() - latest.createdAt.getTime() < VERIFICATION_COOLDOWN_MS) {
        return false;
      }

      await transaction.verification.deleteMany({
        where: { identifier: email, type },
      });
      await transaction.verification.create({
        data: {
          identifier: email,
          tokenHash,
          type,
          expiresAt: new Date(now.getTime() + expiresInMs),
        },
      });
      return true;
    });

    return created ? token : undefined;
  }

  private async requestEmailVerificationFor(
    email: string,
    userId?: string,
  ): Promise<string | undefined> {
    const token = await this.issueVerification(
      email,
      VerificationType.EMAIL_VERIFICATION,
      EMAIL_VERIFICATION_TTL_MS,
    );

    if (!token) {
      return undefined;
    }

    let queued = false;
    try {
      await this.emailDelivery.deliverVerification({
        email,
        type: VerificationType.EMAIL_VERIFICATION,
        token,
        createdAt: new Date(),
        ...(userId ? { userId } : {}),
      });
      queued = true;
    } catch (error) {
      logger.error({ error, email, type: VerificationType.EMAIL_VERIFICATION }, "Transactional verification email could not be delivered");
    }

    if (userId) {
      await this.prisma.client.auditLog.create({
        data: {
          actor: { connect: { id: userId } },
          actorType: AuditActorType.USER,
          action: queued
            ? "auth.email_verification.queued"
            : "auth.email_verification.queue_failed",
          entityType: "Verification",
          entityId: hashVerificationToken(token),
        },
      });
    }

    return token;
  }

  async requestEmailVerification(rawInput: unknown): Promise<void> {
    const result = emailRequestSchema.safeParse(rawInput);
    if (!result.success) {
      throw validationError(result.error.issues);
    }

    const email = normalizeEmail(result.data.email);
    const user = await this.prisma.client.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true },
    });

    if (user && !user.emailVerified) {
      await this.requestEmailVerificationFor(email, user.id);
    }
  }

  async verifyEmail(rawInput: unknown): Promise<void> {
    const result = tokenSchema.safeParse(rawInput);
    if (!result.success) {
      throw validationError(result.error.issues);
    }

    const tokenHash = hashVerificationToken(result.data.token);
    const now = new Date();
    const verified = await this.prisma.client.$transaction(async (transaction) => {
      const verification = await transaction.verification.findUnique({
        where: { tokenHash },
      });
      if (
        !verification ||
        verification.type !== VerificationType.EMAIL_VERIFICATION ||
        verification.expiresAt <= now
      ) {
        return false;
      }

      const consumed = await transaction.verification.deleteMany({
        where: {
          id: verification.id,
          tokenHash,
          expiresAt: { gt: now },
        },
      });
      if (consumed.count !== 1) {
        return false;
      }

      const user = await transaction.user.update({
        where: { email: verification.identifier },
        data: { emailVerified: true, status: UserStatus.ACTIVE },
        select: { id: true, email: true, name: true },
      });
      await transaction.verification.deleteMany({
        where: {
          identifier: verification.identifier,
          type: VerificationType.EMAIL_VERIFICATION,
        },
      });
      await transaction.auditLog.create({
        data: {
          actor: { connect: { id: user.id } },
          actorType: AuditActorType.USER,
          action: "auth.email_verified",
          entityType: "User",
          entityId: user.id,
        },
      });
      return user;
    });

    if (!verified) {
      throw new BadRequestException({
        code: "VERIFICATION_TOKEN_INVALID",
        message: "The verification token is invalid, expired, or already used",
      });
    }

    try {
      await this.emailDelivery.deliverWelcome({
        userId: verified.id,
        email: verified.email,
        name: verified.name,
      });
    } catch (error) {
      logger.error(
        { error, email: verified.email, type: "WELCOME" },
        "Transactional welcome email could not be queued",
      );
    }
  }

  async requestPasswordReset(rawInput: unknown): Promise<void> {
    const result = emailRequestSchema.safeParse(rawInput);
    if (!result.success) {
      throw validationError(result.error.issues);
    }

    const email = normalizeEmail(result.data.email);
    const user = await this.prisma.client.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true, status: true },
    });
    if (!user || !user.emailVerified || user.status !== UserStatus.ACTIVE) {
      return;
    }

    const token = await this.issueVerification(
      email,
      VerificationType.PASSWORD_RESET,
      PASSWORD_RESET_TTL_MS,
    );
    if (!token) {
      return;
    }

    let queued = false;
    try {
      await this.emailDelivery.deliverVerification({
        email,
        type: VerificationType.PASSWORD_RESET,
        token,
        createdAt: new Date(),
        userId: user.id,
      });
      queued = true;
    } catch (error) {
      logger.error({ error, email, type: VerificationType.PASSWORD_RESET }, "Transactional password reset email could not be delivered");
    }
    await this.prisma.client.auditLog.create({
      data: {
        actor: { connect: { id: user.id } },
        actorType: AuditActorType.USER,
        action: queued
          ? "auth.password_reset.queued"
          : "auth.password_reset.queue_failed",
        entityType: "Verification",
        entityId: hashVerificationToken(token),
      },
    });
  }

  async resetPassword(rawInput: unknown): Promise<void> {
    const result = passwordResetSchema.safeParse(rawInput);
    if (!result.success) {
      throw validationError(result.error.issues);
    }

    const tokenHash = hashVerificationToken(result.data.token);
    const passwordHash = await hashPassword(result.data.password);
    const now = new Date();
    const reset = await this.prisma.client.$transaction(async (transaction) => {
      const verification = await transaction.verification.findUnique({
        where: { tokenHash },
      });
      if (
        !verification ||
        verification.type !== VerificationType.PASSWORD_RESET ||
        verification.expiresAt <= now
      ) {
        return false;
      }

      const consumed = await transaction.verification.deleteMany({
        where: { id: verification.id, tokenHash, expiresAt: { gt: now } },
      });
      if (consumed.count !== 1) {
        return false;
      }

      const account = await transaction.account.findUnique({
        where: {
          providerId_accountId: {
            providerId: "credential",
            accountId: verification.identifier,
          },
        },
        select: { id: true, userId: true },
      });
      if (!account) {
        return false;
      }

      await transaction.account.update({
        where: { id: account.id },
        data: { password: passwordHash },
      });
      await transaction.session.deleteMany({ where: { userId: account.userId } });
      await transaction.verification.deleteMany({
        where: {
          identifier: verification.identifier,
          type: VerificationType.PASSWORD_RESET,
        },
      });
      await transaction.auditLog.create({
        data: {
          actor: { connect: { id: account.userId } },
          actorType: AuditActorType.USER,
          action: "auth.password_reset.completed",
          entityType: "User",
          entityId: account.userId,
        },
      });
      return true;
    });

    if (!reset) {
      throw new BadRequestException({
        code: "PASSWORD_RESET_TOKEN_INVALID",
        message: "The reset token is invalid, expired, or already used",
      });
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
    const credential = await this.prisma.client.account.findUnique({
      where: {
        providerId_accountId: { providerId: "credential", accountId: email },
      },
      select: { password: true },
    });
    const passwordMatches = credential?.password
      ? await verifyPassword(result.data.password, credential.password)
      : false;
    if (!credential) {
      await hashPassword(result.data.password);
    }

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

      // Anonymous failures must not let an attacker lock the real owner out.
      // A valid credential may pass; invalid attempts remain rate-limited.
      if (failures >= LOGIN_FAILURE_LIMIT && !passwordMatches) {
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
      const credentialUnchanged =
        account?.password === credential?.password;

      if (!account || !passwordMatches || !credentialUnchanged) {
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

    const tokenHash = hashSessionToken(token);
    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.user.status !== UserStatus.ACTIVE ||
      !session.user.emailVerified
    ) {
      if (session) {
        await this.prisma.client.session.deleteMany({
          where: { tokenHash },
        });
      }
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
