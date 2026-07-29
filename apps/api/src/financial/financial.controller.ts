import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import {
  CurrentAuth,
  type AuthenticatedContext,
} from "../authorization/authorization-context";
import {
  CompanyAccountGuard,
  SessionAuthGuard,
} from "../authorization/authorization.guards";
import { getCorrelationId } from "../common/correlation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  chargeListQuerySchema,
  CreateManualPaymentDto,
  type ChargeListQuery,
  type CreateManualPaymentInput,
  GenerateChargesDto,
  type GenerateChargesInput,
  generateChargesSchema,
  idempotencyKeySchema,
  createManualPaymentSchema,
} from "./financial.dto";
import {
  type FinancialAuditMetadata,
  FinancialService,
} from "./financial.service";

function requestMetadata(request: FastifyRequest): FinancialAuditMetadata {
  const userAgent = request.headers["user-agent"];
  return {
    correlationId: getCorrelationId(request),
    ipAddress: request.ip,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
  };
}

function idempotencyKey(value: string | undefined): string {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "A valid Idempotency-Key header is required",
      details: parsed.error.issues.map((issue) => ({
        field: "Idempotency-Key",
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

const paymentBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["amountCents", "method", "paidAt"] as string[],
  properties: {
    amountCents: { type: "integer", minimum: 1, example: 15000 },
    method: {
      type: "string",
      enum: ["CASH", "PIX", "BANK_TRANSFER", "CARD", "OTHER"] as string[],
    },
    paidAt: {
      type: "string",
      format: "date-time",
      example: "2026-02-10T12:00:00.000Z",
    },
    externalReference: { type: "string", maxLength: 255 },
    notes: { type: "string", maxLength: 1000 },
  },
} as const;

@ApiTags("Financial")
@Controller({ path: "", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class FinancialController {
  constructor(
    @Inject(FinancialService)
    private readonly financial: FinancialService,
  ) {}

  @Post("charges/generate")
  @ApiOperation({ summary: "Generates idempotent monthly charges" })
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["referenceMonth"],
      properties: {
        referenceMonth: {
          type: "string",
          pattern: "^\\d{4}-(0[1-9]|1[0-2])$",
          example: "2026-02",
        },
      },
    },
  })
  @ApiCreatedResponse({ description: "Monthly charges generated or reused" })
  @ApiBadRequestResponse({ description: "Invalid reference month" })
  @ApiUnauthorizedResponse({ description: "A valid company session is required" })
  async generateCharges(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(generateChargesSchema))
    input: GenerateChargesDto,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.financial.generateCharges(
        auth,
        input as unknown as GenerateChargesInput,
        requestMetadata(request),
      ),
    };
  }

  @Get("charges")
  @ApiOperation({ summary: "Lists charges in the authenticated organization" })
  @ApiQuery({ name: "page", required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: "pageSize",
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["PENDING", "PAID", "CANCELLED", "WAIVED"],
  })
  @ApiQuery({ name: "referenceMonth", required: false, type: String })
  @ApiOkResponse({ description: "Paginated organization charges" })
  async charges(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(chargeListQuerySchema))
    query: ChargeListQuery,
  ): Promise<{ data: unknown[]; meta: Record<string, number> }> {
    const result = await this.financial.charges(
      auth,
      query,
    );
    return {
      data: result.items,
      meta: {
        page: result.page,
        limit: result.pageSize,
        total: result.total,
        pages: Math.ceil(result.total / result.pageSize),
      },
    };
  }

  @Get("charges/:id")
  @ApiOperation({ summary: "Gets one organization-scoped charge" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ description: "Charge with enrollment and payment history" })
  @ApiNotFoundResponse({ description: "Charge not found in this organization" })
  async charge(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id") id: string,
  ): Promise<{ data: unknown }> {
    return { data: await this.financial.charge(auth, id) };
  }

  @Post("charges/:id/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancels a pending charge" })
  @ApiOkResponse({ description: "Charge cancelled" })
  @ApiConflictResponse({ description: "Charge state or payment conflict" })
  async cancel(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id") id: string,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.financial.changeChargeStatus(
        auth,
        id,
        "CANCELLED",
        requestMetadata(request),
      ),
    };
  }

  @Post("charges/:id/waive")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Waives a pending charge" })
  @ApiOkResponse({ description: "Charge waived" })
  @ApiConflictResponse({ description: "Charge state or payment conflict" })
  async waive(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id") id: string,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.financial.changeChargeStatus(
        auth,
        id,
        "WAIVED",
        requestMetadata(request),
      ),
    };
  }

  @Post("charges/:id/reopen")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reopens a cancelled or waived charge" })
  @ApiOkResponse({ description: "Charge reopened" })
  @ApiConflictResponse({ description: "Charge state conflict" })
  async reopen(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id") id: string,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.financial.changeChargeStatus(
        auth,
        id,
        "PENDING",
        requestMetadata(request),
      ),
    };
  }

  @Post("charges/:id/payments")
  @ApiOperation({ summary: "Creates one idempotent manual payment" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Unique payment operation key within the organization",
    schema: { type: "string", minLength: 8, maxLength: 128 },
  })
  @ApiBody({ schema: paymentBodySchema })
  @ApiCreatedResponse({
    description: "Payment created or replayed from the idempotency key",
  })
  @ApiBadRequestResponse({
    description: "Invalid header, payload, or payment amount",
  })
  @ApiConflictResponse({
    description: "Active payment, charge state, or idempotency conflict",
  })
  @ApiNotFoundResponse({ description: "Charge not found in this organization" })
  async createPayment(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id") id: string,
    @Headers("idempotency-key") header: string | undefined,
    @Body(new ZodValidationPipe(createManualPaymentSchema))
    input: CreateManualPaymentDto,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown; meta: { idempotentReplay: boolean } }> {
    const result = await this.financial.createManualPayment(
      auth,
      id,
      idempotencyKey(header),
      input as unknown as CreateManualPaymentInput,
      requestMetadata(request),
    );
    return {
      data: result.payment,
      meta: { idempotentReplay: result.replayed },
    };
  }

  @Post("payments/:id/confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Confirms a reconciled payment" })
  @ApiOkResponse({ description: "Payment confirmed and charge paid" })
  @ApiConflictResponse({ description: "Payment state conflict" })
  async confirmPayment(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id") id: string,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.financial.changePaymentStatus(
        auth,
        id,
        "CONFIRMED",
        requestMetadata(request),
      ),
    };
  }

  @Post("payments/:id/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancels a payment pending reconciliation" })
  @ApiOkResponse({ description: "Payment cancelled" })
  @ApiConflictResponse({ description: "Payment state conflict" })
  async cancelPayment(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id") id: string,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.financial.changePaymentStatus(
        auth,
        id,
        "CANCELLED",
        requestMetadata(request),
      ),
    };
  }

  @Post("payments/:id/reverse")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reverses a confirmed payment" })
  @ApiOkResponse({ description: "Payment reversed and charge reopened" })
  @ApiConflictResponse({ description: "Payment state conflict" })
  async reversePayment(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id") id: string,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.financial.changePaymentStatus(
        auth,
        id,
        "REVERSED",
        requestMetadata(request),
      ),
    };
  }
}
