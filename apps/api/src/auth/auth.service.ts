import { hashPassword, normalizeEmail } from "@mensaly/auth";
import { AuditActorType, Prisma, UserRole, UserStatus } from "@mensaly/database";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";

import { PrismaService } from "../infrastructure/database/prisma.service";
import { registerSchema } from "./register.dto";

type RegisteredUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  status: UserStatus;
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async register(rawInput: unknown): Promise<RegisteredUser> {
    const result = registerSchema.safeParse(rawInput);

    if (!result.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid request data",
        details: result.error.issues.map((issue) => ({
          field: issue.path.join(".") || undefined,
          message: issue.message,
        })),
      });
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
            actorUserId: user.id,
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
}
