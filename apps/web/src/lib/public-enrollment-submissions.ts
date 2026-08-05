export type PublicEnrollmentSubmission = {
  id: string;
  status: "PENDING" | "APPROVED";
  createdAt: string;
  student: {
    name: string;
    cpf?: string | null;
    rg?: string | null;
    birthDate?: string;
    phone?: string;
  };
  guardian: {
    name: string;
    cpf?: string | null;
    phone?: string;
    relationship?: string;
  };
  plan: { id: string; name: string; amountCents: number; dueDay: number } | null;
  values: Record<string, string>;
  photo: { id: string; contentType: string; sizeBytes: number } | null;
};
