import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { apiRequest } from "@/lib/api";

const configSchema = z.object({ businessId: z.string().uuid() });
const submitSchema = z.object({
  businessId: z.string().uuid(),
  cpf: z.string().trim().min(11).max(14),
  values: z.record(z.string().uuid(), z.string().max(500)),
});

export type StudentFormConfig = {
  business: { name: string; logoDataUrl: string | null; brandColor: string | null; city: string; segment: string };
  fields: { id: string; label: string; type: string; options: string[]; required: boolean }[];
};

type StudentFormSubmitResult = { studentName: string; saved: number };

/** Public read: the API exposes only the branding and active field definitions. */
export const getStudentFormConfig = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => configSchema.parse(data))
  .handler(({ data }): Promise<StudentFormConfig> => apiRequest(`/public/forms/${data.businessId}`));

/** Public submit: CPF lookup and persistence happen in the API. */
export const submitStudentForm = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => submitSchema.parse(data))
  .handler(({ data }): Promise<StudentFormSubmitResult> =>
    apiRequest<StudentFormSubmitResult>(`/public/forms/${data.businessId}/responses`, {
      method: "POST",
      body: { cpf: data.cpf, values: data.values },
    }),
  );
