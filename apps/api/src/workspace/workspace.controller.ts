import {
  Body,
  Controller,
  Delete,
  Get,
  GoneException,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

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
  broadcastSchema,
  broadcastSendSchema,
  customFieldSchema,
  eventSchema,
  productSchema,
  studentValuesSchema,
  updateBroadcastSchema,
  updateCustomFieldSchema,
  updateEventSchema,
  updateProductSchema,
} from "./workspace.dto";
import { WorkspaceService } from "./workspace.service";

@ApiTags("Workspace")
@ApiCookieAuth("sessionCookie")
@Controller({ path: "workspace", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class WorkspaceController {
  constructor(@Inject(WorkspaceService) private readonly service: WorkspaceService) {}

  @Get()
  @ApiOperation({ summary: "Gets all organization workspace resources" })
  all(@CurrentAuth() auth: AuthenticatedContext): Promise<unknown> {
    return this.service.all(auth);
  }

  @Post("products")
  @ApiOperation({ summary: "Creates a product" })
  createProduct(@CurrentAuth() auth: AuthenticatedContext, @Body(new ZodValidationPipe(productSchema)) input: never) {
    return this.service.createProduct(auth, input);
  }
  @Patch("products/:id")
  @ApiOperation({ summary: "Updates a product" })
  updateProduct(@CurrentAuth() auth: AuthenticatedContext, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateProductSchema)) input: never) {
    return this.service.updateProduct(auth, id, input);
  }
  @Delete("products/:id")
  @ApiOperation({ summary: "Deletes a product" })
  @HttpCode(204)
  deleteProduct(@CurrentAuth() auth: AuthenticatedContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.deleteProduct(auth, id);
  }

  @Post("events")
  @ApiOperation({ summary: "Creates an event" })
  createEvent(@CurrentAuth() auth: AuthenticatedContext, @Body(new ZodValidationPipe(eventSchema)) input: never) {
    return this.service.createEvent(auth, input);
  }
  @Patch("events/:id")
  @ApiOperation({ summary: "Updates an event" })
  updateEvent(@CurrentAuth() auth: AuthenticatedContext, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateEventSchema)) input: never) {
    return this.service.updateEvent(auth, id, input);
  }
  @Delete("events/:id")
  @ApiOperation({ summary: "Deletes an event" })
  @HttpCode(204)
  deleteEvent(@CurrentAuth() auth: AuthenticatedContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.deleteEvent(auth, id);
  }

  @Post("custom-fields")
  @ApiOperation({ summary: "Creates a custom student field" })
  createField(@CurrentAuth() auth: AuthenticatedContext, @Body(new ZodValidationPipe(customFieldSchema)) input: never): Promise<unknown> {
    return this.service.createField(auth, input);
  }
  @Patch("custom-fields/:id")
  @ApiOperation({ summary: "Updates a custom student field" })
  updateField(@CurrentAuth() auth: AuthenticatedContext, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateCustomFieldSchema)) input: never): Promise<unknown> {
    return this.service.updateField(auth, id, input);
  }
  @Delete("custom-fields/:id")
  @ApiOperation({ summary: "Deletes a custom student field" })
  @HttpCode(204)
  deleteField(@CurrentAuth() auth: AuthenticatedContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.deleteField(auth, id);
  }

  @Patch("student-field-values/:studentId")
  @ApiOperation({ summary: "Replaces a student's custom field values" })
  replaceValues(@CurrentAuth() auth: AuthenticatedContext, @Param("studentId", ParseUUIDPipe) studentId: string, @Body(new ZodValidationPipe(studentValuesSchema)) input: { values: Record<string, string> }) {
    return this.service.replaceStudentValues(auth, studentId, input.values);
  }

  @Patch("guardian-field-values/:guardianId")
  @ApiOperation({ summary: "Replaces a guardian's custom field values" })
  replaceGuardianValues(@CurrentAuth() auth: AuthenticatedContext, @Param("guardianId", ParseUUIDPipe) guardianId: string, @Body(new ZodValidationPipe(studentValuesSchema)) input: { values: Record<string, string> }) {
    return this.service.replaceGuardianValues(auth, guardianId, input.values);
  }

  @Post("broadcasts")
  @ApiOperation({ summary: "Creates a broadcast message" })
  createBroadcast(@CurrentAuth() auth: AuthenticatedContext, @Body(new ZodValidationPipe(broadcastSchema)) input: never) {
    return this.service.createBroadcast(auth, input);
  }
  @Patch("broadcasts/:id")
  @ApiOperation({ summary: "Updates a broadcast message" })
  updateBroadcast(@CurrentAuth() auth: AuthenticatedContext, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateBroadcastSchema)) input: never) {
    return this.service.updateBroadcast(auth, id, input);
  }
  @Delete("broadcasts/:id")
  @ApiOperation({ summary: "Deletes a broadcast message" })
  @HttpCode(204)
  deleteBroadcast(@CurrentAuth() auth: AuthenticatedContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.deleteBroadcast(auth, id);
  }
  @Post("broadcast-sends")
  @ApiOperation({ summary: "Queues a broadcast for selected students" })
  queueBroadcast(@CurrentAuth() auth: AuthenticatedContext, @Body(new ZodValidationPipe(broadcastSendSchema)) input: { messageId: string; studentIds: string[]; scheduledFor?: string | null }) {
    return this.service.queueBroadcast(auth, input);
  }
}

@ApiTags("Public forms")
@Controller({ path: "public/forms", version: "1" })
export class PublicFormsController {
  @Get(":organizationId")
  @ApiOperation({ summary: "Legacy public custom form (retired)" })
  get(): never {
    throw new GoneException({
      code: "LEGACY_PUBLIC_FORM_RETIRED",
      message: "Este formulário foi substituído. Solicite ao local o novo link de cadastro.",
    });
  }

  @Post(":organizationId/responses")
  @ApiOperation({ summary: "Legacy public custom form submission (retired)" })
  submit(): never {
    throw new GoneException({
      code: "LEGACY_PUBLIC_FORM_RETIRED",
      message: "Este formulário foi substituído. Solicite ao local o novo link de cadastro.",
    });
  }
}
