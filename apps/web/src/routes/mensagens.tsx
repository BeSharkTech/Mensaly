import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  CheckCheck,
  Paperclip,
  Phone,
  Search,
  Send,
  Smile,
  Video,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { useDashboardData, type Student } from "@/lib/data";
import { initials } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/mensagens")({
  head: () => ({
    meta: [
      { title: "Mensagens — Mensaly" },
      {
        name: "description",
        content:
          "Gerenciador de conversas de WhatsApp com os alunos cadastrados: histórico, status de leitura e respostas.",
      },
      { property: "og:title", content: "Mensagens — Mensaly" },
      {
        property: "og:description",
        content:
          "Converse com os responsáveis dos alunos direto pelo painel Mensaly.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MessagesPage,
});

type ChatMessage = {
  id: string;
  from: "them" | "me";
  text: string;
  time: string;
  read?: boolean;
};

const conversationSeeds: string[][] = [
  [
    "Oi! Bom dia 😊",
    "Bom dia! Tudo bem? A mensalidade deste mês já está disponível para pagamento.",
    "Perfeito, consigo pagar hoje à tarde.",
    "Combinado! Assim que o pagamento cair eu confirmo por aqui.",
  ],
  [
    "Boa tarde, o treino de amanhã está mantido?",
    "Boa tarde! Sim, mantido no horário de sempre.",
    "Ótimo, obrigado!",
  ],
  [
    "Recebi o lembrete da mensalidade, obrigado!",
    "Que bom! Qualquer dúvida é só chamar por aqui.",
  ],
  [
    "Consigo trocar a forma de pagamento para Pix?",
    "Claro, envio o link atualizado ainda hoje.",
    "Show, fico no aguardo 👍",
  ],
];

function buildConversation(student: Student, index: number): ChatMessage[] {
  const seed = conversationSeeds[index % conversationSeeds.length];
  const baseHour = 8 + (index % 6);
  return seed.map((text, i) => ({
    id: `${student.id}-${i}`,
    from: i % 2 === 0 ? "them" : "me",
    text,
    time: `${String(baseHour + Math.floor(i / 2)).padStart(2, "0")}:${String((i * 17) % 60).padStart(2, "0")}`,
    read: i % 3 !== 0,
  }));
}

function MessagesPage() {
  const { data } = useDashboardData();
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const chats = useMemo(
    () =>
      data.students.map((student, index) => ({
        student,
        messages: buildConversation(student, index),
        unread: index % 4 === 0 ? (index % 3) + 1 : 0,
      })),
    [data.students],
  );

  const filtered = chats.filter((chat) =>
    chat.student.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const active =
    chats.find((chat) => chat.student.id === activeId) ?? filtered[0] ?? null;

  return (
    <AppShell>
      <PageHeader
        title="Mensagens"
        description="Gerenciador de conversas de WhatsApp com os alunos cadastrados (simulação)."
      />

      <div className="card-surface grid h-[calc(100vh-16rem)] min-h-[520px] grid-cols-1 overflow-hidden md:grid-cols-[320px_1fr]">
        {/* Lista de conversas */}
        <aside className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar aluno"
                className="pl-9"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nenhum aluno cadastrado ainda.
              </p>
            ) : (
              filtered.map((chat) => {
                const last = chat.messages[chat.messages.length - 1];
                const isActive = active?.student.id === chat.student.id;
                return (
                  <button
                    key={chat.student.id}
                    type="button"
                    onClick={() => setActiveId(chat.student.id)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors",
                      isActive ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {initials(chat.student.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {chat.student.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {last?.time}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">
                          {last?.text}
                        </span>
                        {chat.unread > 0 ? (
                          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                            {chat.unread}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Conversa */}
        <section className="flex min-h-0 flex-col">
          {active ? (
            <>
              <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {initials(active.student.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {active.student.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {active.student.guardian ||
                        active.student.plan ||
                        "Responsável"}{" "}
                      · online
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Video className="size-4" />
                  <Phone className="size-4" />
                </div>
              </header>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/40 p-4">
                <p className="mx-auto w-fit rounded-full bg-background px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
                  Hoje
                </p>
                {active.messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex",
                      message.from === "me" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                        message.from === "me"
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm bg-background text-foreground",
                      )}
                    >
                      <p className="whitespace-pre-wrap">{message.text}</p>
                      <span
                        className={cn(
                          "mt-1 flex items-center justify-end gap-1 text-[10px]",
                          message.from === "me"
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground",
                        )}
                      >
                        {message.time}
                        {message.from === "me" ? (
                          message.read ? (
                            <CheckCheck className="size-3" />
                          ) : (
                            <Check className="size-3" />
                          )
                        ) : null}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <footer className="flex items-center gap-2 border-t border-border p-3">
                <Smile className="size-5 shrink-0 text-muted-foreground" />
                <Paperclip className="size-5 shrink-0 text-muted-foreground" />
                <Input
                  placeholder="Digite uma mensagem"
                  disabled
                  className="flex-1"
                />
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Send className="size-4" />
                </span>
              </footer>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
              Cadastre alunos para começar a conversar.
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
