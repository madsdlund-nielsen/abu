import bcrypt from "bcryptjs";
import type { Role, Session, User } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "./db";
import { loginUrlFor, safeNextPath } from "./consent";
import { runAsPrincipal, setRequestPrincipal, withSystemContext, type Principal } from "./db-context";
import { cookieSecure } from "./env";
import { randomToken, sha256 } from "./tokens";

export const SESSION_COOKIE = "abu_session";
/** Samme navn som ONBOARDING_COOKIE i onboarding/session.ts (importeres ikke herfra for at undgå en cirkel). */
const ONBOARDING_COOKIE_NAME = "abu_onb";
const SESSION_DAYS = 14;
export { MIN_PASSWORD_LENGTH, REVERIFY_MESSAGE } from "./auth-constants";
import { MIN_PASSWORD_LENGTH as MIN_LEN, REVERIFY_MESSAGE } from "./auth-constants";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

let dummyHash: Promise<string> | null = null;

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  // Sammenlign altid (mod dummy-hash) for at undgå timing-forskelle på ukendte brugere
  dummyHash ??= bcrypt.hash("dummy-password", 12);
  const ok = await bcrypt.compare(password, hash ?? (await dummyHash));
  return ok && hash !== null;
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_LEN) return `Adgangskoden skal være mindst ${MIN_LEN} tegn.`;
  return null;
}

/**
 * Sessionens trin:
 *  - `full`: helt logget ind.
 *  - `mfa_verify`: adgangskoden er godkendt, men koden fra godkendelses-appen mangler.
 *  - `mfa_setup`: adgangskoden er godkendt, men brugeren skal opsætte totrinsbekræftelse (påkrævet for ADMIN).
 * Kun `full` giver adgang til appen; de andre når kun /mfa-siderne og log ud (håndhævet i requireUser/requireRole, så
 * også server actions og API-ruter afviser dem – ikke kun via omdirigeringer).
 */
export type SessionStage = "full" | "mfa_verify" | "mfa_setup";

/** En session, der venter på kode/opsætning, lever højst så længe. */
export const PENDING_SESSION_MINUTES = 15;
/** Følsomme admin-handlinger kræver en bekræftelse med kode inden for dette vindue. */
export const MFA_REVERIFY_WINDOW_MS = 15 * 60_000;

export interface SessionContext {
  session: Session;
  user: User;
  stage: SessionStage;
}

/** Ren funktion: hvilket trin er sessionen på? null = sessionen er ugyldig og skal slettes. */
export function sessionStage(session: Pick<Session, "mfaPending">, user: Pick<User, "role" | "mfaEnabledAt" | "deactivatedAt">): SessionStage | null {
  if (user.deactivatedAt) return null;
  if (session.mfaPending) {
    if (user.mfaEnabledAt) return "mfa_verify";
    if (user.role === "ADMIN") return "mfa_setup";
    return null; // totrinsbekræftelsen er slået fra, mens sessionen ventede: log ind igen
  }
  // Også ældre sessioner og admins, hvis totrinsbekræftelse er nulstillet: opsætning først
  if (user.role === "ADMIN" && !user.mfaEnabledAt) return "mfa_setup";
  return "full";
}

/** Er der bekræftet med kode inden for de seneste 15 minutter i denne session? (ren funktion) */
export function isMfaFresh(session: Pick<Session, "mfaVerifiedAt">, now = new Date(), windowMs = MFA_REVERIFY_WINDOW_MS): boolean {
  if (!session.mfaVerifiedAt) return false;
  const age = now.getTime() - session.mfaVerifiedAt.getTime();
  return age >= 0 && age <= windowMs;
}

export interface CreateSessionOptions {
  /** Adgangskoden er godkendt, men totrinsbekræftelsen mangler (kort levetid). */
  mfaPending?: boolean;
  /** Bekræftet med kode netop nu (åbner vinduet for følsomme handlinger). */
  mfaVerifiedAt?: Date | null;
  trustedDeviceId?: string | null;
}

/**
 * Opretter en ny session (nyt tilfældigt token). En evt. eksisterende session i cookien slettes først (rotation).
 * Auth-internt: rækken skrives i systemkontekst (der findes endnu ingen session at hænge rettigheden op på), og resten
 * af requesten kører derefter som den nye session (RLS-principalen opdateres).
 */
export async function createSession(userId: string, opts: CreateSessionOptions = {}) {
  const jar = await cookies();
  const old = jar.get(SESSION_COOKIE)?.value;
  const token = randomToken();
  const id = sha256(token);
  const expiresAt = new Date(Date.now() + (opts.mfaPending ? PENDING_SESSION_MINUTES * 60_000 : SESSION_DAYS * 86_400_000));
  const role = await withSystemContext("auth.create_session", async () => {
    if (old) await prisma.session.deleteMany({ where: { id: sha256(old) } });
    await prisma.session.create({
      data: {
        id,
        userId,
        expiresAt,
        mfaPending: opts.mfaPending ?? false,
        mfaVerifiedAt: opts.mfaVerifiedAt ?? null,
        trustedDeviceId: opts.trustedDeviceId ?? null,
      },
      select: { id: true },
    });
    return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } })).role;
  });
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  const onboardingToken = onboardingTokenFrom(jar);
  setRequestPrincipal(opts.mfaPending ? anonPrincipal(id, onboardingToken) : { userId, role, sessionId: id, onboardingToken });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: sha256(token) } });
  jar.delete(SESSION_COOKIE);
  setRequestPrincipal(anonPrincipal(null, onboardingTokenFrom(jar)));
}

// --------------------------------------------------------------------------------------------- RLS-principal

type CookieReader = { get(name: string): { value: string } | undefined };

function onboardingTokenFrom(jar: CookieReader): string | null {
  const v = jar.get(ONBOARDING_COOKIE_NAME)?.value;
  return v ? sha256(v) : null;
}

function anonPrincipal(sessionId: string | null, onboardingToken: string | null): Principal {
  return { userId: null, role: "anon", sessionId, onboardingToken };
}

/**
 * Principalen for en session (RLS): kun et helt login (`full`) giver brugerens rolle. En MFA-ventende session er `anon`
 * med sessionens id – den kan læse sin egen session og bruger, men intet andet (som appen: kun /mfa-siderne og log ud).
 */
export function principalForSession(ctx: Pick<SessionContext, "session" | "user" | "stage"> | null, onboardingToken: string | null = null): Principal {
  if (!ctx) return anonPrincipal(null, onboardingToken);
  if (ctx.stage !== "full") return anonPrincipal(ctx.session.id, onboardingToken);
  return { userId: ctx.user.id, role: ctx.user.role, sessionId: ctx.session.id, onboardingToken };
}

/**
 * Request-principalen til db-context.ts: den indloggede bruger, ellers `anon`. null uden for en request (fx et script),
 * så forespørgsler uden eksplicit kontekst afvises. Resultatet huskes pr. request (setRequestPrincipal i getSessionContext).
 */
export async function requestPrincipal(): Promise<Principal | null> {
  let jar: CookieReader;
  try {
    jar = await cookies();
  } catch {
    return null;
  }
  return principalForSession(await getSessionContext(), onboardingTokenFrom(jar));
}

/**
 * Session + bruger + trin for den aktuelle request (alle trin). Udløbne, deaktiverede og ugyldige sessioner slettes.
 * Det ene centrale sted, hvor RLS-principalen for requesten sættes (`setRequestPrincipal`). Selve opslaget kører som
 * `anon` med sessionens id (cookiens SHA-256): politikkerne giver kun adgang til netop den session og dens bruger.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const jar = await cookies();
  const onboardingToken = onboardingTokenFrom(jar);
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    setRequestPrincipal(anonPrincipal(null, onboardingToken));
    return null;
  }
  const lookup = anonPrincipal(sha256(token), onboardingToken);
  const ctx = await runAsPrincipal(lookup, async (): Promise<SessionContext | null> => {
    const session = await prisma.session.findUnique({ where: { id: lookup.sessionId! }, include: { user: true } });
    if (!session) return null;
    const { user, ...bare } = session;
    const stage = sessionStage(bare, user);
    if (session.expiresAt < new Date() || stage === null) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      return null;
    }
    return { session: bare, user, stage };
  });
  setRequestPrincipal(principalForSession(ctx, onboardingToken));
  return ctx;
});

/** Den helt indloggede bruger – null, hvis der ikke er en session, eller totrinsbekræftelsen mangler. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const ctx = await getSessionContext();
  return ctx?.stage === "full" ? ctx.user : null;
});

/** Hvor en session på et ufuldstændigt trin skal hen (med "næste"-sti). */
export function mfaPathFor(stage: Exclude<SessionStage, "full">, next?: string | null): string {
  const safe = safeNextPath(next);
  const base = stage === "mfa_verify" ? "/mfa" : "/mfa/opsaet";
  return safe && !safe.startsWith("/mfa") ? `${base}?next=${encodeURIComponent(safe)}` : base;
}

export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  const path = (await headers()).get("x-abu-path");
  if (!ctx) redirect(loginUrlFor(path));
  if (ctx.stage !== "full") redirect(mfaPathFor(ctx.stage, path));
  return ctx;
}

export async function requireUser(): Promise<User> {
  return (await requireSession()).user;
}

export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}

/**
 * Følsomme admin-handlinger (invitere/deaktivere administratorer, nulstille MFA, notifikationsindstillinger, sletning
 * af konti, udligning af ansvarlige …): kræver en bekræftelse med kode i denne session inden for 15 minutter. Ellers
 * sendes brugeren til /mfa/bekraeft og derefter tilbage til `back`.
 */
export async function requireFreshMfa(back: string, roles: Role[] = ["ADMIN"]): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!roles.includes(ctx.user.role)) redirect("/dashboard");
  if (!ctx.user.mfaEnabledAt) redirect(mfaPathFor("mfa_setup", back));
  if (!isMfaFresh(ctx.session)) redirect(`/mfa/bekraeft?next=${encodeURIComponent(safeNextPath(back) ?? "/admin")}`);
  return ctx;
}

/** Til handlinger, der svarer med et resultat i stedet for at omdirigere (fx CMS-indstillinger). */
export async function freshMfaProblem(roles: Role[] = ["ADMIN"]): Promise<{ user: User; problem: string | null }> {
  const ctx = await requireSession();
  if (!roles.includes(ctx.user.role)) redirect("/dashboard");
  const ok = Boolean(ctx.user.mfaEnabledAt) && isMfaFresh(ctx.session);
  return { user: ctx.user, problem: ok ? null : REVERIFY_MESSAGE };
}

// --- Password tokens (invite / reset) ---
export async function createPasswordToken(userId: string, purpose: "INVITE" | "RESET") {
  const token = randomToken();
  const days = purpose === "INVITE" ? 7 : 0;
  const expiresAt = new Date(Date.now() + (days ? days * 86_400_000 : 2 * 3_600_000));
  await prisma.passwordToken.create({ data: { userId, tokenHash: sha256(token), purpose, expiresAt } });
  return { token, expiresAt };
}

/** Auth-internt: et link i en mail slås op på tokenets hash, før der findes en session (systemkontekst). */
export async function findValidPasswordToken(token: string) {
  const row = await withSystemContext("auth.password_token", () => prisma.passwordToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } }));
  if (!row || row.usedAt || row.expiresAt < new Date() || row.user.deactivatedAt) return null;
  return row;
}
