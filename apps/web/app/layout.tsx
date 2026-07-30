import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Providers } from "./providers";
import "../src/styles.css";

export const metadata: Metadata = {
  title: "Mensaly — Painel de mensalidades",
  description:
    "Painel Mensaly para escolas: mensalidades, matrículas, pagamentos e lembretes no WhatsApp.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
