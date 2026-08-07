import { createFileRoute } from "@tanstack/react-router";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiRequestError, apiRequest } from "@/lib/api";
import type { PublicEnrollmentConfiguration } from "@/lib/public-enrollment";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cadastro-aluno/$token")({
  head: () => ({
    meta: [
      { title: "Cadastro de aluno — Mensaly" },
      {
        name: "description",
        content: "Formulário seguro para cadastro e matrícula de aluno.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PublicEnrollmentPage,
});

type FormState = {
  studentName: string;
  documentValue: string;
  studentPhoto: File | null;
  studentPhotoFileId: string;
  birthDate: string;
  studentPhone: string;
  selfResponsible: boolean;
  guardianName: string;
  guardianCpf: string;
  guardianPhone: string;
  relationship: string;
  planId: string;
  privacyAccepted: boolean;
  companyWebsite: string;
};

const emptyForm: FormState = {
  studentName: "",
  documentValue: "",
  studentPhoto: null,
  studentPhotoFileId: "",
  birthDate: "",
  studentPhone: "",
  selfResponsible: false,
  guardianName: "",
  guardianCpf: "",
  guardianPhone: "",
  relationship: "",
  planId: "",
  privacyAccepted: false,
  companyWebsite: "",
};

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <legend className="px-1 text-lg font-semibold text-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}{" "}
        {required && (
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        )}
      </Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function PublicEnrollmentPage() {
  const pathname = usePathname();
  const token = decodeURIComponent(pathname.split("/")[2] ?? "");
  const [configuration, setConfiguration] =
    useState<PublicEnrollmentConfiguration | null>(null);
  const [loadingError, setLoadingError] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [studentValues, setStudentValues] = useState<Record<string, string>>({});
  const [guardianValues, setGuardianValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [completedName, setCompletedName] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );

  useEffect(() => {
    void apiRequest<PublicEnrollmentConfiguration>(
      `/public/enrollment/${encodeURIComponent(token)}`,
    )
      .then(setConfiguration)
      .catch((error) =>
        setLoadingError(
          error instanceof Error
            ? error.message
            : "Este link não está disponível.",
        ),
      );
  }, [token]);

  const accent = useMemo(() => {
    const color = configuration?.business.brandColor;
    return color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#3B4DF6";
  }, [configuration]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  function customValue(field: PublicEnrollmentConfiguration["fields"][number]) {
    return (field.subject === "STUDENT" ? studentValues : guardianValues)[field.id] ?? "";
  }

  function setCustomValue(field: PublicEnrollmentConfiguration["fields"][number], value: string) {
    const update = (current: Record<string, string>) => ({ ...current, [field.id]: value });
    if (field.subject === "STUDENT") setStudentValues(update);
    else setGuardianValues(update);
  }

  function validate() {
    if (!configuration) return false;
    const next: Record<string, string> = {};
    if (form.studentName.trim().length < 2)
      next.studentName = "Informe o nome completo do aluno.";
    if (!form.documentValue.trim())
      next.documentValue = "Informe o CPF ou RG do aluno.";
    if (!form.studentPhoto && !form.studentPhotoFileId)
      next.studentPhoto = "Envie uma foto do aluno.";
    if (!form.selfResponsible && !form.guardianName.trim())
      next.guardianName = "Informe o nome do responsável.";
    if (!form.selfResponsible && !form.guardianCpf.trim())
      next.guardianCpf = "Informe o CPF do responsável.";
    if (!form.selfResponsible && !form.guardianPhone.trim())
      next.guardianPhone = "Informe o WhatsApp do responsável.";
    if (form.selfResponsible && form.documentValue.replace(/\D/g, "").length !== 11)
      next.documentValue = "Para ser o próprio responsável, informe o CPF do aluno.";
    if (form.selfResponsible && !form.studentPhone.trim())
      next.studentPhone = "Informe o WhatsApp do aluno.";
    if (!form.planId) next.planId = "Escolha um plano.";
    if (!form.privacyAccepted)
      next.privacyAccepted = "O aceite é necessário para concluir.";
    const requiredStandard: Array<[boolean, keyof FormState, string]> = [
      [
        configuration.fieldConfiguration.studentBirthDateRequired,
        "birthDate",
        "Informe a data de nascimento.",
      ],
      [
        configuration.fieldConfiguration.studentPhoneRequired,
        "studentPhone",
        "Informe o telefone do aluno.",
      ],
      [
        configuration.fieldConfiguration.relationshipRequired,
        "relationship",
        "Informe a relação com o aluno.",
      ],
    ];
    requiredStandard.forEach(([required, key, message]) => {
      if (required && key !== "relationship" && !String(form[key]).trim()) next[key] = message;
    });
    configuration.fields.forEach((field) => {
      if (form.selfResponsible && field.subject === "GUARDIAN") return;
      const values = field.subject === "STUDENT" ? studentValues : guardianValues;
      if (field.required && !values[field.id]?.trim())
        next[`field-${field.id}`] = `Preencha ${field.label}.`;
    });
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) document.getElementById(first)?.focus();
    return !first;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!configuration || !validate()) return;
    setSubmitting(true);
    setErrors({});
    try {
      let photoFileId = form.studentPhotoFileId;
      if (!photoFileId && form.studentPhoto) {
        const photoData = new FormData();
        photoData.append("file", form.studentPhoto);
        const response = await fetch(
          `/api/v1/public/enrollment/${encodeURIComponent(token)}/photo`,
          { method: "POST", body: photoData },
        );
        const payload = (await response.json().catch(() => null)) as {
          data?: { id?: string };
          error?: { message?: string };
          message?: string;
        } | null;
        if (!response.ok || !payload?.data?.id) {
          throw new Error(
            payload?.error?.message ??
              payload?.message ??
              "Não foi possível enviar a foto. Tente novamente.",
          );
        }
        photoFileId = payload.data.id;
        set("studentPhotoFileId", photoFileId);
      }
      const result = await apiRequest<{ studentName: string }>(
        `/public/enrollment/${encodeURIComponent(token)}/submissions`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: {
            student: {
              name: form.studentName,
              document: { value: form.documentValue },
              photoFileId,
              ...(form.birthDate ? { birthDate: form.birthDate } : {}),
              phone: form.studentPhone,
            },
            guardian: form.selfResponsible ? {
              name: form.studentName,
              cpf: form.documentValue,
              phone: form.studentPhone,
              relationship: "Próprio aluno",
            } : {
              name: form.guardianName,
              cpf: form.guardianCpf,
              phone: form.guardianPhone,
              relationship: form.relationship,
            },
            selfResponsible: form.selfResponsible,
            planId: form.planId,
            studentValues,
            guardianValues,
            privacyAccepted: true,
            privacyNoticeVersion: configuration.privacyNoticeVersion,
            companyWebsite: form.companyWebsite,
          },
        },
      );
      setCompletedName(result.studentName);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setErrors({
        submit:
          error instanceof ApiRequestError
            ? error.message
            : "Não foi possível concluir. Revise os dados e tente novamente.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function anotherStudent() {
    setForm((current) => ({
      ...emptyForm,
      guardianName: current.guardianName,
      guardianCpf: current.guardianCpf,
      guardianPhone: current.guardianPhone,
      relationship: current.relationship,
    }));
    setStudentValues({});
    setGuardianValues({});
    setErrors({});
    setCompletedName("");
    setIdempotencyKey(crypto.randomUUID());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (loadingError) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="max-w-md rounded-2xl border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold">Link indisponível</h1>
          <p className="mt-2 text-muted-foreground">{loadingError}</p>
        </div>
      </main>
    );
  }
  if (!configuration) {
    return (
      <main
        className="grid min-h-dvh place-items-center"
        aria-label="Carregando formulário"
      >
        <Loader2 className="size-7 animate-spin text-primary" />
      </main>
    );
  }
  if (completedName) {
    return (
      <main className="grid min-h-dvh place-items-center p-5">
        <div className="w-full max-w-lg rounded-2xl border bg-card p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
          <h1 className="mt-4 text-2xl font-semibold">{configuration.fieldConfiguration.approvalMode === "AUTOMATIC" ? "Cadastro concluído" : "Solicitação enviada"}</h1>
          <p className="mt-2 text-muted-foreground">
            {configuration.fieldConfiguration.approvalMode === "AUTOMATIC"
              ? `O cadastro de ${completedName} foi concluído em ${configuration.business.name}.`
              : `O cadastro de ${completedName} foi enviado para análise de ${configuration.business.name}.`}
          </p>
          <Button className="mt-6 min-h-11 w-full" onClick={anotherStudent}>
            Cadastrar outro aluno
          </Button>
        </div>
      </main>
    );
  }

  const required = configuration.fieldConfiguration;
  return (
    <main className="min-h-dvh bg-background px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-none">
        <header className="mb-7 text-center">
          {configuration.business.logoDataUrl && (
            <div className="mx-auto mb-4 flex h-16 max-w-48 items-center justify-center">
              <img
                src={configuration.business.logoDataUrl}
                alt={`Logo de ${configuration.business.name}`}
                className="max-h-16 max-w-48 object-contain"
              />
            </div>
          )}
          <div
            className="mx-auto mb-3 h-1 w-12 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
          <p className="text-sm font-medium text-foreground">
            {configuration.business.name}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
            Cadastro e matrícula
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            Preencha os dados abaixo para solicitar o cadastro de um aluno. Campos com * são
            obrigatórios.
          </p>
        </header>

        <form className="space-y-5" onSubmit={submit} noValidate>
          <input
            className="absolute -left-[9999px]"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={form.companyWebsite}
            onChange={(event) => set("companyWebsite", event.target.value)}
          />
          <Section title="Aluno">
            <Field
              id="studentName"
              label="Nome completo"
              required
              error={errors.studentName}
            >
              <Input
                id="studentName"
                className="min-h-11"
                autoComplete="name"
                value={form.studentName}
                onChange={(event) => set("studentName", event.target.value)}
                aria-invalid={Boolean(errors.studentName)}
                aria-describedby={
                  errors.studentName ? "studentName-error" : undefined
                }
              />
            </Field>
            <Field
              id="documentValue"
              label="CPF ou RG"
              required
              error={errors.documentValue}
            >
              <Input
                id="documentValue"
                className="min-h-11"
                inputMode="text"
                value={form.documentValue}
                onChange={(event) => set("documentValue", event.target.value)}
                aria-invalid={Boolean(errors.documentValue)}
              />
            </Field>
            <Field
              id="studentPhotoUpload"
              label="Foto do aluno"
              required
              error={errors.studentPhoto}
            >
              <label
                htmlFor="studentPhoto"
                className="flex min-h-24 cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring"
              >
                <Camera className="size-5" aria-hidden />
                <span>
                  {form.studentPhoto
                    ? form.studentPhoto.name
                    : "Selecionar foto (JPG ou PNG)"}
                </span>
              </label>
              <Input
                id="studentPhoto"
                type="file"
                accept="image/jpeg,image/png"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  set("studentPhoto", file);
                  set("studentPhotoFileId", "");
                }}
                aria-invalid={Boolean(errors.studentPhoto)}
                aria-describedby={
                  errors.studentPhoto ? "studentPhotoUpload-error" : undefined
                }
              />
              <p className="text-xs text-muted-foreground">
                Arquivo JPG ou PNG de até 5 MB.
              </p>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="birthDate"
                label="Data de nascimento"
                required={required.studentBirthDateRequired}
                error={errors.birthDate}
              >
                <Input
                  id="birthDate"
                  type="date"
                  className="min-h-11"
                  value={form.birthDate}
                  onChange={(event) => set("birthDate", event.target.value)}
                />
              </Field>
              <Field
                id="studentPhone"
                label="Telefone do aluno"
                required={required.studentPhoneRequired || form.selfResponsible}
                error={errors.studentPhone}
              >
                <Input
                  id="studentPhone"
                  className="min-h-11"
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.studentPhone}
                  onChange={(event) => set("studentPhone", event.target.value)}
                />
              </Field>
            </div>
          </Section>

          <Section title="Responsável">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 text-sm font-medium text-foreground"><Checkbox checked={form.selfResponsible} onCheckedChange={(checked) => set("selfResponsible", checked === true)} /> O aluno é o próprio responsável</label>
            {form.selfResponsible ? <p className="text-sm text-muted-foreground">A cobrança será enviada para o telefone informado nos dados do aluno.</p> : <>
            <Field
              id="guardianName"
              label="Nome completo"
              required
              error={errors.guardianName}
            >
              <Input
                id="guardianName"
                className="min-h-11"
                autoComplete="name"
                value={form.guardianName}
                onChange={(event) => set("guardianName", event.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="guardianCpf"
                label="CPF"
                required
                error={errors.guardianCpf}
              >
                <Input
                  id="guardianCpf"
                  className="min-h-11"
                  inputMode="numeric"
                  value={form.guardianCpf}
                  onChange={(event) => set("guardianCpf", event.target.value)}
                />
              </Field>
              <Field
                id="guardianPhone"
                label="WhatsApp"
                required
                error={errors.guardianPhone}
              >
                <Input
                  id="guardianPhone"
                  className="min-h-11"
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.guardianPhone}
                  onChange={(event) => set("guardianPhone", event.target.value)}
                />
              </Field>
            </div>
            <Field
              id="relationship"
              label="Relação com o aluno"
              required={required.relationshipRequired}
              error={errors.relationship}
            >
              <Input
                id="relationship"
                className="min-h-11"
                placeholder="Ex.: mãe, pai ou responsável"
                value={form.relationship}
                onChange={(event) => set("relationship", event.target.value)}
              />
            </Field>
            </>}
          </Section>

          <Section title="Plano">
            {configuration.plans.length === 0 ? (
              <p className="text-sm text-destructive">
                Nenhum plano está disponível. Entre em contato com o local.
              </p>
            ) : (
              <RadioGroup
                id="planId"
                value={form.planId}
                onValueChange={(value) => set("planId", value)}
                aria-describedby={errors.planId ? "planId-error" : undefined}
              >
                {configuration.plans.map((plan) => (
                  <Label
                    key={plan.id}
                    htmlFor={`plan-${plan.id}`}
                    className={cn(
                      "flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-ring",
                      form.planId === plan.id &&
                        "border-primary bg-primary-soft",
                    )}
                  >
                    <RadioGroupItem
                      id={`plan-${plan.id}`}
                      value={plan.id}
                      className="mt-1 size-5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap justify-between gap-2 font-semibold">
                        <span>{plan.name}</span>
                        <span>{money(plan.amountCents)}/mês</span>
                      </span>
                      {plan.description && (
                        <span className="mt-1 block text-sm font-normal text-muted-foreground">
                          {plan.description}
                        </span>
                      )}
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        Vencimento todo dia {plan.dueDay}
                      </span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            )}
            {errors.planId && (
              <p
                id="planId-error"
                className="text-sm text-destructive"
                role="alert"
              >
                {errors.planId}
              </p>
            )}
          </Section>

          {configuration.fields.length > 0 && (
            <Section title="Dados adicionais">
              {(["STUDENT", "GUARDIAN"] as const).map((subject) => {
                const fields = configuration.fields.filter((field) => field.subject === subject && !(form.selfResponsible && subject === "GUARDIAN"));
                if (!fields.length) return null;
                return <div key={subject} className="space-y-4"><p className="text-sm font-semibold text-muted-foreground">{subject === "STUDENT" ? "Dados do aluno" : "Dados do responsável"}</p>{fields.map((field) => (
                <Field
                  key={field.id}
                  id={`field-${field.id}`}
                  label={field.label}
                  required={field.required}
                  error={errors[`field-${field.id}`]}
                >
                  {field.type === "SELECT" ? (
                    <Select
                      value={customValue(field)}
                      onValueChange={(value) => setCustomValue(field, value)}
                    >
                      <SelectTrigger
                        id={`field-${field.id}`}
                        className="min-h-11"
                      >
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : field.type === "BOOLEAN" ? (
                    <div className="flex min-h-11 items-center gap-3 rounded-lg border px-3">
                      <Checkbox
                        id={`field-${field.id}`}
                        checked={customValue(field) === "true"}
                        onCheckedChange={(checked) => setCustomValue(field, checked === true ? "true" : "false")}
                      />
                      <Label htmlFor={`field-${field.id}`}>Sim</Label>
                    </div>
                  ) : (
                    <Input
                      id={`field-${field.id}`}
                      className="min-h-11"
                      type={
                        field.type === "DATE"
                          ? "date"
                          : field.type === "NUMBER"
                            ? "number"
                            : "text"
                      }
                      value={customValue(field)}
                      onChange={(event) => setCustomValue(field, event.target.value)}
                    />
                  )}
                </Field>
              ))}</div>;
              })}
            </Section>
          )}

          <Section title="Privacidade e envio">
            <div className="flex items-start gap-3">
              <Checkbox
                id="privacyAccepted"
                className="mt-1 size-5"
                checked={form.privacyAccepted}
                onCheckedChange={(checked) =>
                  set("privacyAccepted", checked === true)
                }
                aria-describedby="privacy-text"
              />
              <div>
                <Label htmlFor="privacyAccepted" className="cursor-pointer">
                  Li e aceito o aviso de privacidade *
                </Label>
                <p
                  id="privacy-text"
                  className="mt-1 text-sm leading-6 text-muted-foreground"
                >
                  {configuration.privacyNotice}
                </p>
                {errors.privacyAccepted && (
                  <p className="mt-1 text-sm text-destructive" role="alert">
                    {errors.privacyAccepted}
                  </p>
                )}
              </div>
            </div>
            {errors.submit && (
              <p
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                role="alert"
              >
                {errors.submit}
              </p>
            )}
            <Button
              type="submit"
              className="min-h-12 w-full text-base"
              disabled={submitting || configuration.plans.length === 0}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Enviando…
                </>
              ) : (
                configuration.fieldConfiguration.approvalMode === "AUTOMATIC" ? "Concluir cadastro" : "Enviar solicitação"
              )}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Não feche esta página enquanto o envio estiver em andamento.
            </p>
          </Section>
        </form>
      </div>
    </main>
  );
}
