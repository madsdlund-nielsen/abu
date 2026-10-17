"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="container-abu py-space-6">
      <h1>Noget gik galt</h1>
      <p className="mt-space-4 text-muted">Der opstod en uventet fejl. Prøv igen, og kontakt os, hvis fejlen bliver ved.</p>
      <button type="button" className="btn mt-space-4" onClick={() => reset()}>Prøv igen</button>
    </main>
  );
}
