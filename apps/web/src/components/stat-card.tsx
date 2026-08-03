import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon,
  trend,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  trend?: { value: string; positive?: boolean };
}) {
  return (
    <div className="card-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {icon ? (
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      <div className="mt-1 flex items-center gap-2">
        {trend ? (
          <span
            className={cn(
              "text-xs font-medium",
              trend.positive === false ? "text-destructive" : "text-success",
            )}
          >
            {trend.value}
          </span>
        ) : null}
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
    </div>
  );
}
