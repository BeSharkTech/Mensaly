import { Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentAuth, type AuthenticatedContext } from "../authorization/authorization-context";
import { CompanyAccountGuard, SessionAuthGuard } from "../authorization/authorization.guards";
import { WhatsAppService } from "./whatsapp.service";

@ApiTags("WhatsApp")
@ApiCookieAuth("sessionCookie")
@Controller({ path: "whatsapp", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get("status")
  @ApiOperation({ summary: "Gets the authenticated company's WhatsApp connection state" })
  @ApiOkResponse({ description: "Connection state and a temporary pairing QR when available" })
  status(@CurrentAuth() auth: AuthenticatedContext) {
    return { data: this.whatsapp.status(auth) };
  }

  @Post("connect")
  @HttpCode(200)
  @ApiOperation({ summary: "Starts a Baileys connection and requests a QR code" })
  connect(@CurrentAuth() auth: AuthenticatedContext) {
    return this.whatsapp.connect(auth).then((data) => ({ data }));
  }

  @Post("disconnect")
  @HttpCode(200)
  @ApiOperation({ summary: "Disconnects the authenticated company's WhatsApp test session" })
  disconnect(@CurrentAuth() auth: AuthenticatedContext) {
    return this.whatsapp.disconnect(auth).then((data) => ({ data }));
  }
}
