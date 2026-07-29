import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  CurrentAuth,
  type AuthenticatedContext,
} from "../authorization/authorization-context";
import {
  CompanyAccountGuard,
  SessionAuthGuard,
} from "../authorization/authorization.guards";
import { fileListSchema } from "./files.dto";
import { FilesService } from "./files.service";

@ApiTags("Files")
@Controller({ path: "files", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class FilesController {
  constructor(
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  @Post()
  @ApiOperation({ summary: "Uploads a validated organization file" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
      },
    },
  })
  @ApiCreatedResponse({ description: "File persisted with integrity metadata" })
  async upload(
    @CurrentAuth() auth: AuthenticatedContext,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    const part = await request.file();
    if (!part) {
      throw new BadRequestException({
        code: "FILE_REQUIRED",
        message: "A multipart file is required",
      });
    }
    try {
      const body = await part.toBuffer();
      return {
        data: await this.files.upload(auth, {
          filename: part.filename,
          contentType: part.mimetype,
          body,
        }),
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "FST_REQ_FILE_TOO_LARGE"
      ) {
        throw new BadRequestException({
          code: "INVALID_FILE_SIZE",
          message: "The uploaded file exceeds the configured size limit",
        });
      }
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: "Lists active files from the current organization" })
  @ApiOkResponse({ description: "Paginated file metadata" })
  async list(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query() query: Record<string, string | undefined>,
  ): Promise<{ data: unknown[]; meta: Record<string, number> }> {
    const result = await this.files.list(auth, fileListSchema.parse(query));
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

  @Post("cleanup")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Retries controlled cleanup of incomplete files" })
  @ApiOkResponse({ description: "Cleanup summary, limited to 100 objects" })
  async cleanup(
    @CurrentAuth() auth: AuthenticatedContext,
  ): Promise<{ data: unknown }> {
    return { data: await this.files.cleanup(auth) };
  }

  @Get(":id")
  @ApiOperation({ summary: "Gets organization-scoped file metadata" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ description: "File metadata" })
  async get(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ data: unknown }> {
    return { data: await this.files.get(auth, id) };
  }

  @Get(":id/content")
  @ApiOperation({ summary: "Downloads an integrity-checked organization file" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ description: "Original file bytes" })
  async download(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.files.download(auth, id);
    const metadata = file.metadata as {
      originalName: string;
      contentType: string;
    };
    reply.type(metadata.contentType);
    reply.header(
      "Content-Disposition",
      `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(metadata.originalName)}`,
    );
    reply.header("X-Content-Type-Options", "nosniff");
    reply.send(file.body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Deletes a file through a retry-safe cleanup flow" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiNoContentResponse({ description: "File deleted or already deleted" })
  async delete(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.files.delete(auth, id);
  }
}
