import Link from "next/link";
import { Band } from "@/components/band";
import { PageShell } from "@/components/site-header";

export const metadata = { title: "Siden findes ikke" };

export default function NotFound() {
  return (
    <PageShell variant="bare">
      <Band tone="grey" tight className="min-h-[60vh]">
        <div className="mx-auto max-w-xl pt-space-4">
          <span className="eyebrow">404</span>
          <h1>Siden findes ikke</h1>
          <p className="mt-space-4 text-muted">Linket er forkert, eller siden er flyttet. Tjek adressen, eller gå tilbage til forsiden.</p>
          <p className="mt-space-4"><Link href="/" className="btn">Til forsiden</Link></p>
        </div>
      </Band>
    </PageShell>
  );
}
