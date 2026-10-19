/**
 * Til tests af server actions og sessioner uden for Next: en cookie-krukke og request-headers, der kan bruges som
 * `vi.mock("next/headers", () => nextHeadersMock)`. Cookies, som koden sætter (session, betroet enhed), kan læses bagefter.
 */
export const cookieJar = new Map<string, string>();
export const requestHeaders = new Map<string, string>([
  ["user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"],
]);

const jar = {
  get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
  set: (name: string, value: string) => {
    cookieJar.set(name, value);
  },
  delete: (name: string) => {
    cookieJar.delete(name);
  },
  has: (name: string) => cookieJar.has(name),
};

export const nextHeadersMock = {
  cookies: async () => jar,
  headers: async () => new Headers([...requestHeaders.entries()]),
};

/** Kører en server action og returnerer målet, hvis den omdirigerer (redirect() kaster NEXT_REDIRECT), ellers null. */
export async function redirectOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const digest = (e as { digest?: string })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw e;
  }
}

export const formData = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
