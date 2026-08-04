import { createHash } from "node:crypto";

import { encryptPayload } from "@mensaly/auth";
import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";
import {
  TransactionalEmailKind,
  VerificationType,
} from "@mensaly/database";
import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../infrastructure/database/prisma.service";
import {
  LocalEmailDeliveryService,
  type LocalVerificationMessage,
} from "./local-email-delivery.service";

export type VerificationEmail = LocalVerificationMessage & {
  userId?: string;
};

@Injectable()
export class EmailDeliveryService {
  private readonly environment = parseEnvironment(
    apiEnvironmentSchema,
    process.env,
  );

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LocalEmailDeliveryService)
    private readonly local: LocalEmailDeliveryService,
  ) {}

  async deliverVerification(message: VerificationEmail): Promise<void> {
    if (this.environment.EMAIL_DELIVERY_MODE === "local") {
      this.local.deliver(message);
      return;
    }

    const encryptionKey = this.environment.EMAIL_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error("EMAIL_ENCRYPTION_KEY is required");
    }
    const tokenHash = createHash("sha256").update(message.token).digest("hex");
    const kind =
      message.type === VerificationType.PASSWORD_RESET
        ? TransactionalEmailKind.PASSWORD_RESET
        : TransactionalEmailKind.EMAIL_VERIFICATION;

    await this.prisma.client.transactionalEmail.upsert({
      where: {
        idempotencyKey: `auth-${kind.toLowerCase()}-${tokenHash}`,
      },
      create: {
        ...(message.userId ? { userId: message.userId } : {}),
        recipient: message.email,
        kind,
        encryptedPayload: encryptPayload(
          { token: message.token },
          encryptionKey,
        ),
        idempotencyKey: `auth-${kind.toLowerCase()}-${tokenHash}`,
      },
      update: {},
    });
  }

  async deliverWelcome(input: {
    userId: string;
    email: string;
    name: string;
  }): Promise<void> {
    if (this.environment.EMAIL_DELIVERY_MODE === "local") return;
    const encryptionKey = this.environment.EMAIL_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error("EMAIL_ENCRYPTION_KEY is required");
    }
    await this.prisma.client.transactionalEmail.upsert({
      where: { idempotencyKey: `welcome-${input.userId}` },
      create: {
        userId: input.userId,
        recipient: input.email,
        kind: TransactionalEmailKind.WELCOME,
        encryptedPayload: encryptPayload({ name: input.name }, encryptionKey),
        idempotencyKey: `welcome-${input.userId}`,
      },
      update: {},
    });
  }
}
