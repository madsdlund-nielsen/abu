import Link from "next/link";
import { parseRich } from "@/lib/content/onboarding-texts";

/** Viser letvægts-markdown (**fed**, [tekst](sti)) som React-elementer. Ingen rå HTML. */
export function Rich({ text, linkTarget }: { text: string; linkTarget?: "_blank" }) {
  return (
    <>
      {parseRich(text).map((n, i) =>
        n.type === "bold" ? (
          <strong key={i} className="font-semibold text-navy">{n.text}</strong>
        ) : n.type === "link" ? (
          n.href.startsWith("/") ? (
            <Link key={i} href={n.href} target={linkTarget}>{n.text}</Link>
          ) : (
            <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">{n.text}</a>
          )
        ) : (
          <span key={i}>{n.text}</span>
        ),
      )}
    </>
  );
}
