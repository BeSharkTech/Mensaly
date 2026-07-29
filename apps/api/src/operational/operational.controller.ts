import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import {
  CurrentAuth,
  type AuthenticatedContext,
} from "../authorization/authorization-context";
import {
  CompanyAccountGuard,
  SessionAuthGuard,
} from "../authorization/authorization.guards";
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
import { OperationalService } from "./operational.service";

@ApiTags("Operational CRUD")
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
  createPlan(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createPlanSchema)) input: CreatePlanDto,
  ) {
    return this.service.createPlan(
      auth,
      input as unknown as CreatePlanInput,
    );
  }

  @Get("plans/:id")
  @ApiOperation({ summary: "Gets an organization plan" })
  plan(@CurrentAuth() auth: AuthenticatedContext, @Param("id") id: string) {
    return this.service.plan(auth, id);
  }

  @Patch("plans/:id")
  @ApiOperation({ summary: "Updates an organization plan" })
  updatePlan(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePlanSchema)) input: UpdatePlanDto,
  ) {
    return this.service.updatePlan(
      auth,
      id,
      input as unknown as UpdatePlanInput,
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
  createStudent(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createStudentSchema)) input: CreateStudentDto,
  ) {
    return this.service.createStudent(
      auth,
      input as unknown as CreateStudentInput,
    );
  }

  @Get("students/:id")
  @ApiOperation({ summary: "Gets an organization student" })
  student(@CurrentAuth() auth: AuthenticatedContext, @Param("id") id: string) {
    return this.service.student(auth, id);
  }

  @Patch("students/:id")
  @ApiOperation({ summary: "Updates an organization student" })
  updateStudent(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateStudentSchema)) input: UpdateStudentDto,
  ) {
    return this.service.updateStudent(
      auth,
      id,
      input as unknown as UpdateStudentInput,
    );
  }

  @Post("students/:studentId/guardians/:guardianId")
  @ApiOperation({ summary: "Links a guardian to a student" })
  link(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("studentId") studentId: string,
    @Param("guardianId") guardianId: string,
    @Body(new ZodValidationPipe(linkGuardianSchema)) input: LinkGuardianInput,
  ) {
    return this.service.linkGuardian(
      auth,
      studentId,
      guardianId,
      input.relationship,
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
  createGuardian(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createGuardianSchema)) input: CreateGuardianDto,
  ) {
    return this.service.createGuardian(
      auth,
      input as unknown as CreateGuardianInput,
    );
  }

  @Get("guardians/:id")
  @ApiOperation({ summary: "Gets an organization guardian" })
  guardian(@CurrentAuth() auth: AuthenticatedContext, @Param("id") id: string) {
    return this.service.guardian(auth, id);
  }

  @Patch("guardians/:id")
  @ApiOperation({ summary: "Updates an organization guardian" })
  updateGuardian(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateGuardianSchema))
    input: UpdateGuardianDto,
  ) {
    return this.service.updateGuardian(
      auth,
      id,
      input as unknown as UpdateGuardianInput,
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
  createEnrollment(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createEnrollmentSchema))
    input: CreateEnrollmentDto,
  ) {
    return this.service.createEnrollment(
      auth,
      input as unknown as CreateEnrollmentInput,
    );
  }

  @Get("enrollments/:id")
  @ApiOperation({ summary: "Gets an organization enrollment" })
  enrollment(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id") id: string,
  ) {
    return this.service.enrollment(auth, id);
  }

  @Patch("enrollments/:id")
  @ApiOperation({ summary: "Updates an organization enrollment" })
  updateEnrollment(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateEnrollmentSchema))
    input: UpdateEnrollmentDto,
  ) {
    return this.service.updateEnrollment(
      auth,
      id,
      input as unknown as UpdateEnrollmentInput,
    );
  }
}
