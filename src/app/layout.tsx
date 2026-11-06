import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Opera Gogroup — Central AI-First de Exceções Operacionais",
  description:
    "Plataforma IPA de Triagem Determinística, Priorização Financeira por Carteira (Top 150) e Agente Operacional Groq para Gocase e GoBeauté.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
