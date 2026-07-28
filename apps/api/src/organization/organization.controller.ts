import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Patch, Post, Req } from "@nestjs/common";
import { ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import { AuthService } from "../auth/auth.service";
import { readSessionToken } from "../auth/session-cookie";
import { CreateOrganizationDto, UpdateOrganizationDto } from "./organization.dto";
import { OrganizationService } from "./organization.service";

function requestMetadata(request: FastifyRequest): { ipAddress?: string; userAgent?: string } {
  const userAgent = request.headers["user-agent"];
  return {
    ipAddress: request.ip,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
  };
}

@ApiTags("Organization")
@Controller({ path: "organization", version: "1" })
export class OrganizationController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(OrganizationService) private readonly organizationService: OrganizationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({ schema: { type: "object", required: ["name", "taxId", "phone"], properties: { name: { type: "string", minLength: 2, maxLength: 120 }, legalName: { type: "string", maxLength: 160 }, taxId: { type: "string", description: "CPF or CNPJ" }, phone: { type: "string" }, timezone: { type: "string", example: "America/Sao_Paulo" }, address: { type: "object" }, brand: { type: "object" } } } })
  @ApiCreatedResponse({ description: "Organization created for the authenticated account" })
  @ApiConflictResponse({ description: "The account already has an organization or tax ID is in use" })
  @ApiUnauthorizedResponse({ description: "A valid session is required" })
  async create(@Body() input: CreateOrganizationDto, @Req() request: FastifyRequest): Promise<{ data: unknown }> {
    const user = await this.authService.currentSession(readSessionToken(request.headers.cookie));
    return { data: await this.organizationService.create(user, input, requestMetadata(request)) };
  }

  @Get()
  @ApiOkResponse({ description: "Authenticated account organization" })
  @ApiUnauthorizedResponse({ description: "A valid session is required" })
  async getOwn(@Req() request: FastifyRequest): Promise<{ data: unknown }> {
    const user = await this.authService.currentSession(readSessionToken(request.headers.cookie));
    return { data: await this.organizationService.getOwn(user) };
  }

  @Patch()
  @ApiBody({ schema: { type: "object", minProperties: 1, properties: { name: { type: "string" }, legalName: { type: "string" }, taxId: { type: "string" }, phone: { type: "string" }, timezone: { type: "string" }, address: { type: "object" }, brand: { type: "object" } } } })
  @ApiOkResponse({ description: "Authenticated account organization updated" })
  @ApiConflictResponse({ description: "Tax ID is already in use" })
  @ApiUnauthorizedResponse({ description: "A valid session is required" })
  async update(@Body() input: UpdateOrganizationDto, @Req() request: FastifyRequest): Promise<{ data: unknown }> {
    const user = await this.authService.currentSession(readSessionToken(request.headers.cookie));
    return { data: await this.organizationService.update(user, input, requestMetadata(request)) };
  }
}
