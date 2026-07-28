import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

import { CurrentAuth, type AuthenticatedContext } from "../authorization/authorization-context";
import { CompanyAccountGuard, SessionAuthGuard } from "../authorization/authorization.guards";
import { chargeListQuerySchema, CreateManualPaymentDto, GenerateChargesDto, type ChargeListQuery, type CreateManualPaymentInput, type GenerateChargesInput } from "./financial.dto";
import { FinancialService } from "./financial.service";

@ApiTags("Financial")
@Controller({ path: "", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class FinancialController {
  constructor(@Inject(FinancialService) private readonly financial: FinancialService) {}

  @Post("charges/generate")
  generateCharges(@CurrentAuth() auth: AuthenticatedContext, @Body() input: GenerateChargesDto) {
    return this.financial.generateCharges(auth, input as unknown as GenerateChargesInput);
  }

  @Get("charges")
  charges(@CurrentAuth() auth: AuthenticatedContext, @Query() query: Record<string, string | undefined>) {
    return this.financial.charges(auth, chargeListQuerySchema.parse(query) as ChargeListQuery);
  }

  @Get("charges/:id")
  charge(@CurrentAuth() auth: AuthenticatedContext, @Param("id") id: string) { return this.financial.charge(auth, id); }

  @Post("charges/:id/cancel")
  cancel(@CurrentAuth() auth: AuthenticatedContext, @Param("id") id: string) { return this.financial.changeChargeStatus(auth, id, "CANCELLED"); }

  @Post("charges/:id/waive")
  waive(@CurrentAuth() auth: AuthenticatedContext, @Param("id") id: string) { return this.financial.changeChargeStatus(auth, id, "WAIVED"); }

  @Post("charges/:id/reopen")
  reopen(@CurrentAuth() auth: AuthenticatedContext, @Param("id") id: string) { return this.financial.changeChargeStatus(auth, id, "PENDING"); }

  @Post("charges/:id/payments")
  createPayment(@CurrentAuth() auth: AuthenticatedContext, @Param("id") id: string, @Body() input: CreateManualPaymentDto) { const parsed=CreateManualPaymentDto.schema.safeParse(input); if(!parsed.success) throw new BadRequestException({code:"VALIDATION_ERROR",message:"Invalid request data"}); return this.financial.createManualPayment(auth, id, parsed.data as CreateManualPaymentInput); }
  @Post("payments/:id/confirm") confirmPayment(@CurrentAuth() auth: AuthenticatedContext, @Param("id") id: string) { return this.financial.changePaymentStatus(auth, id, "CONFIRMED"); }
  @Post("payments/:id/cancel") cancelPayment(@CurrentAuth() auth: AuthenticatedContext, @Param("id") id: string) { return this.financial.changePaymentStatus(auth, id, "CANCELLED"); }
  @Post("payments/:id/reverse") reversePayment(@CurrentAuth() auth: AuthenticatedContext, @Param("id") id: string) { return this.financial.changePaymentStatus(auth, id, "REVERSED"); }
}
