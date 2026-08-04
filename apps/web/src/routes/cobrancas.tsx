import { createFileRoute } from "@tanstack/react-router";
import { Download, ExternalLink, Link2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/api";
import { useDashboardData } from "@/lib/data";
import {
  formatCents,
  formatDateOnly,
  formatDateTime,
  formatReferenceMonth,
} from "@/lib/format";


export const Route = createFileRoute("/cobrancas")({
  head: () => ({
    meta: [
      { title: "Cobranças e pagamentos — Mensaly" },
      {
        name: "description",
        content:
          "Geração de cobranças por mês de referência, baixa de pagamentos e conciliação financeira da escola.",
      },
      { property: "og:title", content: "Cobranças e pagamentos — Mensaly" },
      {
        property: "og:description",
        content: "Cobranças por mês de referência e conciliação de pagamentos.",
      },
    ],
  }),
  component: ChargesPage,
});

function ChargesPage() {
  const { data, refresh } = useDashboardData();
  const { charges, payments, overview } = data;
  const [generatingCharges, setGeneratingCharges] = useState(false);
  const [creatingLinkId, setCreatingLinkId] = useState<string | null>(null);
  const [payingChargeId, setPayingChargeId] = useState<string | null>(null);
  const [selectedCharge, setSelectedCharge] = useState<
    (typeof charges)[number] | null
  >(null);

  async function generateMonthlyCharges() {
    if (generatingCharges) return;
    setGeneratingCharges(true);
    try {
      const result = await apiRequest<{ processed: number }>("/charges/generate", {
        method: "POST",
        body: { referenceMonth: data.referenceMonth },
      });
      await refresh();
      toast.success(
        result.processed === 1
          ? "1 cobrança processada."
          : `${result.processed} cobranças processadas.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar as cobranças do mês.",
      );
    } finally {
      setGeneratingCharges(false);
    }
  }

  async function registerPayment() {
    const charge = selectedCharge;
    if (!charge) return;
    if (payingChargeId) return;

    setPayingChargeId(charge.id);
    try {
      const payment = await apiRequest<{ id: string }>(`/charges/${charge.id}/payments`, {
        method: "POST",
        headers: {
          "Idempotency-Key": `manual:${charge.id}:${crypto.randomUUID()}`,
        },
        body: {
          amountCents: charge.finalAmountCents,
          method: "CASH",
          paidAt: new Date().toISOString(),
        },
      });
      await apiRequest(`/payments/${payment.id}/confirm`, { method: "POST" });
      await refresh();
      setSelectedCharge(null);
      toast.success("Pagamento confirmado.");
    } catch (error) {
      await refresh();
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível registrar o pagamento.",
      );
    } finally {
      setPayingChargeId(null);
    }
  }

  async function copyCheckoutLink(charge: (typeof charges)[number]) {
    if (creatingLinkId) return;
    setCreatingLinkId(charge.id);
    try {
      const { url } = await apiRequest<{ url: string }>(`/charges/${charge.id}/mercadopago-checkout-link`, {
        method: "POST",
      });
      await navigator.clipboard.writeText(url);
      toast.success("Link de pagamento copiado", { description: url });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar o checkout.");
    } finally {
      setCreatingLinkId(null);
    }
  }

  async function openCheckout() {
    const charge = charges.find((item) => item.status === "PENDING");
    if (!charge || creatingLinkId) {
      toast.error("Gere uma cobrança pendente antes de abrir o checkout.");
      return;
    }
    const checkoutWindow = window.open("about:blank", "_blank");
    if (checkoutWindow) checkoutWindow.opener = null;
    setCreatingLinkId(charge.id);
    try {
      const { url } = await apiRequest<{ url: string }>(`/charges/${charge.id}/mercadopago-checkout-link`, {
        method: "POST",
      });
      if (checkoutWindow) checkoutWindow.location.href = url;
      else window.location.href = url;
    } catch (error) {
      checkoutWindow?.close();
      toast.error(error instanceof Error ? error.message : "Não foi possível abrir o checkout.");
    } finally {
      setCreatingLinkId(null);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Cobranças e pagamentos"
        description={`Mês de referência ${formatReferenceMonth(data.referenceMonth)} · valores sempre em centavos inteiros.`}
        actions={
          <>
            <Button variant="outline" onClick={openCheckout} disabled={Boolean(creatingLinkId)}>
              <ExternalLink className="size-4" /> Abrir checkout
            </Button>
            <Button variant="outline">
              <Download className="size-4" /> Exportar
            </Button>
            <Button disabled={generatingCharges} onClick={generateMonthlyCharges}>
              <Plus className="size-4" /> Gerar cobranças do mês
            </Button>
          </>
        }

      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Faturado" value={formatCents(overview.monthlyBilledCents)} />
        <StatCard label="Recebido" value={formatCents(overview.monthlyReceivedCents)} />
        <StatCard label="Em aberto" value={formatCents(overview.openChargesCents)} />
        <StatCard
          label="Vencido"
          value={formatCents(overview.overdueChargesCents)}
          hint={`${overview.overdueChargesCount} cobranças`}
        />
      </section>

      <Tabs defaultValue="charges">
        <TabsList>
          <TabsTrigger value="charges">Cobranças</TabsTrigger>
          <TabsTrigger value="payments">Pagamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="charges" className="mt-4">
          <div className="card-surface overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Cobrança</th>
                  <th className="px-5 py-3 font-medium">Aluno</th>
                  <th className="px-5 py-3 font-medium">Referência</th>
                  <th className="px-5 py-3 font-medium">Vencimento</th>
                  <th className="px-5 py-3 font-medium">Desconto</th>
                  <th className="px-5 py-3 font-medium">Valor final</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {charges.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-sm text-muted-foreground">
                      Nenhuma cobrança gerada ainda.
                    </td>
                  </tr>
                ) : (
                  charges.map((charge) => (
                    <tr key={charge.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                        {charge.id.slice(0, 8)}
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-foreground">{charge.student}</p>
                        <p className="text-xs text-muted-foreground">{charge.plan}</p>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {formatReferenceMonth(charge.referenceMonth)}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{formatDateOnly(charge.dueDate)}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {charge.discountCents ? formatCents(charge.discountCents) : "—"}
                      </td>
                      <td className="px-5 py-3 font-medium text-foreground">
                        {formatCents(charge.finalAmountCents)}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={charge.status} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="mr-2"
                          onClick={() => copyCheckoutLink(charge)}
                          disabled={Boolean(creatingLinkId) || charge.status !== "PENDING"}
                        >
                          <Link2 className="size-4" /> Link de pagamento
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={payingChargeId === charge.id}
                          onClick={
                            charge.status === "PENDING"
                              ? () => setSelectedCharge(charge)
                              : undefined
                          }
                        >
                          {charge.status === "PENDING" ? "Registrar pagamento" : "Detalhes"}
                        </Button>
                      </td>

                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Cada baixa manual usa uma Idempotency-Key própria; em conflito (409) a cobrança é
            recarregada antes de nova ação.
          </p>
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <div className="card-surface overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Pagamento</th>
                  <th className="px-5 py-3 font-medium">Aluno</th>
                  <th className="px-5 py-3 font-medium">Método</th>
                  <th className="px-5 py-3 font-medium">Pago em</th>
                  <th className="px-5 py-3 font-medium">Idempotency-Key</th>
                  <th className="px-5 py-3 font-medium">Valor</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-muted-foreground">
                      Nenhum pagamento registrado ainda.
                    </td>
                  </tr>
                ) : (
                  payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                        {payment.id.slice(0, 8)}
                      </td>
                      <td className="px-5 py-3 font-medium text-foreground">{payment.student}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={payment.method} />
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {formatDateTime(payment.paidAt)}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                        {payment.idempotencyKey.slice(0, 12)}
                      </td>
                      <td className="px-5 py-3 font-medium text-foreground">
                        {formatCents(payment.amountCents)}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={payment.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={selectedCharge !== null}
        onOpenChange={(open) => !open && !payingChargeId && setSelectedCharge(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Validar pagamento em dinheiro</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedCharge
                ? `Confirmar o recebimento de ${formatCents(selectedCharge.finalAmountCents)} de ${selectedCharge.student}? A cobrança será marcada como paga.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={payingChargeId !== null}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={payingChargeId !== null}
              onClick={(event) => {
                event.preventDefault();
                void registerPayment();
              }}
            >
              {payingChargeId ? "Confirmando..." : "Confirmar pagamento"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
