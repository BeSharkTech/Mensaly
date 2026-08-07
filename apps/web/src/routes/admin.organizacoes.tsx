import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/admin/organizacoes")({ component: AdminUnavailable });

function AdminUnavailable() {
  const navigate = useNavigate();
  useEffect(() => navigate({ to: "/login", replace: true }), [navigate]);
  return null;
}
