import { createFileRoute } from "@tanstack/react-router";
import { Eye, Trash2, UserRoundCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/api";
import { formatCents, formatDateTime } from "@/lib/format";
import type { PublicEnrollmentSubmission } from "@/lib/public-enrollment-submissions";

export const Route = createFileRoute("/permissoes-cadastro")({
  head: () => ({ meta: [{ title: "Permissões de cadastro — Mensaly" }] }),
  component: EnrollmentPermissionsPage,
});

function documentLabel(submission: PublicEnrollmentSubmission) {
  return submission.student.cpf
    ? `CPF ${submission.student.cpf}`
    : submission.student.rg
      ? `RG ${submission.student.rg}`
      : "Documento informado";
}

function EnrollmentPermissionsPage() {
  return <AppShell><PageHeader title="Permissões de cadastro" description="Revise os pedidos enviados pelos responsáveis antes de criar alunos e matrículas." /><EnrollmentPermissionsPanel /></AppShell>;
}

export function EnrollmentPermissionsPanel() {
  const [items, setItems] = useState<PublicEnrollmentSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<PublicEnrollmentSubmission | null>(null);
  const [rejecting, setRejecting] = useState<PublicEnrollmentSubmission | null>(null);

  async function load() {
    setLoading(true);
    try {
      setItems(
        await apiRequest<PublicEnrollmentSubmission[]>(
          "/workspace/public-enrollment-form/submissions",
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar as solicitações.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const pending = useMemo(
    () => items.filter((item) => item.status === "PENDING"),
    [items],
  );
  async function approve(item: PublicEnrollmentSubmission) {
    setWorkingId(item.id);
    try {
      await apiRequest(`/workspace/public-enrollment-form/submissions/${item.id}/approve`, { method: "POST" });
      toast.success("Cadastro aprovado. O aluno e a matrícula foram criados.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível aprovar a solicitação.");
    } finally {
      setWorkingId(null);
    }
  }

  async function reject() {
    if (!rejecting) return;
    setWorkingId(rejecting.id);
    try {
      await apiRequest(`/workspace/public-enrollment-form/submissions/${rejecting.id}`, { method: "DELETE" });
      toast.success("Solicitação e foto excluídas definitivamente.");
      setRejecting(null);
      setViewing(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir a solicitação.");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <>
      <section className="space-y-3" aria-label="Solicitações de cadastro">
        {loading ? <p className="text-sm text-muted-foreground">Carregando solicitações…</p> : null}
        {!loading && pending.length === 0 ? <div className="card-surface p-6 text-sm text-muted-foreground">Nenhuma solicitação pendente.</div> : null}
        {pending.map((item) => (
          <article key={item.id} className="card-surface flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{item.student.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">Responsável: {item.guardian.name} · {documentLabel(item)}</p>
              <p className="mt-1 text-sm text-muted-foreground">{item.plan ? `${item.plan.name} · ${formatCents(item.plan.amountCents)}` : "Plano indisponível"} · enviado em {formatDateTime(item.createdAt)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-11" variant="outline" onClick={() => setViewing(item)}><Eye className="size-4" /> Ver dados</Button>
              <Button className="min-h-11" disabled={workingId === item.id} onClick={() => void approve(item)}><UserRoundCheck className="size-4" /> Aprovar</Button>
              <Button className="min-h-11" variant="destructive" disabled={workingId === item.id} onClick={() => setRejecting(item)}><Trash2 className="size-4" /> Recusar</Button>
            </div>
          </article>
        ))}
      </section>
      <Dialog open={Boolean(viewing)} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{viewing?.student.name}</DialogTitle><DialogDescription>Dados enviados pelo responsável.</DialogDescription></DialogHeader>
          {viewing ? <div className="space-y-3 text-sm"><p><strong>Documento:</strong> {documentLabel(viewing)}</p><p><strong>Responsável:</strong> {viewing.guardian.name} {viewing.guardian.phone ? `· ${viewing.guardian.phone}` : ""}</p><p><strong>Plano:</strong> {viewing.plan ? `${viewing.plan.name} · ${formatCents(viewing.plan.amountCents)}` : "Indisponível"}</p>{viewing.photo ? <a className="inline-flex min-h-11 items-center text-primary underline" href={`/api/v1/files/${viewing.photo.id}/content`} target="_blank" rel="noreferrer">Abrir foto do aluno</a> : null}</div> : null}
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(rejecting)} onOpenChange={(open) => !open && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Excluir solicitação definitivamente?</AlertDialogTitle><AlertDialogDescription>Ao confirmar, os dados preenchidos e a foto do aluno serão apagados de forma permanente. Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={workingId === rejecting?.id}>Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={workingId === rejecting?.id} onClick={(event) => { event.preventDefault(); void reject(); }}>Excluir definitivamente</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
