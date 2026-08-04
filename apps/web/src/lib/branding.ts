/**
 * Aplica a cor de destaque escolhida pelo negócio nos tokens do design system.
 */
import { useEffect } from "react";

export const DEFAULT_BRAND_COLOR = "#3B4DF6";

export const brandPresets = [
  { label: "Azul royal", value: "#3B4DF6" },
  { label: "Verde", value: "#12A150" },
  { label: "Turquesa", value: "#0E9AA7" },
  { label: "Roxo", value: "#7C3AED" },
  { label: "Rosa", value: "#DB2777" },
  { label: "Laranja", value: "#EA580C" },
  { label: "Vermelho", value: "#DC2626" },
  { label: "Grafite", value: "#334155" },
];

export function isValidHexColor(value: string) {
  return /^#([0-9a-f]{6})$/i.test(value.trim());
}

function relativeLuminance(hex: string) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function applyBrandColor(color: string | null | undefined) {
  if (typeof document === "undefined") return;
  const hex = color && isValidHexColor(color) ? color.trim() : DEFAULT_BRAND_COLOR;
  const root = document.documentElement;
  const foreground = relativeLuminance(hex) > 0.55 ? "oklch(0.18 0.02 265)" : "oklch(0.99 0 0)";

  root.style.setProperty("--primary", hex);
  root.style.setProperty("--primary-foreground", foreground);
  root.style.setProperty("--primary-soft", `color-mix(in oklab, ${hex} 14%, var(--background))`);
  root.style.setProperty("--primary-soft-foreground", hex);
  root.style.setProperty("--ring", hex);
  root.style.setProperty("--sidebar-primary", hex);
  root.style.setProperty("--sidebar-primary-foreground", foreground);
  root.style.setProperty("--sidebar-ring", hex);
  root.style.setProperty("--chart-1", hex);
}

export function useBrandColor(color: string | null | undefined) {
  useEffect(() => {
    applyBrandColor(color);
  }, [color]);
}
