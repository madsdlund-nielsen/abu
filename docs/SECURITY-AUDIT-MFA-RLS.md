# Security review — ABU: Platform admins + MFA, DB roles (Phase 0), RLS (Phases 1–3)

**Scope:** `/home/user/abu`, everything since `c36eb80` (`git log/diff c36eb80..HEAD`): the MFA/admin feature
(`711bdaf`…`192f148`, `963c15f`, `46eb48c`), DB roles Phase 0 (`cd9164d`, `6483471`, `3e2d91b`), and RLS Phases 1–3
(`6300bc0`, `92a4acb`, `df52a23`, `cbbe909`). Prior context read: `docs/SECURITY-AUDIT.md`,
`docs/SECURITY-AUDIT-DELTA.md` (incl. remediation + "Part B — RLS Phases 1–3"), README «Database og roller», «Row-Level
Security», «Totrinsbekræftelse».
**Method:** full static review of the diff; dynamic verification against a dedicated build of a repo copy
(`scratchpad/sec-app3`, node_modules copied) on **PORT=3106**, `APP_ENV=development`, connected as **abu_app** to a fresh
**abu_sec3** provisioned via `npm run db:roles` → `prisma migrate deploy` (abu_owner) → seed. Adversarial psql as `abu_app`
forging every principal against hand-made cross-tenant fixtures (customer A/B, shared + inactive advisors, victim
lead/consent/onboarding, sessions in every MFA stage); HTTP probes with `curl` against localhost; `npm audit --omit=dev`.
**READ-ONLY on `/home/user/abu`** — nothing in the repo was modified; all mutation happened in `scratchpad/` and the
throwaway `abu_sec3` DB. Postgres 16 left running.
**Date:** 2026-10-18.

## Severity summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | |
| High | 0 | |
| Medium | 1 | M-1 |
| Low | 4 | M-2, R-1, R-2, R-3 |
| Info | 2 | R-4, N-1 |

The tenant-isolation goal holds under adversarial testing: **every** cross-tenant read and write attempted as a CUSTOMER,
ADVISOR, or anon principal failed closed on every sensitive table (meetings, transcripts, recordings, subscriptions,
CustomerProfile, NotificationLog, Lead/MarketingConsent, User, sessions, tokens, admin tags, system tables). MFA
primitives, session staging, the fresh-MFA gate, the DB role/privilege split and the startup guard are sound. The one
Medium is an anonymous cross-subject takeover of *onboarding-lead/marketing-consent* records (limited-sensitivity PII, but
reachable without login and broader than the implementer acknowledged). The Lows/Infos are defense-in-depth gaps.

---

## Findings

### M-1 — Anonymous cross-subject onboarding-lead / marketing-consent takeover via `rls.capture_onboarding_lead` (Medium)
**Files:** `prisma/migrations/20261020090000_rls_policies/migration.sql` (`rls.capture_onboarding_lead`, lines ~251-270;
`lead_select/lead_update/lead_delete`, `marketing_consent_*` policies ~481-514); `src/lib/leads.ts` (`upsertLead`);
`src/app/actions/onboarding.ts` (`saveContactAction` → `upsertLead`); `src/lib/onboarding/session.ts`
(`updateOnboardingSession` updates `lead.phone`/`step`).
**Severity rationale:** anonymously reachable over HTTP, touches another data subject's personal data (name, phone,
marketing-consent record incl. IP address + user-agent at the DB layer), and allows tampering with / withdrawing a
stranger's marketing consent. Data is limited-sensitivity lead data (not meetings/financials), so Medium not High.
**Description:** `capture_onboarding_lead` is `SECURITY DEFINER`; it upserts a `Lead` **by e-mail**
(`ON CONFLICT (email) DO UPDATE`) and sets `OnboardingSession.leadId = <that lead>` for the caller's *own* onboarding
token. Because the upsert matches on e-mail, an attacker who starts their own onboarding session and submits a **victim's
e-mail** pulls the victim's existing (unconverted) `Lead` into the attacker's session. The `lead_*` and
`marketing_consent_*` policies then grant the attacker's onboarding token SELECT/UPDATE/DELETE on that lead and its
consents. The function overwrites `Lead.name` with the attacker's input, and `marketing_consent_insert`’s WITH CHECK only
constrains `leadId` (not `userId`), so an attacker can insert consent rows with an arbitrary `userId`.
**Exploit (dynamic, confirmed as `abu_app`):**
- Anon with attacker onboarding token → `SELECT rls.capture_onboarding_lead('newid','victim@test.dk','ATTACKER NAME',now)`
  → links victim lead; then reads the victim's `Lead` (email, name, **phone +4511111111**, step) and
  `MarketingConsent` (**phone, ipAddress 203.0.113.9, userAgent "VictimUA"**, text).
- Same context: `UPDATE "Lead" SET phone=…, "userId"='custB', "convertedAt"=now()` and
  `UPDATE "MarketingConsent" SET "emailWithdrawnAt"=now()` both **succeeded**; `INSERT "MarketingConsent"(userId='custB',
  leadId=victim)` **succeeded** (foreign userId accepted).
- `capture_onboarding_lead('newid3','kunde@abu.local',…)` created a lead for an existing **account-holder's** e-mail.
- Over HTTP (no SQLi): `saveContactAction` calls `upsertLead`→`capture_onboarding_lead` with the typed e-mail (only when
  the e-mail has no account). Loading `/kom-i-gang?trin=1` afterwards renders the consent checkbox default from the
  now-victim-linked lead’s consents → a **marketing-consent existence oracle by e-mail**; submitting with the box
  unchecked runs `upsertLead`'s `updateMany where leadId … withdraw` → **withdraws the victim's consent**.
**Fix:** scope the function to the caller's own data: do not `ON CONFLICT (email) DO UPDATE` an existing lead that is not
already owned by the caller's onboarding session — create a fresh lead (or refuse) when the e-mail already maps to another
session/lead, and never silently relink/overwrite. Constrain `marketing_consent_insert`'s WITH CHECK to
`"userId" IS NULL OR "userId" = rls.app_user_id()`. Keep step-1 IP rate-limiting. Re-confirm GDPR consent is only
*added* (never silently withdrawn) through the anon path.

### M-2 — `AuditLog` INSERT policy allows forging system-authored / arbitrary audit rows (Low)
**Files:** `migration.sql` `audit_log_insert` (~649-653); `prisma/roles.sql` §8 (append-only grants); `src/lib/audit.ts`.
**Description:** `audit_log_insert` WITH CHECK is `app_is_system() OR (role IN (ADMIN,ADVISOR,CUSTOMER) AND app_user_id()
IS NOT NULL AND ("userId" IS NULL OR "userId" = app_user_id()))`. Any authenticated user may therefore insert an audit
row with **`userId = NULL`** (indistinguishable from a system-authored entry) and arbitrary `action`/`entity`/`detail`.
Confirmed: as CUSTOMER A, `INSERT "AuditLog"(userId=null, action='admin.bootstrap_create', …)` succeeded; `userId='custB'`
was rejected. Append-only (no UPDATE/DELETE) and unreadable by non-admins limits impact to log poisoning / repudiation
(e.g. injecting misleading "system" entries an admin later trusts). Reachable directly only via a SQLi in an
authenticated request (the app's `audit()` always passes a correct id).
**Fix:** require `"userId" = rls.app_user_id()` for non-system inserts (drop the `"userId" IS NULL` allowance), or add a
separate narrowly-scoped mechanism for the few genuine null-user app events.

### R-1 — `SubscriptionAdvisor` write policy does not constrain `advisorId` to an active/selectable advisor (Low)
**Files:** `migration.sql` `subscription_advisor_write` (~551-554), `advisor_profile_select`/`availability_*_select`
peer branches, `rls.app_board_advisor_ids`/`app_board_peer_ids`.
**Description:** the WITH CHECK only verifies the **subscription** belongs to the customer; it does not verify the
`advisorId` is an active, catalog-selectable advisor. A customer-context SQLi can therefore attach **any** advisor
(including deactivated/hidden ones) to the customer's own board, after which the peer-read policies expose that advisor's
non-public `AdvisorProfile.bio`, `AvailabilityBlock.reason` (free text), `advisor_busy` times and name.
**Exploit (confirmed as abu_app, CUSTOMER A):** `INSERT "SubscriptionAdvisor"(subscriptionId=own, advisorId=<inactive
Nikolaj>)` then read `AdvisorProfile.bio` = `SECRET-BIO-NIKOLAJ`, `AvailabilityBlock.reason` = `SECRET-REASON-NIKOLAJ`.
**Not reachable through the app:** `resolveBoard` (`src/lib/onboarding/board.ts`) filters
`advisorProfile … where active:true` and checks `profiles.length === ids.length`, so checkout/`changePlanAction` cannot
add an inactive/foreign advisor. This is a defense-in-depth gap (RLS broader than the app rule), not an app bug.
**Fix:** add `WITH CHECK (… AND EXISTS (SELECT 1 FROM "AdvisorProfile" p WHERE p."userId" = "advisorId" AND p.active))`
(or a definer helper) so RLS also contains a code path that adds a foreign/inactive advisor.

### R-2 — Rate-limit definer functions are unscoped to the caller (Low)
**Files:** `migration.sql` `rls.rate_limit_hit` / `rls.rate_limit_reset` (~220-246); `src/lib/rate-limit.ts`.
**Description:** both definer functions operate on **any** pre-hashed `key` and only check that a context exists
(`app_role() IS NULL` → error). Confirmed: as CUSTOMER A, `rls.rate_limit_hit('rlX', future, +10y)` reset an arbitrary
key and `rls.rate_limit_reset('rlX')` deleted it. Keys are deterministic `sha256('rl:'+logicalKey)` over predictable
strings (`login-ip:<ip>`, `mfa-user:<userId>`, `login-unknown:<email>`). Under a SQLi as `abu_app`, an attacker who can
compute a victim's key can **reset the victim's login/MFA lockout** (aid brute force) or **inflate it to lock the victim
out** (DoS). No HTTP endpoint passes a raw key, so this is SQLi-gated and partly subsumed by the "forgeable context under
SQLi" residual — but these functions let any context manipulate any user's limiter without even forging `system`.
**Fix:** derive/namespace the key inside the function from the caller's own principal where possible, or restrict
`rate_limit_reset` to `app_is_system()`; at minimum document that the limiter is not a boundary under SQLi.

### R-3 — `advisor_busy` leaks a board advisor's full cross-tenant meeting schedule (times only) to the customer (Low)
**Files:** `migration.sql` `rls.advisor_busy` (~161-181); `src/lib/booking.ts`.
**Description:** a customer may query `rls.advisor_busy` for any advisor in their own board over an **unbounded** time
window and receives that advisor's `starts_at/ends_at/status` for **all** their meetings, including meetings with other
customers. Confirmed: CUSTOMER A read shared advisor Camilla's busy slots spanning B's meeting times (times/status only —
no meeting ids, customer identity, or content). This is inherent to showing availability at booking and is low-sensitivity
metadata, but the window is attacker-controlled (100-year window returned everything).
**Fix:** clamp `p_from`/`p_to` to a bounded horizon (e.g. the booking window) inside the function.

### R-4 — Board peer/advisor relationship ignores subscription status (Info)
**Files:** `rls.app_board_advisor_ids` / `rls.app_board_peer_ids` (~114-131) — the `Subscription` joins have no `status`
filter. A party on a **CANCELLED** subscription keeps mutual read access to the other party's profile/availability
(customer ↔ advisor). Minor; consider filtering to live statuses if former-relationship visibility is undesired.

### N-1 — One non-reproducible startup render executed an admin-page query without the ADMIN principal (Info, fail-closed)
**Files:** `src/lib/db-context.ts` (`currentPrincipal`/`requestMemo` keyed on Next's `workAsyncStorage`),
`src/app/admin/page.tsx` (`loadLeadOverview`→`getLeadTagId` inside a 12-way `Promise.all`).
**Description:** the server log held a single `42501 … new row violates row-level security policy for table "Tag"` from
`prisma.tag.upsert()` on the admin dashboard. In an ADMIN context the lead tag is visible so no upsert runs (verified
directly); the upsert only fires if `findUnique` returned null, i.e. that one parallel query ran in a **non-admin
(anon)** context. It did not recur across repeated `/admin` loads and created no rows — RLS denied it (**fail-closed,
safe direction: the query saw *less*, not more**). This is consistent with the implementer's stated dependency on Next's
internal `workAsyncStorage` for per-request principal memoization under concurrent `Promise.all` queries. I did **not**
observe any query running as the *wrong* user or a *more* privileged principal.
**Fix / recommendation:** treat it as a reliability signal for the `workAsyncStorage` dependency; add a regression guard
that fails if a request-scoped principal ever resolves to anon mid-request for an authenticated session, and keep the e2e
coverage pinned across Next upgrades.

---

## Residual-risk assessment (as listed by the implementer)

- **Forgeable context under SQLi — CONFIRMED, dominant residual.** As `abu_app`, `SELECT set_config('app.role','system',
  false)` (session-level) grants full cross-tenant access, and a transaction-local forge inside the app's own transaction
  also works. Mitigations in place and verified: `set_config(…, true)` is transaction-local (confirmed it clears after
  COMMIT); the adapter guard rejects any statement outside a context-first transaction; the allow-list test forbids
  `$queryRawUnsafe`/`$executeRawUnsafe` (none exist) and array `$transaction`; all raw SQL uses parameterized tagged
  templates. RLS still blocks the common single-predicate / UNION injection shapes. **Recommended hardening:** a
  signed/HMAC'd context value or per-role DB logins, as the implementer notes.
- **Definer functions callable from raw SQL — CONFIRMED.** Every definer enforces caller scoping (`user_directory`,
  `advisor_busy`, `advisor_lead_load`, `lead_eligible_ids`, `pending_upload_total` all returned nothing / raised `42501`
  for out-of-scope ids as customer/advisor/anon) **except** `rate_limit_hit/reset` (R-2) and the e-mail-keyed
  `capture_onboarding_lead` (M-1).
- **workAsyncStorage dependency — real;** see N-1. Covered by tests + e2e; a Next upgrade could move the internal path.
- **Free-text absence reasons readable by board customers — CONFIRMED** (`SECRET-REASON-*` readable by the board's
  customer). Accepted; booking UI hides it. R-1 widens *which* advisors' reasons are reachable under SQLi.
- **Step-1 lead phone exposure — CONFIRMED and wider than stated →** escalated to **M-1** (also exposes IP/user-agent and
  the whole consent record, and allows tamper/withdraw).

## Checked and OK

**RLS coverage & plumbing (dynamic, abu_sec3):** 35 `public` tables, `_prisma_migrations` the only one without
ENABLE+FORCE (and `abu_app` has **no** privilege on it — `SELECT` denied); 0 tables without a policy; **0 views, 0
sequences, 0 functions in `public`**. Startup guard logged `[db] rolle=abu_app · superbruger=nej · BYPASSRLS=nej ·
ejer=nej · RLS=ja`. No-context access fails closed (`DbContextError` client-side; `42501` for the definer functions).
`SET ROLE abu_owner` / `SET SESSION AUTHORIZATION` **denied**. A forged role with no user id, a role with a trailing
space, and lowercase roles all resolve to "no access".

**Cross-tenant isolation (dynamic):** as CUSTOMER A — only A's subscription/meetings/transcripts/recordings/customer
profile/notification logs visible; 0 rows of B's; Lead/MarketingConsent/Session/PasswordToken/AuditLog/Job/WebhookEvent/
RateLimit/IdempotencyKey/CvrLookupCache/`alert:*` all 0. As ADVISOR Lars (B's board only) — only subB/custB, meetB, trB,
recB, custB's company (no account e-mail of other customers); other advisors' `AdvisorProfile` only for active catalog
rows. As anon — only active advisor profiles, COMPETENCE tags, active questions/answers, content; 0 users/sessions/leads/
consents/onboarding/meetings; `alert:*` hidden; admin tags & `AdvisorTag` for the lead tag invisible. Writes: moving a
subscription to another tenant, inserting a meeting/participant/recording for another tenant, and foreign-`userId`
MarketingConsent inserts all **rejected by WITH CHECK**; the one-lead partial unique index held under a forced duplicate.

**User column protection:** `abu_app` has UPDATE on 22/26 `User` columns (not `id/email/role/createdAt` — column
privilege) and the `rls.guard_self_update` trigger blocked a CUSTOMER/ADVISOR from changing `lockedUntil`,
`mfaEnabledAt`, `failedLoginCount`, `deactivatedAt` etc. (self-editable set only); `AdvisorProfile` self-update limited to
`title/bio/photoKey/photoUpdatedAt` (price/active rejected). `UPDATE "User" SET role='ADMIN'` → `permission denied for
table User`.

**Definer search_path & ownership:** all `SECURITY DEFINER` functions own `SET search_path = pg_catalog, pg_temp` (query
for definers missing it returned none); schema `rls` owned by `abu_owner`, `REVOKE ALL FROM PUBLIC`, EXECUTE only to
`abu_app`/`abu_jobs`; `rls.app_is_system()` pins the owner name (`current_user = 'abu_owner'`).

**Privilege hygiene (Phase 0):** `abu_app` — not superuser, no BYPASSRLS/CREATEROLE/CREATEDB, owns 0 objects, **0 role
memberships** (no `pg_read_all_data`/`pg_read_server_files`), no CREATE on `public`/`rls`, no CONNECT-level CREATE/TEMP,
PUBLIC has no schema or table grants, default ACLs grant only DML+USAGE to the app roles. `lo_create` is PUBLIC-executable
(Postgres default) but no app data uses large objects and it does not bypass RLS — benign. SCRAM-SHA-256 verifiers; app
`.env` is git-ignored (not tracked); compose blanks owner/superuser vars in the `app` service; owner-only env vars
rejected by the production guard.

**MFA / admin (static + HTTP):** unauthenticated `/api/admin/leads`, `/api/account/export` → 401; `/api/cron/process-jobs`
without/with wrong secret → 401 (timing-safe compare). Customer `/api/admin/leads` → 403, `/admin` → `/dashboard`. **MFA-
pending admin session** (`mfaPending=true`): `/admin` → redirect `/mfa`, `/api/account/export` → 401, `/api/admin/leads` →
401, and at the DB level the pending principal (anon + session hash) could read **only** its own session + user and
nothing else; it could not insert a TrustedDevice or read admin tables. Full admin → `/admin`, `/admin/administratorer`,
`/api/admin/leads` all 200. Customer B's GDPR export over HTTP contained only B's `SECRET-*-B` data (no A data). TOTP
replay is atomic (`updateMany where mfaLastUsedStep IS NULL OR < step` — second concurrent identical code gets count=0 →
replay); recovery-code use is atomic (`updateMany where usedAt IS NULL` → count); TOTP compares are `timingSafeEqual`
over all window steps; lockout escalates on a per-account `lockedUntil` shared across sessions/IPs (H-2 preserved).
Trusted-device cookie: random token, only `sha256` stored, bound to `userId`, fixed 30-day expiry with **no sliding**
(`matchTrustedDevice` only updates `lastUsedAt`), `httpOnly`+`secure`(prod)+`sameSite=lax`. Admin invite/deactivate/
MFA-reset: last-active-admin and self-deactivation blocked under `pg_advisory_xact_lock`; `resetAdminMfa` can't target
self; re-invite only reactivates a deactivated ADMIN and refuses a non-admin e-mail (no privilege escalation);
`create-admin --reset-mfa` is the documented break-glass. Enrollment secret is stored encrypted (`mfaPendingSecretEnc`),
rendered only on the authenticated `force-dynamic` `/mfa/opsaet` for the user themselves, QR computed server-side (no
external service, no `dangerouslySetInnerHTML`), 30-min TTL; not found in server logs. Dev TOTP seed refused in production
(`seedRefusal`); `MFA_ENCRYPTION_KEY` required ≥32 chars and ≠ `APP_SECRET` in prod; AES-256-GCM with user-id AAD and
key-id rotation. GDPR export carries only `mfaEnabledAt` + trusted-device metadata (no secret/recovery hashes); erasure
clears recovery codes, trusted devices, sessions and the user (secret on the row).

**System-context allow-list:** `src/lib/db-context.test.ts` pins every `withSystemContext` reason to `ALLOW`, forbids
request handlers outside the listed auth/webhook/cron files, and bans `$transaction([…])`, `*Unsafe` raw queries and
`runAsPrincipal` outside auth. Each entry is justified (login/token/MFA before a session; signature-verified webhooks;
token-verified unsubscribe; jobs/cron; system tables; e-mail-matched GDPR). Webhooks enter system context **only after**
signature/secret verification; the inMobile STOP path only acts on known numbers.

**Dependencies:** `npm audit --omit=dev` → **0 vulnerabilities**. next 16.4.2 / @prisma/client 7.10.1 / @prisma/adapter-pg
7.10.1 / pg 8.16.3.

**Regression spot-checks:** C-1 extended with the DB-role runtime guard (verified live `RLS=ja`, role=abu_app, not
owner/superuser/BYPASSRLS); H-2 per-account lockout intact and now shared with MFA via `lockedUntil`; H-5 avatar upload
still off the server-action path (PUT /api/avatar, `bodySizeLimit` 1 MB); M-2 export select-only (no host URLs / secrets
seen in B's export); M-3 erasure present (storage + webhook purge + provider cancel); M-6 headers/`Secure` cookie present;
D-1..D-4 avatar cache/`Vary`/enumeration fixes present in code. (Avatar pipeline itself was out of this review's MFA/RLS
scope; code matches the delta's "Fixed" state.)

---

## Prioritised remediation

1. **M-1 (fix before merge, or owner explicitly risk-accepts):** stop `capture_onboarding_lead` from relinking/
   overwriting a foreign existing lead; scope `marketing_consent_insert` WITH CHECK to self; never silently withdraw a
   stranger's consent via the anon path.
2. **R-1:** add an active-advisor WITH CHECK to `subscription_advisor_write`.
3. **R-2:** restrict `rls.rate_limit_reset` to system / bind the key to the caller.
4. **R-3:** bound the `advisor_busy` time window.
5. **M-2:** drop the `"userId" IS NULL` allowance on `audit_log_insert` for non-system callers.
6. **R-4 / N-1:** filter board relationships to live statuses; add a mid-request anon-regression guard and keep the
   `workAsyncStorage` e2e coverage pinned across Next upgrades.
7. **Hardening (longer term):** signed/HMAC context or per-role DB logins to raise the floor under SQLi (the one residual
   that, if hit, defeats RLS).

## Verdict

**Conditionally safe to merge.** The MFA/admin and DB-role/RLS work is well-engineered and achieves its core goal:
adversarial cross-tenant reads/writes as customer, advisor and anon all fail closed across every sensitive table, the
privilege split and startup guard are correct, and the MFA/session/fresh-MFA mechanics are sound. There are **no Critical
or High** findings. The single Medium (**M-1**, anonymous cross-subject onboarding-lead/consent takeover) should be fixed
before merge or explicitly risk-accepted by the owner given its limited-sensitivity data; the four Low and two Info items
are defense-in-depth hardening that can land as follow-ups. With M-1 addressed, this is safe to merge.

---

## Remediation status

**Date:** 2026-10-19. Each fix lives in its own new migration (applied migrations untouched); every commit was checked with lint,
`tsc --noEmit` and the full test suite as `abu_app` against a freshly provisioned + migrated test DB.

| ID | Status | Commit | Fix (one line) |
|---|---|---|---|
| M-1 | Fixed | `0a203b1` | One lead per onboarding session (`Lead.email` no longer unique); `rls.capture_onboarding_lead(email, name)` only creates/updates the caller's own unconverted lead (never `ON CONFLICT (email)`), `OnboardingSession.leadId` settable only by the function (trigger), consent INSERT bound to own lead + `userId` NULL/self, withdrawal only by the account, admin, system (signed link/STOP) or the session that gave it; identical HTTP response; admin leads grouped per e-mail; GDPR export only account-linked rows (migration `20261021090000_lead_session_scope`). |
| M-2 | Fixed | `97973bb` | `audit_log_insert` requires `"userId" = rls.app_user_id()` for authenticated roles, `NULL` only in system context; `audit(null)` outside system is refused with an alert; device-trust audit written in its auth-internal system context (`20261021091000_audit_log_actor`). |
| R-1 | Fixed | `e772796` | `SubscriptionAdvisor` insert/update WITH CHECK for customers via `rls.board_seat_allowed` (active advisor = `rls.advisor_is_selectable`, frozen price = current price, `isLead` only with the lead tag) – mirrors `resolveBoard`; `changePlanAction` keeps the previous lead only if still eligible (`20261021092000_board_seat_check`). |
| R-2 | Fixed | `03e7ec2` | `rls.rate_limit_hit(bucket, subject, window)` derives the key in the DB (same SHA-256), uses DB time, caps the window (1 s–27 h); outside system only buckets whose subject is the caller's own user/session/onboarding id; pre-auth buckets (IP, e-mail, token, budget, alerts) counted in system context; `rate_limit_reset` system-only (`20261021093000_rate_limit_scope`). |
| R-3 | Fixed | `238fbe3` | `rls.advisor_busy` clamps customer/advisor windows to [now − 1 day, now + 16 weeks + 2 days], admin/system ≤ 20 weeks, validates arguments (1–20 ids, no NULLs, from < to) and returns only start/end of BOOKED/COMPLETED meetings (no status) (`20261021094000_advisor_busy_window`). |
| R-4 | Fixed | `72d0d06` | `rls.app_board_advisor_ids` / `rls.app_board_peer_ids` count only PENDING/ACTIVE/PAST_DUE subscriptions; CANCELLED boards no longer grant profile/availability/busy/name visibility (shared meetings still show participant names) (`20261021095000_board_live_status`). |
| N-1 | Fixed (root cause found) | `87126ca` | Reproduced deterministically against the review build: with a stale/invalid session cookie Next renders the admin page in parallel with the layout, so the page queried as the (correctly resolved) `anon` principal before the layout's redirect → `Tag` upsert 42501. Not a `workAsyncStorage` mis-resolution. Every admin page now calls `requireRole("ADMIN")` itself (test-enforced); `getLeadTagId` never upserts outside admin/system; the `workAsyncStorage` dependency is feature-probed with a test pinned to next@16, missing work store in a Next request throws `DbContextError`, and a mid-request principal change without login/logout throws. |
| Residual: forgeable context under SQLi | Hardened | `221fe6f` | Signed context: `app.ctx` = HMAC-SHA256 over role/user/session/onboarding token with `DB_CONTEXT_SECRET` (prod guard: ≥ 32 chars, not the dev key, not reused); the DB keeps only HMAC pads in `rls.context_key` (no privileges for `abu_app`), `rls.ctx_ok()` (definer) verifies (±5 min) and every context function requires it; all policies/helpers rewritten to `(SELECT rls.app_…())` InitPlans; `npm run db:context-key`; startup guard requires `signeret kontekst=ja` and rejects the dev key in production (`20261021100000_context_signing`). |

**Verification (2026-10-19).**

- `npm run lint`, `npx tsc --noEmit`, `npm run build`: clean. `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
  `npm test` as `abu_app` against a fresh provisioned + migrated `abu_fix_test`: 70 files, 481 tests passed
  (new: `src/lib/rls-remediation.test.ts`, `src/lib/db-context-request.test.ts`, plus additions in `rls.test.ts`, `db-context.test.ts`,
  `rate-limit.test.ts`, `leads-admin.test.ts`, `env.test.ts`, `db-guard.test.ts`, `db-privileges.test.ts`).
- Adversarial psql re-run of this report's scenarios as `abu_app` (same statements; before = `abu_sec3` with the old migrations,
  after = `abu_fix` where the injected SQL runs inside the app's validly signed context):
  - M-1: before – victim lead relinked (`leadV`), name overwritten, phone/IP/user-agent read, phone/userId/convertedAt updated, consent
    withdrawn, foreign-`userId` consent inserted, session relinked. After – old signature does not exist; new call returns a fresh lead
    (`≠ leadV`); victim lead/consent: 0 rows visible, UPDATEs hit 0 rows, foreign-`userId` INSERT and direct relink rejected (42501).
  - M-2: before – customer inserted a `userId NULL` "system" row. After – rejected (42501).
  - R-1: before – inactive advisor added, `SECRET-BIO`/`SECRET-REASON` read. After – INSERT rejected, 0 rows.
  - R-2: before – arbitrary key set with a 10-year window and deleted. After – old signatures gone (42883); another user's
    `mfa-user`/`login-unknown` key and reset rejected (42501); oversized window rejected (22023).
  - R-3: before – 100-year window returned every busy slot with status. After – only the one BOOKED slot inside the booking window,
    no status column (far-future, past and cancelled meetings excluded).
  - Forged system context (`set_config('app.role','system')`, session- or transaction-level, with or without a garbage `app.ctx`, and
    inside a signed customer transaction): before – full access (11 users, all leads/consents/sessions/transcripts). After – 0 rows
    everywhere, `rls.app_role()` NULL; `rls.context_key` → permission denied.
- Playwright (Chromium, `/opt/pw-browsers`) against the production build (`APP_ENV=development`, `abu_app`, signed context, real random
  `DB_CONTEXT_SECRET`): 73 checks passed – onboarding step 1 with a new e-mail and with an existing lead's e-mail (same redirect, same
  unchecked consent box, identical page text; victim lead unchanged), full onboarding → mock payment, booking, meeting page with
  upload/transcript, admin leads list (one row, «2 tilmeldinger»), unsubscribe, MFA login (dev secret), all admin pages, CMS,
  notifications, invite + MFA setup, balancing, GDPR export/erasure, cron/jobs. Server log: **0** RLS errors (0 errors overall).
- Overhead of context signing (pgbench, same transaction shape, old vs new schema): context statement +0.004 ms; policy-heavy queries
  +0.3–0.4 ms; large scans faster (catalog 1.6 → 0.6 ms) thanks to InitPlans; customer pages +3–8 ms median (`/book` +30 ms).

**Remaining risks.**

- An attacker with code execution in the app process (or its environment) has `DB_CONTEXT_SECRET`; signing raises the floor only
  against SQL injection. An injection still runs with the signed context of the request it rides in (that principal's rows only) and can
  replay that same signature for ≤ 5 minutes (not bound to the transaction id, to avoid an extra round trip per query).
- Marketing consent from onboarding step 1 is not double-opt-in: anyone can add (not read or withdraw) consent for an e-mail they typed;
  sending and unsubscribe work per e-mail. Consider a confirmation e-mail before the first marketing send.
- Unlinked leads with the same e-mail are not in a customer's self-service GDPR export (account e-mails are not verified at signup);
  handle such access requests manually. Erasure still deletes every lead with the account's e-mail (admin-approved).
- Free-text absence reasons remain readable by the board's own customers (accepted; UI hides them); `rls.advisor_busy` still reveals
  start/end of a shared advisor's other meetings inside the booking window (inherent to availability).
- The per-request principal memo still relies on Next's internal `workAsyncStorage` (pinned to next@16, probed by a test, fail-closed).
