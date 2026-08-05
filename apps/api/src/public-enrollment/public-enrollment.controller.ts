import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
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
  submitPublicEnrollmentSchema,
  updatePublicEnrollmentFormSchema,
  type SubmitPublicEnrollmentInput,
  type UpdatePublicEnrollmentFormInput,
} from "./public-enrollment.dto";
import { PublicEnrollmentService } from "./public-enrollment.service";

function metadata(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return {
    correlationId: getCorrelationId(request),
    ipAddress: request.ip,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
  };
}

function idempotencyKey(value: string | undefined): string {
  if (
    !value ||
    value.length < 8 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new BadRequestException({
      code: "IDEMPOTENCY_KEY_INVALID",
      message: "Idempotency-Key must contain 8 to 128 safe characters",
    });
  }
  return value;
}

@ApiTags("Public enrollment form")
@ApiCookieAuth("sessionCookie")
@Controller({ path: "workspace/public-enrollment-form", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class PublicEnrollmentFormController {
  constructor(
    @Inject(PublicEnrollmentService)
    private readonly service: PublicEnrollmentService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Gets the authenticated organization's public enrollment form",
  })
  async get(
    @CurrentAuth() auth: AuthenticatedContext,
  ): Promise<{ data: unknown }> {
    return { data: await this.service.getOwn(auth) };
  }

  @Post()
  @ApiOperation({
    summary: "Creates the organization's single public enrollment link",
  })
  async create(
    @CurrentAuth() auth: AuthenticatedContext,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return { data: await this.service.create(auth, metadata(request)) };
  }

  @Patch()
  @ApiOperation({ summary: "Updates public enrollment settings" })
  async update(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(updatePublicEnrollmentFormSchema))
    input: UpdatePublicEnrollmentFormInput,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return { data: await this.service.update(auth, input, metadata(request)) };
  }

  @Post("rotate")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Rotates the public enrollment link and invalidates the previous one",
  })
  async rotate(
    @CurrentAuth() auth: AuthenticatedContext,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return { data: await this.service.rotate(auth, metadata(request)) };
  }

  @Get("submissions")
  @ApiOperation({ summary: "Lists public enrollment requests for the authenticated organization" })
  async submissions(
    @CurrentAuth() auth: AuthenticatedContext,
  ): Promise<{ data: unknown }> {
    return { data: await this.service.listSubmissions(auth) };
  }

  @Post("submissions/:id/approve")
  @HttpCode(200)
  @ApiOperation({ summary: "Approves a public enrollment request atomically" })
  async approve(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return { data: await this.service.approve(auth, id, metadata(request)) };
  }

  @Delete("submissions/:id")
  @ApiOperation({ summary: "Permanently deletes a pending public enrollment request" })
  async reject(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return { data: await this.service.reject(auth, id, metadata(request)) };
  }
}

@ApiTags("Public enrollment")
@Controller({ path: "public/enrollment", version: "1" })
export class PublicEnrollmentController {
  constructor(
    @Inject(PublicEnrollmentService)
    private readonly service: PublicEnrollmentService,
  ) {}

  @Get(":token")
  @ApiOperation({ summary: "Gets a public enrollment form by signed token" })
  async get(@Param("token") token: string): Promise<{ data: unknown }> {
    return { data: await this.service.publicConfiguration(token) };
  }

  @Post(":token/photo")
  @ApiOperation({ summary: "Uploads the required student photo for a public enrollment" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  async uploadPhoto(
    @Param("token") token: string,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    const part = await request.file();
    if (!part) {
      throw new BadRequestException({
        code: "STUDENT_PHOTO_REQUIRED",
        message: "Envie uma foto do aluno.",
      });
    }
    return {
      data: await this.service.uploadStudentPhoto(
        token,
        {
          filename: part.filename,
          contentType: part.mimetype,
          body: await part.toBuffer(),
        },
        metadata(request),
      ),
    };
  }

  @Post(":token/submissions")
  @ApiOperation({
    summary: "Creates one student, guardian link and enrollment atomically",
  })
  async submit(
    @Param("token") token: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(submitPublicEnrollmentSchema))
    input: SubmitPublicEnrollmentInput,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.service.submit(
        token,
        idempotencyKey(rawIdempotencyKey),
        input,
        metadata(request),
      ),
    };
  }
}
