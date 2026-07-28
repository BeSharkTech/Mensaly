import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

export type AuthenticatedContext = {
  userId: string;
  email: string;
  role: "PLATFORM_ADMIN" | "COMPANY_ACCOUNT";
  organizationId?: string;
};

type ContextRequest = FastifyRequest & {
  authContext?: AuthenticatedContext;
};

export function contextRequest(request: FastifyRequest): ContextRequest {
  return request as ContextRequest;
}

export function currentAuthContext(request: FastifyRequest): AuthenticatedContext | undefined {
  return contextRequest(request).authContext;
}

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedContext => {
    const value = currentAuthContext(context.switchToHttp().getRequest<FastifyRequest>());
    if (!value) {
      throw new Error("Authentication context is unavailable");
    }
    return value;
  },
);
