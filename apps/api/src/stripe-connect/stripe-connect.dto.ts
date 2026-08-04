import { z } from "zod";

export const checkoutTokenSchema = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);

export const stripeEventMetadataSchema = z.object({
  mensalyChargeId: z.string().uuid().optional(),
  mensalyCheckoutId: z.string().uuid().optional(),
}).passthrough();
