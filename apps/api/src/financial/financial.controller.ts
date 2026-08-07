import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
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
  type CreateBillingRuleInput,
  createBillingRuleSchema,
  CreateManualChargeDto,
  type CreateManualChargeInput,
  createManualChargeSchema,
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
    amountCents: {
      type: "integer",
      minimum: 1,
      maximum: 2_000_000_000,
      example: 15000,
    },
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

const manualChargeBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["studentId"] as string[],
  properties: {
    studentId: { type: "string", format: "uuid" },
    referenceMonth: { type: "string", pattern: "^(?:20\\d{2}|[3-9]\\d{3})-(0[1-9]|1[0-2])$" },
  },
} as const;

const billingRuleBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "sourceType", "sourceId", "frequency", "opensOn", "expiresOn", "studentIds"] as string[],
  properties: {
    name: { type: "string", minLength: 2, maxLength: 120 },
    sourceType: { type: "string", enum: ["PLAN", "PRODUCT", "EVENT"] as string[] },
    sourceId: { type: "string", format: "uuid" },
    frequency: { type: "string", enum: ["MONTHLY", "ONCE"] as string[] },
    opensOn: { type: "string", format: "date" },
    expiresOn: { type: "string", format: "date" },
    repeatUntil: { type: "string", format: "date", nullable: true },
    studentIds: { type: "array", minItems: 1, maxItems: 2000, items: { type: "string", format: "uuid" } },
  },
} as const;

@ApiTags("Financial")
@ApiCookieAuth("sessionCookie")
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
          pattern: "^(?:20\\d{2}|[3-9]\\d{3})-(0[1-9]|1[0-2])$",
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

  @Post("charges/manual")
  @ApiOperation({ summary: "Creates the current monthly charge for one active student" })
  @ApiBody({ schema: manualChargeBodySchema })
  @ApiCreatedResponse({ description: "Charge created or the existing monthly charge reused" })
  @ApiNotFoundResponse({ description: "Student has no active enrollment in this organization" })
  async createManualCharge(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createManualChargeSchema))
    input: CreateManualChargeDto,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.financial.createManualCharge(
        auth,
        input as unknown as CreateManualChargeInput,
        requestMetadata(request),
      ),
    };
  }

  @Get("billing-rules")
  @ApiOperation({ summary: "Lists billing rules and their selected students" })
  async billingRules(@CurrentAuth() auth: AuthenticatedContext): Promise<{ data: unknown }> {
    return { data: await this.financial.billingRules(auth) };
  }

  @Post("billing-rules")
  @ApiOperation({ summary: "Creates a monthly or one-time billing rule" })
  @ApiHeader({ name: "Idempotency-Key", required: true, description: "Unique key for safely retrying this billing rule creation" })
  @ApiBody({ schema: billingRuleBodySchema })
  @ApiCreatedResponse({ description: "Billing rule created and eligible charges materialized" })
  async createBillingRule(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createBillingRuleSchema)) input: CreateBillingRuleInput,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return { data: await this.financial.createBillingRule(auth, input, idempotencyKey(rawIdempotencyKey), requestMetadata(request)) };
  }

  @Post("billing-rules/process")
  @ApiOperation({ summary: "Materializes every billing rule eligible today" })
  async processBillingRules(
    @CurrentAuth() auth: AuthenticatedContext,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return { data: await this.financial.processBillingRules(auth, requestMetadata(request)) };
  }

  @Post("billing-rules/:id/deactivate")
  @ApiOperation({ summary: "Stops future charges from one billing rule" })
  async deactivateBillingRule(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return { data: await this.financial.deactivateBillingRule(auth, id, requestMetadata(request)) };
  }

  @Delete("billing-rules/:id")
  @ApiOperation({ summary: "Deletes a billing rule and cancels its pending charges" })
  @ApiOkResponse({ description: "Billing rule deleted; pending charges were cancelled and paid history was preserved" })
  @ApiConflictResponse({ description: "A payment is still being processed for this billing rule" })
  async deleteBillingRule(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return { data: await this.financial.deleteBillingRule(auth, id, requestMetadata(request)) };
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
    @Param("id", ParseUUIDPipe) id: string,
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
    @Param("id", ParseUUIDPipe) id: string,
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
    @Param("id", ParseUUIDPipe) id: string,
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
    @Param("id", ParseUUIDPipe) id: string,
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
    @Param("id", ParseUUIDPipe) id: string,
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
    @Param("id", ParseUUIDPipe) id: string,
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
    @Param("id", ParseUUIDPipe) id: string,
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
    @Param("id", ParseUUIDPipe) id: string,
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
