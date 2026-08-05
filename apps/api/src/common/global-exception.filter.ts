import { logger } from "@mensaly/logger";
import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { getCorrelationId, safeRequestPath } from "./correlation";
import { reportUnhandledException } from "./observability";
import { currentAuthContext } from "../authorization/authorization-context";

type ErrorPayload = {
  code?: unknown;
  details?: unknown;
  message?: unknown;
};

function defaultCode(status: number): string {
  const statusName = HttpStatus[status];
  return typeof statusName === "string" ? statusName : "HTTP_ERROR";
}

function exceptionPayload(exception: HttpException): ErrorPayload {
  const response = exception.getResponse();
  return typeof response === "string" ? { message: response } : response;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const correlationId = getCorrelationId(request);
    const path = safeRequestPath(request.url);
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttpException ? exceptionPayload(exception) : {};
    const message =
      status === HttpStatus.INTERNAL_SERVER_ERROR
        ? "Internal server error"
        : typeof payload.message === "string"
          ? payload.message
          : "Request failed";
    const code =
      typeof payload.code === "string" ? payload.code : defaultCode(status);
    const details = Array.isArray(payload.details)
      ? payload.details
      : undefined;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      logger.error(
        { correlationId, err: exception, method: request.method, path },
        "request failed",
      );
      reportUnhandledException(exception, {
        correlationId,
        method: request.method,
        path,
        organizationId: currentAuthContext(request)?.organizationId,
      });
    }

    void reply.status(status).send({
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
      correlationId,
      timestamp: new Date().toISOString(),
      path,
    });
  }
}
