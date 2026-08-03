import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiCookieAuth,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";

import { HealthService } from "./health.service";
import { PlatformAdminGuard, SessionAuthGuard } from "../authorization/authorization.guards";

@ApiTags("health")
@Controller({ path: "health", version: "1" })
export class HealthController {
  constructor(
    @Inject(HealthService) private readonly health: HealthService,
  ) {}

  @Get("live")
  @ApiOperation({ summary: "Confirms that the API process is alive" })
  @ApiOkResponse({ description: "The API process is alive" })
  live() {
    return this.health.live();
  }

  @Get("ready")
  @ApiOperation({ summary: "Checks PostgreSQL and Redis readiness" })
  @ApiOkResponse({ description: "All required dependencies are ready" })
  @ApiServiceUnavailableResponse({
    description: "At least one required dependency is unavailable",
  })
  ready() {
    return this.health.ready();
  }

  @Get("platform")
  @UseGuards(SessionAuthGuard, PlatformAdminGuard)
  @ApiCookieAuth("sessionCookie")
  @ApiOperation({ summary: "Gets protected platform dependency health" })
  @ApiOkResponse({ description: "Platform health for internal administrators" })
  platform() {
    return this.health.platform();
  }
}
