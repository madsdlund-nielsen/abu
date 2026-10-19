"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { getSessionContext, isMfaFresh, requireSession, type SessionContext } from "@/lib/auth";
import { getClientIp } from "@/lib/client-ip";
import { safeNextPath } from "@/lib/consent";
import { prisma } from "@/lib/db";
import { withSystemContext } from "@/lib/db-context";
import type { FormState } from "@/lib/form-state";
import { confirmEnrollment, disableMfa, regenerateRecoveryCodes, revokeTrustedDevice, revokeTrustedDevices, verifySecondFactor } from "@/lib/mfa/service";
import { DEVICE_COOKIE } from "@/lib/mfa/trusted-device";
import { redirectWith } from "@/lib/redirect";
import { sha256 } from "@/lib/tokens";
import { clearDeviceCookie, completeSecondFactor, landingPath } from "@/lib/sign-in";

/** Resultat med engangsvisning af gendannelseskoder (vises kun i dette svar, aldrig gemt i klartekst). */
export interface MfaCodesState extends FormState {
  codes?: string[];
  /** Hvor «Jeg har gemt dem» fører hen */
  continueTo?: string;
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function sessionOn(...stages: SessionContext["stage"][]): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!stages.includes(ctx.stage)) redirect(ctx.stage === "full" ? landingPath(ctx.user, null) : ctx.stage === "mfa_verify" ? "/mfa" : "/mfa/opsaet");
  return ctx;
}

/** Login, trin 2: kode fra appen eller en gendannelseskode. Valgfrit «Husk denne enhed». Sessionen roteres. */
export async function verifyMfaLoginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await sessionOn("mfa_verify");
  const mode = str(formData, "mode") === "recovery" ? "recovery" : "totp";
  const r = await verifySecondFactor(
    ctx.user.id,
    mode === "recovery" ? { recoveryCode: str(formData, "recoveryCode") } : { code: str(formData, "code") },
    { ip: await getClientIp(), purpose: "login" },
  );
  if (!r.ok) return { error: r.error, values: { mode }, at: Date.now() };
  await completeSecondFactor(ctx, { trustDevice: formData.get("remember") === "on" });
  const next = safeNextPath(str(formData, "next"));
  if (r.method === "recovery") {
    // Mind brugeren om, at koden nu er brugt (og hvor mange der er tilbage)
    redirectWith("/account#totrin", "ok", `Gendannelseskoden er brugt og virker ikke igen. Du har ${r.remainingRecoveryCodes} tilbage.`);
  }
  redirect(landingPath(ctx.user, next));
}

/**
 * Opsætning: bekræft med en kode fra appen. Først nu slås totrinsbekræftelse til, og sessionen markeres som bekræftet.
 * Svaret indeholder de 10 gendannelseskoder (én gang). Sessionen roteres først i `finishMfaSetupAction` («Jeg har gemt
 * dem»): et cookie-skift her ville gen-rendere siden og fjerne koderne fra skærmen, før de er gemt.
 */
export async function confirmMfaSetupAction(_prev: MfaCodesState, formData: FormData): Promise<MfaCodesState> {
  const ctx = await sessionOn("mfa_setup", "full");
  if (ctx.user.mfaEnabledAt) redirect("/account#totrin");
  const r = await confirmEnrollment(ctx.user.id, str(formData, "code"), await getClientIp());
  if (!r.ok) return { error: r.error, at: Date.now() };
  // Auth-internt (RLS): sessioner skrives kun i systemkontekst
  await withSystemContext("auth.mfa_enrollment", () => prisma.session.update({ where: { id: ctx.session.id }, data: { mfaVerifiedAt: new Date() }, select: { id: true } }));
  return { ok: "Totrinsbekræftelse er slået til.", codes: r.codes, at: Date.now() };
}

/**
 * «Jeg har gemt dem»: afslutter opsætningen. Kun en session, der netop har bekræftet opsætningen med en gyldig kode
 * (bekræftet ≤ 15 min), kan komme videre her; sessionen roteres (nyt token) og er derefter fuldt logget ind.
 */
export async function finishMfaSetupAction(formData: FormData) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.user.mfaEnabledAt || !isMfaFresh(ctx.session) || ctx.stage === "mfa_setup") redirect(ctx.stage === "full" ? "/account#totrin" : "/mfa");
  await completeSecondFactor(ctx);
  const next = safeNextPath(str(formData, "next"));
  redirect(ctx.stage === "full" ? (next ?? "/account#totrin") : landingPath(ctx.user, next));
}

/** Bekræft med kode igen (følsomme admin-handlinger kræver højst 15 minutter gammel bekræftelse). */
export async function reverifyMfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireSession();
  if (!ctx.user.mfaEnabledAt) redirect("/mfa/opsaet");
  const r = await verifySecondFactor(ctx.user.id, { code: str(formData, "code") }, { ip: await getClientIp(), purpose: "reverify", allowRecovery: false });
  if (!r.ok) return { error: r.error, at: Date.now() };
  await completeSecondFactor(ctx);
  await audit(ctx.user.id, "auth.mfa_reverified", "User", ctx.user.id);
  redirect(safeNextPath(str(formData, "next")) ?? (ctx.user.role === "ADMIN" ? "/admin" : "/account"));
}

/** Nye gendannelseskoder (kræver en aktuel kode). */
export async function regenerateRecoveryCodesAction(_prev: MfaCodesState, formData: FormData): Promise<MfaCodesState> {
  const ctx = await requireSession();
  const r = await regenerateRecoveryCodes(ctx.user.id, str(formData, "code"), await getClientIp());
  if (!r.ok) return { error: r.error, at: Date.now() };
  return { ok: "Nye gendannelseskoder er lavet. De gamle virker ikke længere.", codes: r.codes, continueTo: "/account#totrin", at: Date.now() };
}

/** Slå valgfri totrinsbekræftelse fra (rådgiver/kunde). Betroede enheder og gendannelseskoder fjernes. */
export async function disableMfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireSession();
  const code = str(formData, "code");
  const r = await disableMfa(ctx.user, /^\d[\d\s]*$/.test(code) ? { code } : { recoveryCode: code }, await getClientIp());
  if (!r.ok) return { error: r.error, at: Date.now() };
  await clearDeviceCookie();
  redirectWith("/account#totrin", "ok", "Totrinsbekræftelse er slået fra.");
}

/** Fjern én betroet enhed (koden kræves igen ved næste login fra den). */
export async function revokeTrustedDeviceAction(formData: FormData) {
  const ctx = await requireSession();
  const id = str(formData, "deviceId");
  const device = await prisma.trustedDevice.findFirst({ where: { id, userId: ctx.user.id } });
  if (!device || !(await revokeTrustedDevice(ctx.user.id, id))) redirectWith("/account#enheder", "err", "Enheden findes ikke.");
  const mine = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (mine && sha256(mine) === device.tokenHash) await clearDeviceCookie();
  redirectWith("/account#enheder", "ok", `«${device.label}» er fjernet. Koden kræves igen ved næste login fra den enhed.`);
}

export async function revokeAllTrustedDevicesAction() {
  const ctx = await requireSession();
  const n = await revokeTrustedDevices(ctx.user.id, "user");
  await clearDeviceCookie();
  redirectWith("/account#enheder", "ok", n ? `${n} betroede ${n === 1 ? "enhed er" : "enheder er"} fjernet.` : "Der var ingen betroede enheder.");
}
