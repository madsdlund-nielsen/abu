import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { NewAdvisorForm } from "@/components/admin/advisor-invite";

export const metadata: Metadata = { title: "Opret rådgiver" };

export default function NewAdvisor() {
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
