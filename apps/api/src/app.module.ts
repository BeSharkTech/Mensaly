import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { DatabaseModule } from "./infrastructure/database/database.module";
import { RedisHealthService } from "./infrastructure/cache/redis-health.service";
import { HealthController } from "./health/health.controller";
import { HealthService } from "./health/health.service";
import { OrganizationModule } from "./organization/organization.module";
import { OperationalModule } from "./operational/operational.module";
import { FinancialModule } from "./financial/financial.module";
import { RemindersModule } from "./reminders/reminders.module";
import { WebhookInboxModule } from "./webhook-inbox/webhook-inbox.module";
import { FilesModule } from "./files/files.module";
import { InsightsModule } from "./insights/insights.module";
import { SecurityModule } from "./security/security.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { ResendWebhookModule } from "./resend-webhook/resend-webhook.module";
import { MercadoPagoModule } from "./mercadopago/mercadopago.module";

@Module({
  imports: [DatabaseModule, AuthModule, OrganizationModule, AdminModule, OperationalModule, FinancialModule, RemindersModule, WebhookInboxModule, ResendWebhookModule, MercadoPagoModule, FilesModule, InsightsModule, SecurityModule, WorkspaceModule],
  controllers: [HealthController],
  providers: [HealthService, RedisHealthService],
})
export class AppModule {}
