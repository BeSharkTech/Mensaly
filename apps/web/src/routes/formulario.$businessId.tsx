import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/formulario/$businessId")({
  head: () => ({
    meta: [
      { title: "Formulário substituído — Mensaly" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RetiredPublicForm,
});

function RetiredPublicForm() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">
          Este formulário foi substituído
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Solicite ao local o novo link seguro de cadastro do aluno.
        </p>
      </div>
    </main>
  );
}
