import { logger } from "@mensaly/logger";
import type { LoggerService } from "@nestjs/common";

function text(message: unknown): string {
  if (message instanceof Error) {
    return message.stack ?? message.message;
  }

  return typeof message === "string" ? message : JSON.stringify(message);
}

export class StructuredNestLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    logger.info({ context }, text(message));
  }

  error(message: unknown, trace?: string, context?: string): void {
    logger.error({ context, trace }, text(message));
  }

  warn(message: unknown, context?: string): void {
    logger.warn({ context }, text(message));
  }

  debug(message: unknown, context?: string): void {
    logger.debug({ context }, text(message));
  }

  verbose(message: unknown, context?: string): void {
    logger.trace({ context }, text(message));
  }
}
