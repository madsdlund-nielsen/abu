import { headers } from "next/headers";
import { getEnv } from "./env";

/** Bruges, når klient-IP ikke kan afgøres sikkert (ingen betroet proxy). Alle sådanne kald deler én nøgle. */
export const UNKNOWN_IP = "ukendt";

/**
 * Klient-IP fra X-Forwarded-For ud fra antallet af betroede proxies (H-2). Hver proxy tilføjer den adresse, den modtog
 * forbindelsen fra, til højre i listen; alt til venstre for den yderste betroede proxy kan klienten selv have skrevet.
 * Derfor tages posten `hops` fra højre – aldrig den første. Med 0 hops ignoreres headeren.
 */
export function clientIpFrom(xff: string | null | undefined, hops: number): string {
  if (hops < 1 || !xff) return UNKNOWN_IP;
  const list = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length < hops) return UNKNOWN_IP;
  const ip = list[list.length - hops];
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : UNKNOWN_IP;
}

export async function getClientIp(): Promise<string> {
  const h = await headers();
  return clientIpFrom(h.get("x-forwarded-for"), getEnv().TRUSTED_PROXY_HOPS);
}
