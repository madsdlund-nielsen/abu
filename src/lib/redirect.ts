import { redirect } from "next/navigation";

/** Tilføjer ?ok=/?err= før et evt. #anker (ellers ville beskeden havne i ankeret og ikke blive vist). */
export function withFlash(path: string, kind: "ok" | "err", message: string): string {
  const [base, hash] = path.split("#", 2);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${kind}=${encodeURIComponent(message)}${hash !== undefined ? `#${hash}` : ""}`;
}

export function redirectWith(path: string, kind: "ok" | "err", message: string): never {
  redirect(withFlash(path, kind, message));
}
