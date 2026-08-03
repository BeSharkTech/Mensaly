import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
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
  CreateEnrollmentDto,
  CreateGuardianDto,
  CreatePlanDto,
  CreateStudentDto,
  type CreateEnrollmentInput,
  type CreateGuardianInput,
  type CreatePlanInput,
  type CreateStudentInput,
  type EnrollmentListInput,
  type LinkGuardianInput,
  type OperationalListInput,
  UpdateEnrollmentDto,
  UpdateGuardianDto,
  UpdatePlanDto,
  UpdateStudentDto,
  type UpdateEnrollmentInput,
  type UpdateGuardianInput,
  type UpdatePlanInput,
  type UpdateStudentInput,
  createEnrollmentSchema,
  createGuardianSchema,
  createPlanSchema,
  createStudentSchema,
  linkGuardianSchema,
  enrollmentListSchema,
  operationalListSchema,
  updateEnrollmentSchema,
  updateGuardianSchema,
  updatePlanSchema,
  updateStudentSchema,
} from "./operational.dto";
import {
  type OperationalAuditMetadata,
  OperationalService,
} from "./operational.service";

function requestMetadata(request: FastifyRequest): OperationalAuditMetadata {
  const userAgent = request.headers["user-agent"];
  return {
    correlationId: getCorrelationId(request),
    ipAddress: request.ip,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
  };
}

const statusSchema = { type: "string", enum: ["ACTIVE", "INACTIVE"] };
const planBodySchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 2, maxLength: 120 },
    description: { type: "string", maxLength: 1000 },
    amountCents: { type: "integer", minimum: 1, maximum: 2_000_000_000 },
    chargeOpenDay: { type: "integer", minimum: 1, maximum: 31, default: 1 },
    chargeOpenTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", default: "00:00" },
    dueDay: { type: "integer", minimum: 1, maximum: 31 },
    frequency: { type: "string", enum: ["MONTHLY"], default: "MONTHLY" },
  },
};
const studentBodySchema = {
  type: "object",
  required: ["name", "cpf"],
  properties: {
    name: { type: "string", minLength: 2, maxLength: 120 },
    cpf: { type: "string", minLength: 11, maxLength: 14, description: "Brazilian CPF" },
    birthDate: { type: "string", format: "date" },
    email: { type: "string", format: "email", maxLength: 255 },
    phone: { type: "string", maxLength: 32 },
    notes: { type: "string", maxLength: 2000 },
  },
};
const guardianBodySchema = {
  type: "object",
  required: ["name", "phone", "taxId"],
  properties: {
    name: { type: "string", minLength: 2, maxLength: 120 },
    phone: { type: "string", minLength: 8, maxLength: 32 },
    email: { type: "string", format: "email", maxLength: 255 },
    taxId: { type: "string", minLength: 11, maxLength: 14, description: "Brazilian CPF" },
  },
};
const enrollmentBodySchema = {
  type: "object",
  properties: {
    studentId: { type: "string", format: "uuid" },
    guardianId: { type: "string", format: "uuid" },
    planId: { type: "string", format: "uuid" },
    amountCents: { type: "integer", minimum: 1, maximum: 2_000_000_000 },
    chargeOpenDay: { type: "integer", minimum: 1, maximum: 31 },
    chargeOpenTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    dueDay: { type: "integer", minimum: 1, maximum: 31 },
    discountCents: {
      type: "integer",
      minimum: 0,
      maximum: 2_000_000_000,
      default: 0,
    },
    startDate: { type: "string", format: "date" },
    endDate: { type: "string", format: "date" },
  },
};

@ApiTags("Operational CRUD")
@ApiCookieAuth("sessionCookie")
@Controller({ path: "", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class OperationalController {
  constructor(
    @Inject(OperationalService) private readonly service: OperationalService,
  ) {}

  @Get("plans")
  @ApiOperation({ summary: "Lists organization plans" })
  plans(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(operationalListSchema))
    query: OperationalListInput,
  ) {
    return this.service.plans(auth, query);
  }

  @Post("plans")
  @ApiOperation({ summary: "Creates an organization plan" })
  @ApiBody({
    schema: {
      ...planBodySchema,
      required: ["name", "amountCents", "dueDay"],
    },
  })
  createPlan(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createPlanSchema)) input: CreatePlanDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.createPlan(
      auth,
      input as unknown as CreatePlanInput,
      requestMetadata(request),
    );
  }

  @Get("plans/:id")
  @ApiOperation({ summary: "Gets an organization plan" })
  plan(@CurrentAuth() auth: AuthenticatedContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.plan(auth, id);
  }

  @Patch("plans/:id")
  @ApiOperation({ summary: "Updates an organization plan" })
  @ApiBody({ schema: { ...planBodySchema, minProperties: 1 } })
  updatePlan(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePlanSchema)) input: UpdatePlanDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.updatePlan(
      auth,
      id,
      input as unknown as UpdatePlanInput,
      requestMetadata(request),
    );
  }

  @Get("students")
  @ApiOperation({ summary: "Lists organization students" })
  students(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(operationalListSchema))
    query: OperationalListInput,
  ) {
    return this.service.students(auth, query);
  }

  @Post("students")
  @ApiOperation({ summary: "Creates an organization student" })
  @ApiBody({
    schema: { ...studentBodySchema, required: ["name"] },
  })
  createStudent(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createStudentSchema)) input: CreateStudentDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.createStudent(
      auth,
      input as unknown as CreateStudentInput,
      requestMetadata(request),
    );
  }

  @Get("students/:id")
  @ApiOperation({ summary: "Gets an organization student" })
  student(@CurrentAuth() auth: AuthenticatedContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.student(auth, id);
  }

  @Patch("students/:id")
  @ApiOperation({ summary: "Updates an organization student" })
  @ApiBody({
    schema: {
      ...studentBodySchema,
      minProperties: 1,
      properties: { ...studentBodySchema.properties, status: statusSchema },
    },
  })
  updateStudent(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateStudentSchema)) input: UpdateStudentDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.updateStudent(
      auth,
      id,
      input as unknown as UpdateStudentInput,
      requestMetadata(request),
    );
  }

  @Post("students/:studentId/guardians/:guardianId")
  @ApiOperation({ summary: "Links a guardian to a student" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["relationship"],
      properties: {
        relationship: { type: "string", minLength: 2, maxLength: 80 },
      },
    },
  })
  link(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Param("guardianId", ParseUUIDPipe) guardianId: string,
    @Body(new ZodValidationPipe(linkGuardianSchema)) input: LinkGuardianInput,
    @Req() request: FastifyRequest,
  ) {
    return this.service.linkGuardian(
      auth,
      studentId,
      guardianId,
      input.relationship,
      requestMetadata(request),
    );
  }

  @Get("guardians")
  @ApiOperation({ summary: "Lists organization guardians" })
  guardians(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(operationalListSchema))
    query: OperationalListInput,
  ) {
    return this.service.guardians(auth, query);
  }

  @Post("guardians")
  @ApiOperation({ summary: "Creates an organization guardian" })
  @ApiBody({
    schema: { ...guardianBodySchema, required: ["name", "phone"] },
  })
  createGuardian(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createGuardianSchema)) input: CreateGuardianDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.createGuardian(
      auth,
      input as unknown as CreateGuardianInput,
      requestMetadata(request),
    );
  }

  @Get("guardians/:id")
  @ApiOperation({ summary: "Gets an organization guardian" })
  guardian(@CurrentAuth() auth: AuthenticatedContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.guardian(auth, id);
  }

  @Patch("guardians/:id")
  @ApiOperation({ summary: "Updates an organization guardian" })
  @ApiBody({
    schema: {
      ...guardianBodySchema,
      minProperties: 1,
      properties: { ...guardianBodySchema.properties, status: statusSchema },
    },
  })
  updateGuardian(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateGuardianSchema))
    input: UpdateGuardianDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.updateGuardian(
      auth,
      id,
      input as unknown as UpdateGuardianInput,
      requestMetadata(request),
    );
  }

  @Get("enrollments")
  @ApiOperation({ summary: "Lists organization enrollments" })
  enrollments(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(enrollmentListSchema))
    query: EnrollmentListInput,
  ) {
    return this.service.enrollments(auth, query);
  }

  @Post("enrollments")
  @ApiOperation({ summary: "Creates an organization enrollment" })
  @ApiBody({
    schema: {
      ...enrollmentBodySchema,
      required: ["studentId", "guardianId", "planId", "startDate"],
    },
  })
  createEnrollment(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createEnrollmentSchema))
    input: CreateEnrollmentDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.createEnrollment(
      auth,
      input as unknown as CreateEnrollmentInput,
      requestMetadata(request),
    );
  }

  @Get("enrollments/:id")
  @ApiOperation({ summary: "Gets an organization enrollment" })
  enrollment(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.enrollment(auth, id);
  }

  @Patch("enrollments/:id")
  @ApiOperation({ summary: "Updates an organization enrollment" })
  @ApiBody({
    schema: {
      ...enrollmentBodySchema,
      minProperties: 1,
      properties: {
        amountCents: enrollmentBodySchema.properties.amountCents,
        chargeOpenDay: enrollmentBodySchema.properties.chargeOpenDay,
        chargeOpenTime: enrollmentBodySchema.properties.chargeOpenTime,
        dueDay: enrollmentBodySchema.properties.dueDay,
        discountCents: enrollmentBodySchema.properties.discountCents,
        endDate: enrollmentBodySchema.properties.endDate,
        status: {
          type: "string",
          enum: ["ACTIVE", "ENDED", "CANCELLED"],
        },
      },
    },
  })
  updateEnrollment(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEnrollmentSchema))
    input: UpdateEnrollmentDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.updateEnrollment(
      auth,
      id,
      input as unknown as UpdateEnrollmentInput,
      requestMetadata(request),
    );
  }
}
