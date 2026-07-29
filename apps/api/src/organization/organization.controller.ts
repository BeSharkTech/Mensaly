import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBody, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import { CurrentAuth, type AuthenticatedContext } from "../authorization/authorization-context";
import { CompanyAccountGuard, SessionAuthGuard } from "../authorization/authorization.guards";
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
@ApiCookieAuth("sessionCookie")
@Controller({ path: "organization", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class OrganizationController {
  constructor(@Inject(OrganizationService) private readonly organizationService: OrganizationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Creates the authenticated owner's organization" })
  @ApiBody({ schema: { type: "object", required: ["name", "taxId", "phone"], properties: { name: { type: "string", minLength: 2, maxLength: 120 }, legalName: { type: "string", maxLength: 160 }, taxId: { type: "string", description: "CPF or CNPJ" }, phone: { type: "string" }, timezone: { type: "string", example: "America/Sao_Paulo" }, address: { type: "object" }, brand: { type: "object" } } } })
  @ApiCreatedResponse({ description: "Organization created for the authenticated account" })
  @ApiConflictResponse({ description: "The account already has an organization or tax ID is in use" })
  @ApiUnauthorizedResponse({ description: "A valid session is required" })
  async create(@Body() input: CreateOrganizationDto, @CurrentAuth() auth: AuthenticatedContext, @Req() request: FastifyRequest): Promise<{ data: unknown }> {
    return { data: await this.organizationService.create(auth, input, requestMetadata(request)) };
  }

  @Get()
  @ApiOperation({ summary: "Gets the authenticated owner's organization" })
  @ApiOkResponse({ description: "Authenticated account organization" })
  @ApiUnauthorizedResponse({ description: "A valid session is required" })
  async getOwn(@CurrentAuth() auth: AuthenticatedContext): Promise<{ data: unknown }> {
    return { data: await this.organizationService.getOwn(auth) };
  }

  @Patch()
  @ApiOperation({ summary: "Updates the authenticated owner's organization" })
  @ApiBody({ schema: { type: "object", minProperties: 1, properties: { name: { type: "string" }, legalName: { type: "string" }, taxId: { type: "string" }, phone: { type: "string" }, timezone: { type: "string" }, address: { type: "object" }, brand: { type: "object" } } } })
  @ApiOkResponse({ description: "Authenticated account organization updated" })
  @ApiConflictResponse({ description: "Tax ID is already in use" })
  @ApiUnauthorizedResponse({ description: "A valid session is required" })
  async update(@Body() input: UpdateOrganizationDto, @CurrentAuth() auth: AuthenticatedContext, @Req() request: FastifyRequest): Promise<{ data: unknown }> {
    return { data: await this.organizationService.update(auth, input, requestMetadata(request)) };
  }
}
