import { z } from "zod";

export const mercadoPagoCheckoutTokenSchema = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);

export const mercadoPagoOAuthCallbackSchema = z.object({
  code: z.string().trim().min(1).max(2_048),
  state: z.string().trim().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/),
});

const identificationSchema = z.object({
  type: z.string().trim().min(1).max(20),
  number: z.string().trim().min(3).max(30),
});

export const mercadoPagoBrickSubmissionSchema = z.object({
  paymentType: z.string().trim().min(1).max(40),
  selectedPaymentMethod: z.string().trim().min(1).max(40),
  formData: z.object({
    token: z.string().trim().min(1).max(2_048).optional(),
    issuer_id: z.union([z.string(), z.number()]).transform(String).optional(),
    payment_method_id: z.string().trim().min(1).max(80),
    payment_type_id: z.string().trim().min(1).max(40).optional(),
    transaction_amount: z.number().positive().optional(),
    installments: z.number().int().min(1).max(48).optional(),
    payer: z.object({
      email: z.string().trim().email().max(255),
      identification: identificationSchema.optional(),
    }),
  }).passthrough(),
}).passthrough();

export type MercadoPagoBrickSubmission = z.infer<typeof mercadoPagoBrickSubmissionSchema>;
