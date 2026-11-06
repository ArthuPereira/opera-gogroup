import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Opera — Operações Gogroup",
  description: "Painel de gestão e resolução de exceções operacionais.",
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
