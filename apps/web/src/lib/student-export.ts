import type { Charge, Student } from "@/lib/data";
import { formatCents, formatDateOnly } from "@/lib/format";

export type StudentExportRow = {
  plan: string;
  name: string;
  document: string;
  birthDate: string;
  guardian: string;
  status: string;
  paymentStatus?: string;
  paymentDueDate?: string;
  paymentAmount?: string;
};

type StudentExportInput = {
  students: Student[];
  charges: Charge[];
};

type StudentExportOptions = {
  includePaymentStatus: boolean;
  asOf?: Date;
};

function paymentDetails(charge: Charge | undefined, asOf: Date) {
  if (!charge) return { paymentStatus: "Sem cobrança", paymentDueDate: "—", paymentAmount: "—" };
  if (charge.status === "PAID") {
    return { paymentStatus: "Pago", paymentDueDate: formatDateOnly(charge.dueDate), paymentAmount: formatCents(charge.finalAmountCents) };
  }
  const status = charge.dueDate < asOf.toISOString().slice(0, 10) ? "Vencido" : "Em aberto";
  return { paymentStatus: status, paymentDueDate: formatDateOnly(charge.dueDate), paymentAmount: formatCents(charge.finalAmountCents) };
}

export function buildStudentExportRows(
  input: StudentExportInput,
  options: StudentExportOptions,
): StudentExportRow[] {
  const asOf = options.asOf ?? new Date();
  return [...input.students]
    .sort((left, right) => left.plan.localeCompare(right.plan, "pt-BR") || left.name.localeCompare(right.name, "pt-BR"))
    .map((student) => {
      const row: StudentExportRow = {
        plan: student.plan || "Sem plano",
        name: student.name,
        document: [student.cpf, student.rg].filter(Boolean).join(" / ") || "—",
        birthDate: student.birthDate ? formatDateOnly(student.birthDate) : "—",
        guardian: student.guardian || "—",
        status: student.status === "ACTIVE" ? "Ativo" : "Inativo",
      };
      if (options.includePaymentStatus) Object.assign(row, paymentDetails(input.charges.find((charge) => charge.studentId === student.id && charge.status !== "CANCELLED"), asOf));
      return row;
    });
}

export function groupStudentsByPlan(rows: StudentExportRow[]) {
  return rows.reduce<Record<string, StudentExportRow[]>>((groups, row) => {
    (groups[row.plan] ??= []).push(row);
    return groups;
  }, {});
}

function safeCsvValue(value: string) {
  const formulaPrefix = /^[=+\-@]/.test(value) ? "'" : "";
  return `${formulaPrefix}${value}`.replaceAll('"', '""');
}

export function toStudentCsv(rows: StudentExportRow[]) {
  const hasPaymentStatus = rows.some((row) => row.paymentStatus !== undefined);
  const headers = ["Plano", "Aluno", "CPF/RG", "Nascimento", "Responsável", "Situação"];
  if (hasPaymentStatus) headers.push("Status da cobrança", "Vencimento", "Valor da cobrança");
  const lines = rows.map((row) => {
    const values = [row.plan, row.name, row.document, row.birthDate, row.guardian, row.status];
    if (hasPaymentStatus) values.push(row.paymentStatus ?? "—", row.paymentDueDate ?? "—", row.paymentAmount ?? "—");
    return values.map((value) => `"${safeCsvValue(value)}"`).join(";");
  });
  return `\uFEFF${headers.join(";")}\n${lines.join("\n")}`;
}

export function studentExportFilename(organizationName: string, format: "pdf" | "csv") {
  const safeName = organizationName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mensaly";
  return `alunos-${safeName}.${format}`;
}

export type StudentProfileSections = {
  student: string[][];
  guardian: string[][];
  enrollment: string[][];
  payment: string[][];
  additional: string[][];
};

export function buildStudentProfileSections(input: {
  student: Student;
  charge?: Charge;
  customFields: Array<{ id: string; label: string; subject: "STUDENT" | "GUARDIAN" }>;
  values: Record<string, string>;
  guardianValues?: Record<string, string>;
  guardianDetails?: Array<[string, string]>;
}): StudentProfileSections {
  const { student, charge } = input;
  const payment = paymentDetails(charge, new Date());
  return {
    student: [
      ["Nome", student.name],
      ["CPF/RG", [student.cpf, student.rg].filter(Boolean).join(" / ") || "—"],
      ["Nascimento", student.birthDate ? formatDateOnly(student.birthDate) : "—"],
      ["Situação", student.status === "ACTIVE" ? "Ativo" : "Inativo"],
    ] as Array<[string, string]>,
    guardian: [
      ["Responsável", student.guardian || "Sem responsável"],
      ...(input.guardianDetails ?? []),
      ...input.customFields
        .filter(
          (field) =>
            field.subject === "GUARDIAN" && input.guardianValues?.[field.id],
        )
        .map((field) => [field.label, input.guardianValues?.[field.id] ?? ""] as [string, string]),
    ] as Array<[string, string]>,
    enrollment: [["Plano", student.plan || "Sem plano"]] as Array<[string, string]>,
    payment: [["Situação", payment.paymentStatus], ["Vencimento", payment.paymentDueDate], ["Valor", payment.paymentAmount]],
    additional: input.customFields
      .filter((field) => field.subject === "STUDENT" && input.values[field.id])
      .map((field) => [field.label, input.values[field.id]] as [string, string]),
  };
}

export type StudentExportBrand = {
  organizationName: string;
  brandColor?: string | null;
};

function hexToRgb(value?: string | null): [number, number, number] {
  const normalized = value?.replace("#", "").trim();
  if (!normalized || !/^[0-9a-f]{6}$/i.test(normalized)) return [37, 99, 235];
  return [parseInt(normalized.slice(0, 2), 16), parseInt(normalized.slice(2, 4), 16), parseInt(normalized.slice(4, 6), 16)];
}

async function pdfTools() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return { jsPDF, autoTable };
}

async function loadImageDataUrl(url: string) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) return null;
  const blob = await response.blob();
  const format = blob.type === "image/png" ? "PNG" : blob.type === "image/jpeg" ? "JPEG" : null;
  if (!format) return null;
  return new Promise<{ dataUrl: string; format: "PNG" | "JPEG" } | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? { dataUrl: reader.result, format } : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

function addPdfHeader(doc: import("jspdf").jsPDF, brand: StudentExportBrand, title: string) {
  const color = hexToRgb(brand.brandColor);
  doc.setFillColor(...color);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 18, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text(brand.organizationName || "Mensaly", 14, 11);
  doc.setTextColor(24, 24, 27);
  doc.setFontSize(18);
  doc.text(title, 14, 31);
}

export async function downloadStudentListPdf(
  rows: StudentExportRow[],
  brand: StudentExportBrand,
  includePaymentStatus: boolean,
) {
  const { jsPDF, autoTable } = await pdfTools();
  const doc = new jsPDF({ orientation: "landscape" });
  addPdfHeader(doc, brand, "Lista de alunos");
  const headers = ["Plano", "Aluno", "CPF/RG", "Nascimento", "Responsável", "Situação"];
  if (includePaymentStatus) headers.push("Cobrança", "Vencimento", "Valor");
  autoTable(doc, {
    startY: 39,
    head: [headers],
    body: rows.map((row) => {
      const values = [row.plan, row.name, row.document, row.birthDate, row.guardian, row.status];
      if (includePaymentStatus) values.push(row.paymentStatus ?? "—", row.paymentDueDate ?? "—", row.paymentAmount ?? "—");
      return values;
    }),
    headStyles: { fillColor: hexToRgb(brand.brandColor), textColor: 255 },
    styles: { fontSize: 8, cellPadding: 2.5 },
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.setTextColor(113, 113, 122);
      doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 14, doc.internal.pageSize.getHeight() - 8);
    },
  });
  doc.save(studentExportFilename(brand.organizationName, "pdf"));
}

export async function downloadStudentProfilePdf(input: {
  brand: StudentExportBrand;
  student: Student;
  sections: ReturnType<typeof buildStudentProfileSections>;
  photoUrl?: string | null;
}) {
  const { jsPDF, autoTable } = await pdfTools();
  const doc = new jsPDF();
  addPdfHeader(doc, input.brand, "Ficha do aluno");
  doc.setFontSize(14);
  doc.text(input.student.name, 14, 43);
  const photoDataUrl = input.photoUrl ? await loadImageDataUrl(input.photoUrl) : null;
  if (photoDataUrl) {
    doc.addImage(photoDataUrl.dataUrl, photoDataUrl.format, 166, 25, 28, 28);
  }
  let startY = 49;
  const section = (title: string, rows: string[][]) => {
    if (!rows.length) return;
    doc.setFontSize(11);
    doc.setTextColor(24, 24, 27);
    doc.text(title, 14, startY + 6);
    autoTable(doc, {
      startY: startY + 9,
      body: rows,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 48 } },
      margin: { left: 14, right: 14 },
    });
    startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  };
  section("Dados do aluno", input.sections.student);
  section("Responsável", input.sections.guardian);
  section("Matrícula", input.sections.enrollment);
  section("Cobrança", input.sections.payment);
  section("Dados adicionais", input.sections.additional);
  doc.save(`ficha-${input.student.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-") || input.student.id}.pdf`);
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
