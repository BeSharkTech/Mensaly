import { disconnectPrismaClient, getPrismaClient } from "@mensaly/database";

import { createStripeGateway } from "../src/stripe-connect/stripe-connect.gateway";
import {
  stripeProductDescription,
  stripeSupportPhone,
} from "../src/stripe-connect/stripe-connect.service";

async function main() {
  if (process.env.STRIPE_CONNECT_MODE !== "test") {
    throw new Error("This verification is restricted to STRIPE_CONNECT_MODE=test.");
  }
  const prisma = getPrismaClient();
  const connection = await prisma.stripeConnection.findFirst({
    where: { stripeAccountId: { not: null } },
    orderBy: { updatedAt: "desc" },
    include: {
      organization: {
        select: { name: true, legalName: true, brand: true, phone: true },
      },
    },
  });
  if (!connection?.stripeAccountId) {
    throw new Error("No connected sandbox account is available for verification.");
  }

  const gateway = createStripeGateway();
  const session = await gateway.createEmbeddedOnboardingSession({
    accountId: connection.stripeAccountId,
    businessName: connection.organization.legalName ?? connection.organization.name,
    productDescription: stripeProductDescription(connection.organization.brand),
    supportPhone: stripeSupportPhone(connection.organization.phone),
  });
  process.stdout.write(
    `${JSON.stringify({
      providerSessionCreated: Boolean(session.clientSecret),
      publishableKeyConfigured: Boolean(gateway.publishableKey),
      expiresInFuture: session.expiresAt.getTime() > Date.now(),
    })}\n`,
  );
}

main()
  .finally(disconnectPrismaClient)
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
