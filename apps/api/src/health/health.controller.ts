import { Controller, Get, Inject } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";

import { HealthService } from "./health.service";

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
}
