import type { Metadata } from "next";
// Open Sans selvhostet via npm (ingen Google Fonts-kald, GDPR). Kun de fire vægte fra designmanualen.
import "@fontsource/open-sans/latin-300.css";
import "@fontsource/open-sans/latin-400.css";
import "@fontsource/open-sans/latin-600.css";
import "@fontsource/open-sans/latin-700.css";
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
