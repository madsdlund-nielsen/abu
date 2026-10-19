import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { NewAdvisorForm } from "@/components/admin/advisor-invite";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Opret rådgiver" };

export default async function NewAdvisor() {
  // Hver admin-side kræver selv ADMIN (N-1): layout og side renderes parallelt, så layoutets tjek alene beskytter ikke sidens forespørgsler
  await requireRole("ADMIN");
  return (
    <div className="max-w-xl">
      <h1>Opret rådgiver</h1>
      <p className="mt-2 text-sm text-muted">
        Rådgiveren får et invitationslink på e-mail og vælger selv sin adgangskode. Nye rådgivere er inaktive, indtil du aktiverer dem.
      </p>
      <div className="card mt-6">
        <NewAdvisorForm idem={randomUUID()} />
      </div>
    </div>
  );
}
