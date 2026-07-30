import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  
  ClipboardList,
  Receipt,
  MessageSquare,
  Building2,
  ShieldCheck,
  Webhook,
  AlertTriangle,
  Menu,
  X,
  LogOut,
  Settings,
  GraduationCap,
  ListPlus,
  Package,
  Megaphone,
  CalendarDays,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { StatusBadge } from "@/components/status-badge";
import { initials, signOut, useAppState } from "@/lib/store";
import { useBrandColor } from "@/lib/branding";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; icon: typeof Users };

const clientNav: { group: string; items: NavItem[] }[] = [
  {
    group: "Visão geral",
    items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    group: "Operações",
    items: [
      { to: "/alunos", label: "Alunos", icon: GraduationCap },
      { to: "/dados-adicionais", label: "Dados adicionais", icon: ListPlus },
      { to: "/planos", label: "Planos", icon: ClipboardList },
      { to: "/estoque", label: "Estoque", icon: Package },
      { to: "/eventos", label: "Eventos", icon: CalendarDays },

      
    ],
  },
  {
    group: "Financeiro",
    items: [{ to: "/cobrancas", label: "Cobranças e pagamentos", icon: Receipt }],
  },
  {
    group: "Comunicação",
    items: [
      { to: "/mensagens", label: "Mensagens", icon: MessageSquare },
      { to: "/envio", label: "Envio", icon: Megaphone },
    ],
  },
  {
    group: "Conta",
    items: [
      { to: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

const adminNav: { group: string; items: NavItem[] }[] = [
  {
    group: "Plataforma",
    items: [
      { to: "/admin", label: "Visão geral", icon: ShieldCheck },
      { to: "/admin/organizacoes", label: "Organizações", icon: Building2 },
      { to: "/admin/webhooks", label: "Webhooks", icon: Webhook },
      { to: "/admin/falhas", label: "Falhas", icon: AlertTriangle },
    ],
  },
];

export function AppShell({
  variant = "client",
  children,
}: {
  variant?: "client" | "admin";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const nav = variant === "admin" ? adminNav : clientNav;
  const navigate = useNavigate();
  const { state, hydrated } = useAppState();

  useEffect(() => {
    if (!hydrated) return;
    if (!state.account || !state.session) {
      navigate({ to: "/login" });
      return;
    }
    if (!state.onboardingComplete) navigate({ to: "/onboarding" });
  }, [hydrated, state.account, state.session, state.onboardingComplete, navigate]);

  const userName = state.account?.name ?? "";
  const userInitials = state.account ? initials(state.account.name) : "";
  const businessName = state.business?.name ?? "";
  const businessLogo = state.business?.logoDataUrl ?? null;
  useBrandColor(state.business?.brandColor);

  if (!hydrated || !state.account || !state.session || !state.onboardingComplete) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            {businessLogo ? (
              <img
                src={businessLogo}
                alt={businessName}
                className="size-7 shrink-0 rounded-md object-contain"
              />
            ) : (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                {initials(businessName || "N")}
              </span>
            )}
            <span className="truncate text-sm font-semibold text-foreground">
              {variant === "admin" ? "Plataforma" : businessName}
            </span>
          </Link>
          <button
            type="button"
            className="text-muted-foreground lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {nav.map((section) => (
            <div key={section.group} className="space-y-1">
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {section.group}
              </p>
              {section.items.map((item) => {
                const active =
                  item.to === "/" || item.to === "/admin"
                    ? pathname === item.to
                    : pathname.startsWith(item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <button
            type="button"
            onClick={() => {
              signOut();
              navigate({ to: "/login" });
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
          >
            <LogOut className="size-4" /> Sair
          </button>
        </div>
      </aside>

      {open ? (
        <div
          className="fixed inset-0 z-40 bg-foreground/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="text-muted-foreground lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu className="size-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {variant === "admin" ? "Plataforma" : businessName}
              </p>
              <p className="text-xs text-muted-foreground">
                {variant === "admin"
                  ? "PLATFORM_ADMIN"
                  : (state.business?.segment ?? "Fuso: America/Sao_Paulo")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {userInitials}
              </span>
              <span className="hidden text-sm font-medium text-foreground sm:inline">
                {userName}
              </span>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
