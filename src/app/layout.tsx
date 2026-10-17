import type { Metadata } from "next";
// Open Sans selvhostet via npm (ingen Google Fonts-kald, GDPR). Kun de fire vægte fra designmanualen.
import "@fontsource/open-sans/latin-300.css";
import "@fontsource/open-sans/latin-400.css";
import "@fontsource/open-sans/latin-600.css";
import "@fontsource/open-sans/latin-700.css";
import "./globals.css";
import { connection } from "next/server";
import { FormGuard } from "@/components/form-guard";

export const metadata: Metadata = {
  title: { default: "Advisory Board Unlimited", template: "%s – Advisory Board Unlimited" },
  description: "Dit eget advisory board som abonnement. Faste møder med erfarne rådgivere – online, optaget og opsummeret.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // CSP-nonce pr. request kræver dynamisk rendering af alle sider (statiske sider ville mangle noncen på Next.js' scripts)
  await connection();
  return (
    <html lang="da">
      <body className="min-h-screen font-sans">
        <FormGuard />
        {children}
      </body>
    </html>
  );
}
