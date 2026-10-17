import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Advisory Board Unlimited", template: "%s – Advisory Board Unlimited" },
  description: "Din egen advisory board som abonnement. Faste møder med erfarne rådgivere – online, optaget og opsummeret.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
