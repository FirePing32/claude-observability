import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Observability",
  description: "Where your Claude subscription's usage goes: sessions, models, 5-hour limits and API-equivalent value.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
