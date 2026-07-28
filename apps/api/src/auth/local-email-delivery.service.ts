import { Injectable } from "@nestjs/common";
import { VerificationType } from "@mensaly/database";

export type LocalVerificationMessage = {
  email: string;
  type: VerificationType;
  token: string;
  createdAt: Date;
};

@Injectable()
export class LocalEmailDeliveryService {
  private readonly outbox: LocalVerificationMessage[] = [];

  deliver(message: LocalVerificationMessage): void {
    this.outbox.push(message);
  }

  latest(email: string, type: VerificationType): LocalVerificationMessage | undefined {
    return [...this.outbox]
      .reverse()
      .find((message) => message.email === email && message.type === type);
  }
}
