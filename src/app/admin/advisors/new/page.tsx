import type { Metadata } from "next";
import { createAdvisorAction } from "@/app/actions/admin";
import { Flash, flashFrom, type SP } from "@/components/flash";

export const metadata: Metadata = { title: "Opret rådgiver" };

export default async function NewAdvisor({ searchParams }: { searchParams: SP }) {
  const { err } = await flashFrom(searchParams);
  return (
    <div className="max-w-xl">
      <h1>Opret rådgiver</h1>
      <p className="mt-2 text-sm text-slate-600">Rådgiveren får et invitationslink på e-mail og vælger selv sin adgangskode.</p>
      <div className="card mt-6">
        <Flash err={err} />
        <form action={createAdvisorAction} className="grid gap-4">
          <div>
            <label className="label" htmlFor="name">Navn</label>
            <input className="input" id="name" name="name" required />
          </div>
          <div>
            <label className="label" htmlFor="email">E-mail</label>
            <input className="input" id="email" name="email" type="email" required />
          </div>
          <div>
            <label className="label" htmlFor="title">Titel (valgfri)</label>
            <input className="input" id="title" name="title" />
          </div>
          <div><button className="btn" type="submit">Opret og send invitation</button></div>
        </form>
      </div>
    </div>
  );
}
