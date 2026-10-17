# Security audit — Advisory Board Unlimited (ABU)

**Scope:** `/home/user/abu` — Next.js 15 (App Router, server actions), Prisma/PostgreSQL, self-built auth, Frisbii/Whereby/inMobile webhooks, recording upload + Mistral transcription, S3 storage, cron route, GDPR export/delete, CMS, lead capture.
**Method:** full static review of `src/**`, `prisma/**`, config and Docker; dynamic verification against a dedicated build running on `PORT=3102` with database `abu_sec` (migrated + seeded). READ-ONLY on the repo — no files in `/home/user/abu` were modified.
**Date:** 2026-10-17.

Dynamic checks performed (all against `127.0.0.1:3102`): HTTP security headers; unauthenticated access to API/webhook/cron endpoints; `CRON_SECRET` bearer enforcement (timing-safe); real login via the server action and session-cookie flags; customer→admin page and customer→admin-server-action authorization; onboarding user-enumeration; login rate-limit keying with rotating `X-Forwarded-For`; unsubscribe-token forgery with the derived fallback secret; source-map presence; `npm audit`.

---

## Severity summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 6 |
| Medium | 9 |
| Low | 5 |
| Info | 4 |

Counts include only numbered findings below.

---

## Findings

### C-1 — Unsafe-by-default providers: free subscriptions + silent mock in production (Critical)
**Files:** `src/lib/env.ts:26,38,46,52,60,75`; `src/lib/payments/mock.ts:6-13`; `src/app/(app)/subscribe/success/page.tsx:17-26`; `src/lib/payments/index.ts:8-11`; `next.config.mjs` (no runtime guard).
**Description:** Every integration defaults to a non-production value: `PAYMENT_PROVIDER=mock`, `VIDEO_PROVIDER=mock`, `TRANSCRIPTION_PROVIDER=mock`, `EMAIL_PROVIDER=console`, `SMS_PROVIDER=console`, `STORAGE_PROVIDER=local`, `CVR_PROVIDER=mock`. Nothing validates at startup that real providers are configured when `NODE_ENV=production`. With `PAYMENT_PROVIDER=mock`, `MockPayments.createCheckout` returns the accept URL directly, and `subscribe/success` then flips the subscription to `ACTIVE` with no payment at all (`if (sub.provider === "mock") … status: "ACTIVE"`). A deployment that forgets to set `PAYMENT_PROVIDER=frisbii` (or that silently falls back after a bad env value — note `getEnv()` strips empty strings and re-defaults) gives every customer a free active subscription, and the payment webhook is simultaneously disabled (returns 404, see below).
**Exploit scenario:** Operator deploys with the shipped `.env.example`-style config or a missing var; a customer completes onboarding, lands on `/subscribe/success?sub=<ownId>`, and is immediately `ACTIVE` without paying. Mock video/transcription/email mean no real meetings, no mails, data silently lost.
**Fix:** Add a fail-closed startup assertion in `getEnv()` (or `instrumentation`) that, when `NODE_ENV==="production"`, refuses to boot if any provider is `mock`/`console`/`local` or required secrets are empty. Treat an unparseable provider value as a hard error, not a silent default. Log the resolved provider set at boot.

---

### H-1 — Seed ships well-known default passwords for all roles (High)
**Files:** `prisma/seed.ts:13-15,20,76-82,35-47`; documented as a deploy step in `README.md` ("kør seed … log ind som admin@abu.local").
**Description:** Seed creates `admin@abu.local / Admin123!`, `kunde@abu.local / Kunde123!` and 8 advisors `…@abu.local / Raadgiver123!`, all with `recordingConsent`. The deploy guide tells the operator to run the seed to create the first admin. If the password is not rotated (or the demo users not deleted), anyone can log in as administrator and control the whole platform.
**Exploit scenario:** Attacker tries `admin@abu.local / Admin123!` on the production login form → full admin.
**Fix:** Do not seed demo users or passwords in production. Provide a separate `create-admin` script that requires an operator-supplied password (or prints a one-time invite link using the existing `PasswordToken` flow). Gate `prisma/seed.ts` on `NODE_ENV !== "production"`. README should stop instructing a production seed.

### H-2 — Login lockout bypassable via attacker-controlled `X-Forwarded-For` (High)
**Files:** `src/app/actions/auth.ts:24-28,39-40`; `src/lib/auth.ts:80-95`.
**Description:** The rate-limit key is `${firstXFF}:${email}` and the limiter is an in-memory `Map` (per process, lost on restart, not shared between instances). The client controls `X-Forwarded-For`, so rotating it defeats the lockout entirely. There is no per-account lockout.
**Proof (dynamic):** 12 wrong-password logins for `kunde@abu.local`, each with a different `X-Forwarded-For`, all returned "Forkert e-mail eller adgangskode" (never locked). With a fixed `X-Forwarded-For`, the 9th+ attempt returned "For mange forsøg" — confirming the key is the spoofable header.
**Fix:** Derive the client IP from a trusted hop only (set `trustProxy`/known proxy count; do not take the leftmost XFF blindly). Add an account-scoped failure counter persisted in the DB (e.g. on `User`), with exponential backoff/temporary lock independent of IP. Use a shared store (DB/Redis) so limits survive restarts and span instances.

### H-3 — Password-reset and invite links written to server logs by default (High)
**Files:** `src/lib/messaging/email.ts:6-12` (`ConsoleEmail` logs `m.text`), `src/lib/messaging/sms.ts:5-11`; defaults `EMAIL_PROVIDER=console`, `SMS_PROVIDER=console` (`src/lib/env.ts:52,60`); link builders `src/lib/emails.ts:7-13`; admin UI also echoes invite links (`src/app/admin/advisors/page.tsx:21-26`).
**Description:** In the default console mode, every email/SMS body — including single-use password-reset and advisor-invite links and all recipient addresses/phone numbers — is printed to stdout. Anyone with log access can take over any account via the reset link. `NotificationLog.preview` is correctly nulled for `sensitive` triggers, but the adapter log is not.
**Exploit scenario:** Prod left on `console` (the default) → attacker or over-broad log viewer reads a reset link from the logs and sets a victim's password.
**Fix:** Never log message bodies for `sensitive` triggers; redact links/addresses in `ConsoleEmail`/`ConsoleSms`. Disallow `console`/`EMAIL_PROVIDER=console` in production (tie to C-1 guard). Keep sensitive tokens out of any persistent log.

### H-4 — Frisbii webhook signature does not authenticate the event body (High)
**Files:** `src/lib/payments/frisbii-signature.ts:7-24`; `src/app/api/webhooks/payments/route.ts:8-23`; `src/lib/payments/webhook.ts:35-65`.
**Description:** The HMAC is computed over `timestamp + id` only. The `event_type`, `subscription`, `customer` and all other body fields are **not** covered by the signature. Any party that holds one valid `(id, timestamp, signature)` triple can submit an arbitrary event body with it. Idempotency dedups on `externalId` (= `event_id ?? id`), which blocks exact replays of the same id, but the type/subscription the server acts on are unauthenticated. There is also no timestamp-freshness window, so a captured signed value never expires.
**Exploit scenario:** If one legitimate signed value is ever observed (proxy logs, error output, a test event), an attacker can POST `{id, timestamp, signature, event_type:"subscription_created", subscription:"<targetSubId>"}` to activate or cancel a subscription without payment.
**Fix:** Verify the HMAC over the **raw request body** (read `await req.text()` and sign the bytes), per Reepay/Frisbii's documented scheme, before `JSON.parse`. Add a timestamp-freshness check (reject events older than a few minutes). Confirm the exact signing scheme against the real Frisbii docs (OPEN_ITEMS already flags the format as a guess).

### H-5 — Whole upload buffered in RAM with a 500 MB limit → memory-exhaustion DoS (High)
**Files:** `next.config.mjs` (`serverActions.bodySizeLimit: "500mb"`); `src/app/actions/meetings.ts:60-82` (`Buffer.from(await file.arrayBuffer())`); `src/lib/storage/local.ts`, `src/lib/storage/s3.ts` (receive full `Buffer`).
**Description:** `uploadRecordingAction` reads the entire file into a single in-memory `Buffer` before writing to storage, and the server-action body limit is 500 MB. A few concurrent uploads (each up to 500 MB) will exhaust process memory and crash the single Node instance. Upload is limited to ADMIN/ADVISOR participants, so it is authenticated, but any such user (or a compromised advisor account) can take the service down.
**Fix:** Stream uploads to disk/S3 instead of buffering (`S3` multipart upload / `createWriteStream`). Lower `bodySizeLimit` to a realistic ceiling. Enforce a concurrency cap and reject oversize streams early. Consider moving large uploads out of the server-action path to a direct-to-S3 presigned flow.

### H-6 — Vulnerable production dependencies (`next`/`postcss`, `prisma`) (High)
**Files:** `package.json`, `package-lock.json`.
**`npm audit --omit=dev`:** 5 vulnerabilities (1 moderate, 4 high):
- `postcss <=8.5.22` (bundled by `next`): XSS via unescaped `</style>`, and arbitrary `.map` file read / path traversal via attacker-controlled `sourceMappingURL` (GHSA-6g55-p6wh-862q, -fxqj-rqcc-2cmp, -r28c-9q8g-f849, -qx2v-qp2m-jg93). Pulled in transitively by `next@15.5.28`.
- `deepmerge-ts <8` via `@prisma/config` → `prisma` (stack-exhaustion GHSA-ggr8-5vv4-36mx).
**`npm audit` (all):** 14 vulnerabilities (3 moderate, 11 high) — additionally `braces`/`micromatch`/`fast-glob`/`postcss-selector-parser` via `tailwindcss` and `eslint-config-next` (build/dev only).
**Fix:** Upgrade `next` to a patched 15.x that bundles `postcss >= 8.5.23`, and `prisma`/`@prisma/client` to a release whose `@prisma/config` no longer depends on the vulnerable `deepmerge-ts`. Re-run `npm audit --omit=dev` in CI and fail the build on high/critical. Pin exact versions (see also M-9).

---

### M-1 — User enumeration in onboarding (High-confidence, Medium impact)
**Files:** `src/app/actions/onboarding.ts:52-53,198-200`.
**Description:** Onboarding step 1 (`saveContactAction`) and step 6 (`completeOnboardingAction`) return a distinct "Der findes allerede en konto med den e-mail" for registered addresses, while a fresh address proceeds to step 2. Login (`auth.ts:42-44`, dummy-hash constant-time compare) and password reset (`auth.ts:59-69`, identical response) are correctly non-enumerating — but onboarding reintroduces the oracle.
**Proof (dynamic):** POST with `kunde@abu.local` → `?konto=1&err=Der findes allerede en konto`; POST with a fresh email → `?trin=2`.
**Fix:** Make step 1 proceed regardless of whether the email exists (defer the "account exists" handling to account creation, or show a neutral "we've sent you an email / continue" path). At minimum, avoid branching the visible response on account existence.

### M-2 — Host (moderator) video URL exposed to customers via GDPR export (Medium)
**Files:** `src/app/api/account/export/route.ts:21-25` (meetings fetched with no `select`, so all scalar columns are returned); schema `Meeting.hostRoomUrl` (`prisma/schema.prisma:347`).
**Description:** The data export returns the full `Meeting` row for every meeting the user participates in, including `hostRoomUrl` and `providerMeetingId`. The meeting page is careful to give customers only `roomUrl` and staff the `hostRoomUrl` (`src/app/(app)/meetings/[id]/page.tsx:49`), but the export bypasses that distinction. A customer can read the Whereby host URL and join as moderator.
**Fix:** `select` only the fields intended for the subject in the export (omit `hostRoomUrl`, `providerMeetingId`, and arguably `roomUrl`). Apply the same staff/customer distinction used on the meeting page.

### M-3 — GDPR deletion leaves orphaned PII (S3 recordings, webhook payloads) (Medium)
**Files:** `src/app/actions/admin.ts:80-93` (`processDeletionAction`); `src/lib/pipeline.ts:44-52`; schema `WebhookEvent.payload` (`prisma/schema.prisma:400-407`).
**Description:** Account deletion removes the user (cascading to profile/subscription/meeting/transcript/recording rows), onboarding sessions, notification logs and leads. It does **not** delete recording objects from S3/local storage (only the `Recording` DB rows cascade; `storage.delete()` is never called on deletion — objects survive unless already purged post-transcription). `WebhookEvent.payload` stores raw Frisbii/Whereby payloads containing customer email, CVR, phone, and subscription IDs, and is never cleaned up or deleted on erasure. Deletion also does not cancel an active subscription at the provider (noted in OPEN_ITEMS).
**Fix:** On deletion, enumerate and delete the user's recording objects from storage before removing rows. Add a retention/erasure path for `WebhookEvent` (strip or delete payloads after processing, and on subject erasure). Cancel the provider subscription as part of deletion.

### M-4 — CVR lookup lets a client drain the external daily quota (Medium)
**Files:** `src/app/actions/onboarding.ts:81-84`; `src/lib/auth.ts:80-95` (shared in-memory limiter); `src/lib/cvr/cvrapi.ts:36-44`.
**Description:** CVR lookups are rate-limited by `onb-cvr:${ip}` (per IP) and `onb-cvr-s:${sessionId}`, but the IP comes from the spoofable `X-Forwarded-For` (same weakness as H-2) and a new onboarding session cookie is free to obtain. cvrapi.dk enforces a shared *global* daily free quota; an attacker rotating XFF and sessions can exhaust it, breaking onboarding for all legitimate users (the app then shows the "kvote opbrugt" path and forces manual entry).
**Fix:** Rate-limit on a trusted IP and on a server-side counter; add a global per-day budget guard with graceful degradation; consider a CAPTCHA or proof-of-work before external lookups. Cache negative/not-found results too (currently only non-error results are cached).

### M-5 — SMS to arbitrary international numbers → pumping / toll-fraud exposure (Medium)
**Files:** `src/lib/phone.ts:5-17` (`toE164` accepts any `+[1-9]\d{7,14}`, no country allow-list); `src/lib/onboarding/schemas.ts:12-21` (`normalizePhone` accepts any international number); abandoned-onboarding SMS `src/lib/notifications/service.ts:394-422`; test-send `src/app/actions/notifications.ts:124-135`.
**Description:** There is no country restriction on destination numbers. A user-supplied phone (onboarding step 2 → lead) with marketing consent can receive the `onboarding_abandoned` SMS, and admins can send test SMS to any number. Attackers can point SMS at premium/international destinations (SMS pumping). Volume is limited by consent and in-memory rate limits (themselves XFF-bypassable), but there is no hard country allow-list or per-number cap.
**Fix:** Restrict SMS destinations to an allow-list of expected country codes (DK/EU) unless explicitly widened. Add per-number and global send caps and monitoring/alerting on SMS spend. Keep marketing SMS gated behind verified consent (already done) and verify the phone belongs to the account before sending.

### M-6 — Missing security headers: no CSP, HSTS, Permissions-Policy; cookie Secure depends on APP_URL (Medium)
**Files:** `next.config.mjs` (only `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`); `src/lib/env.ts:97-101` + `src/lib/auth.ts:38-44` (`cookieSecure()` = `APP_URL.startsWith("https")`); video iframe `src/components/room-embed.tsx:21-26`.
**Description (verified dynamically):** Responses carry `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN` and `poweredByHeader:false` — but there is **no** `Content-Security-Policy`, no `Strict-Transport-Security`, and no `Permissions-Policy`. The video `<iframe>` requests `camera; microphone; display-capture` with no top-level `Permissions-Policy` to constrain other pages. Session `Secure` is only set when `APP_URL` starts with `https`; behind a TLS-terminating proxy with a misconfigured `APP_URL` (or `COOKIE_SECURE` unset), the session cookie is sent over plain HTTP.
**Fix:** Add a strict `Content-Security-Policy` (default-src 'self'; frame-src for the Whereby domain only; no inline script unless nonce-based), `Strict-Transport-Security` (prod), `Permissions-Policy` (deny camera/mic/geolocation globally, allow only on the meeting route/iframe), and keep `frame-ancestors 'self'`. Force `COOKIE_SECURE=true` in production independent of `APP_URL` parsing.

### M-7 — inMobile webhook authenticated only by a secret in the URL; trusts arbitrary status/STOP payloads (Medium)
**Files:** `src/app/api/webhooks/inmobile/route.ts:11-42`; `src/lib/messaging/inmobile.ts:103-139`; `src/lib/notifications/service.ts:732-757`.
**Description:** The inMobile webhook authenticates via `?secret=` (timing-safe compare — good; and it fails closed when the secret is empty, verified: returns 401). But the shared secret travels in the URL (proxy logs, Referer, history), and the body parser accepts loosely-shaped JSON to mark any `messageId` as DELIVERED/FAILED or to unsubscribe any phone number (`parseIncomingStop`). Anyone who learns the URL secret controls delivery status and can suppress notifications for arbitrary numbers. The format is explicitly a guess (OPEN_ITEMS).
**Fix:** Prefer a signed webhook (HMAC over the body) if inMobile supports one; otherwise rotate the URL secret regularly and keep it out of logs. Validate that the `messageId`/number correspond to records the caller could plausibly affect. Constrain the parser to the documented schema once verified.

### M-8 — Unsubscribe-link signing key is deterministic when `APP_SECRET` is unset; 96-bit truncated HMAC, no expiry (Medium)
**Files:** `src/lib/notifications/unsubscribe.ts:5-40`; env default `APP_SECRET=""` (`src/lib/env.ts:14`).
**Description:** When `APP_SECRET` is empty (the default), the HMAC key falls back to the fixed string `abu-unsubscribe:${DATABASE_URL}:${CRON_SECRET}`. The token is a stateless, never-expiring base64url payload plus a **16-char (96-bit) truncated** HMAC. Anyone who knows (or can guess/leak) `DATABASE_URL` and `CRON_SECRET` can forge valid unsubscribe links for any email/phone; the 96-bit truncation also lowers the brute-force bar.
**Proof (dynamic):** A token for `kunde@abu.local` computed purely from the derived fallback key validated on `/afmeld` ("Vil du afmelde …" confirmation shown for the forged claim).
**Impact:** Forging suppresses a victim's notifications / toggles marketing consent off (privacy annoyance / message DoS); the `/afmeld` action is POST-only and rate-limited (`unsubscribeAction`, `notifications-public.ts:11-18`), so it is not a prefetch hazard and not account takeover.
**Fix:** Require a strong random `APP_SECRET` in production (fail-closed if empty — tie to C-1). Do not derive the key from `DATABASE_URL`/`CRON_SECRET`. Use the full HMAC (or at least 128 bits). Consider binding tokens to a timestamp or storing a per-recipient opaque token.

### M-9 — Dependencies pinned with caret ranges; lockfile not enforced (Medium)
**Files:** `package.json` (all deps use `^`); `Dockerfile` uses `npm ci` (good) but build pulls `prisma generate` from the ranged versions.
**Description:** All dependencies use `^` ranges. Combined with the known-vulnerable transitive packages (H-6), a fresh install can resolve to different versions than audited. There is no committed CI security gate.
**Fix:** Rely on `npm ci` + committed lockfile everywhere (already in Docker), add `npm audit --omit=dev` (and `--audit-level=high`) to CI as a blocking step, and adopt Dependabot/renovate with review.

---

### L-1 — `subscribe/success` activates a subscription on GET in mock mode (Low; subsumed by C-1)
**Files:** `src/app/(app)/subscribe/success/page.tsx:14-26`. GET with side effect, but scoped to the caller's own `PENDING` mock subscription (`customerId: user.id`), authenticated, SameSite=lax. Not CSRF-exploitable cross-account; the real risk is mock-in-prod (C-1). Move activation to the signed webhook; never activate on a page GET in production.

### L-2 — In-memory rate limits and CVR cache are per-process, non-persistent (Low)
**Files:** `src/lib/auth.ts:80-95`; `src/lib/cvr/index.ts:20-35`. Limits reset on restart and are not shared across instances; the CVR cache can grow to 2000 entries then flush. Operationally weak once horizontally scaled. Use a shared store (DB/Redis).

### L-3 — Audit log is best-effort and not tamper-evident (Low)
**Files:** `src/lib/audit.ts:3-9` (errors swallowed); `prisma/schema.prisma:409-421` (`userId` SetNull on delete; no hash chain). Acceptable for app-level accountability, but admins can delete rows directly and failures are silent. Consider append-only storage/export for compliance-grade logging and alert on audit-write failures.

### L-4 — Recording MIME validated from client-supplied `file.type`, and `application/octet-stream` always allowed (Low)
**Files:** `src/app/actions/meetings.ts:75-81`. The type check trusts the browser-reported MIME and explicitly permits `application/octet-stream`, so content type is effectively unvalidated. Storage key is safe (random token + sanitized extension; `LocalStorage.resolve` blocks traversal — verified by code). Downstream the file only goes to the transcription provider. Validate magic bytes / enforce an allow-list; don't blanket-allow octet-stream.

### L-5 — Whereby webhook header parsing is lenient (Low/Info)
**Files:** `src/lib/video/whereby.ts:77-84`. Signature compare is timing-safe and fails closed on empty secret (good). The header split is forgiving but only feeds the HMAC comparison, so no bypass. Verify the real Whereby signature format before go-live (OPEN_ITEMS).

---

### Info
- **I-1 — No source maps shipped to the client.** Verified: `find .next/static -name '*.map'` → 0 files. Good.
- **I-2 — Server-action authorization is enforced server-side, not via middleware.** Verified: a CUSTOMER invoking the admin `updateAdvisorAction` by its action ID (with a valid customer cookie) was redirected to `/dashboard` by `requireRole("ADMIN")` and the DB showed no change. Middleware is only a cookie-presence gate (`src/middleware.ts`), and every server action / admin page independently calls `requireUser`/`requireRole`. This is the correct pattern — the known footgun (relying on middleware for authz) is avoided.
- **I-3 — XSS surface is well-handled.** No `dangerouslySetInnerHTML` / `innerHTML` anywhere (grep confirmed). The markdown-light renderer (`src/components/rich.tsx`, `parseRich`) emits React elements and only allows `/`-relative or `https://` links (`isSafeHref`). Email HTML escapes all interpolated text and linkifies after escaping (`email-layout.ts`). The CMS email preview iframe uses `sandbox="" srcDoc=…` (`templates-tab.tsx:340`). Transcripts/summaries render as React text. Notification variables are substituted then HTML-escaped. CSV export escapes formula-trigger characters (`leads-admin.ts:81-87`).
- **I-4 — Booking concurrency and price integrity are sound.** Booking and admin meeting changes use Postgres advisory locks (`pg_advisory_xact_lock`) with revalidation inside the transaction (`booking.ts:78-124`, `meeting-admin.ts`), preventing double-booking and quota races. The server never trusts a client-sent price or board composition: `resolveBoard` recomputes the price from DB advisor prices and validates 2–4 active advisors (`onboarding/board.ts`); `changePlanAction`/`changeBoardAsAdmin` re-derive the amount server-side.

---

## Checked and OK
- **AuthN hashing:** bcrypt cost 12 (`auth.ts:16`); login uses a dummy-hash constant-time compare for unknown users (`auth.ts:21-26`) — no timing oracle. Min password length 10.
- **Session tokens:** 32 random bytes (256-bit) base64url in the cookie; only SHA-256 stored in DB (`auth.ts:33-36`, `tokens.ts`). Cookie flags verified at runtime: `HttpOnly`, `SameSite=lax`, `Path=/`, 14-day expiry; `Secure` set when `APP_URL` is https (see M-6). Expiry enforced and expired sessions deleted on read (`auth.ts:60-63`).
- **Session invalidation:** logout deletes the DB session and clears the cookie (`auth.ts:47-52`). Password set/reset deletes **all** sessions for the user (`auth.ts:87-95` via `setPasswordAction`). Password change updates the hash. (Note: `createSession` does not rotate/clear the prior cookie on plain login — acceptable since login issues a fresh token; reset/invite do clear all sessions.)
- **Reset/invite tokens:** 256-bit random, SHA-256-hashed at rest, single-use (`usedAt`), with expiry (invite 7 days, reset 2 hours) and validity re-checked on use (`auth.ts:98-109`).
- **CRON route:** timing-safe bearer compare, disabled when `CRON_SECRET` empty (fails closed). Verified: no-auth/wrong-bearer → 401, correct bearer → 200.
- **Unauthenticated endpoint enforcement (verified):** `/api/account/export` → 401; `/api/admin/leads` → 403; payment/video webhooks → 404 in mock mode (fail-safe); inMobile webhook → 401 with empty secret.
- **Authorization / IDOR:** meeting read/upload gated by `canAccessMeeting` (admin or participant) (`access.ts`, `meetings/[id]/page.tsx:38`, `actions/meetings.ts:66-69`); cancel checks ownership (`actions/meetings.ts:42`); advisor availability actions scope all mutations by `advisorId: user.id` (`actions/advisor.ts`); CMS/admin/notifications/leads/test-send actions all call `requireRole("ADMIN")`; onboarding sessions are keyed by a hashed cookie token with no cross-session access.
- **Open redirect:** `safeNextPath` rejects non-relative / `//` / backslash targets (`consent.ts:17-19`); `redirectWith` uses fixed internal paths.
- **CSRF:** server actions rely on Next's built-in Origin/Host enforcement plus `SameSite=lax` session cookie; `/afmeld` acts only on POST (prefetch-safe by design).
- **zod coverage:** auth, onboarding, CMS, notifications, advisor profile and settings inputs are schema-validated; `resolveBoard`/`changeBoardAsAdmin` re-validate server-side.
- **Raw SQL:** only parameterized `$queryRaw`/`$executeRaw` tagged templates (job claim, notification claim, advisory locks) — no string interpolation, no `$queryRawUnsafe`.
- **Header/SMS injection:** email via nodemailer strips CR/LF from header values (verified in `dist/cjs/mime-node/index.js`); SMS sender validated to `[A-Za-z0-9]{3,11}` or a number (`sms.ts:27-35`); recipient numbers normalized to E.164.
- **Path traversal:** `LocalStorage.resolve` rejects keys escaping the root; storage keys are server-generated (`recordings/<meetingId>/<randomToken>.<sanitized-ext>`).

---

## Prioritised remediation list
1. **C-1 / H-1 / H-3 / M-8:** Fail-closed production config guard — refuse to boot with any mock/console/local provider, empty `CRON_SECRET`, empty `APP_SECRET`, or non-https cookie in prod; stop seeding default passwords; stop logging sensitive message bodies.
2. **H-4:** Verify Frisbii webhook HMAC over the raw body + add timestamp freshness; re-confirm scheme against real docs.
3. **H-2:** Replace the XFF/in-memory login limiter with a trusted-IP + persistent per-account lockout.
4. **H-5:** Stream uploads (no full-RAM buffering), lower `bodySizeLimit`, cap concurrency.
5. **H-6 / M-9:** Upgrade `next`/`postcss` and `prisma`; add a blocking `npm audit` CI gate; pin versions.
6. **M-2 / M-3:** `select` export fields (drop host URLs); purge S3 objects and `WebhookEvent` PII on erasure; cancel provider subscription on deletion.
7. **M-1:** Remove the onboarding account-existence oracle.
8. **M-6:** Add CSP / HSTS / Permissions-Policy; force `COOKIE_SECURE` in prod.
9. **M-4 / M-5 / M-7:** Trusted-IP rate limits + global CVR budget; SMS country allow-list + spend caps/alerting; prefer signed inMobile webhook, rotate URL secret.

## Production hardening checklist
- **Infrastructure:** single Node process buffering 500 MB uploads is fragile — run behind a reverse proxy that caps body size, set a known trusted-proxy configuration so `X-Forwarded-For` can be trusted, run multiple instances only after moving rate-limits/caches to a shared store. Dockerfile already runs as a non-root `abu` user on `node:22-bookworm-slim` (good); keep the base image patched and rebuild regularly. `docker-compose.yml` reads `POSTGRES_PASSWORD` from env (defaulting to `abu`) — require a strong value and do not commit it; move secrets to a secrets manager / Docker secrets rather than `.env` on disk.
- **Headers/TLS:** terminate TLS at the proxy with HSTS; add the CSP/Permissions-Policy set from M-6; keep `frame-ancestors 'self'` and restrict the video `frame-src` to the Whereby domain.
- **Monitoring/alerting:** alert on failed webhook signature verifications, SMS/email send volume and spend, audit-write failures, job-queue `FAILED` growth, and repeated login failures per account.
- **Backups:** daily `pg_dump` with tested restores and off-box encrypted storage; back up the `uploads` volume if `STORAGE_PROVIDER=local`; document recovery.
- **Secrets management:** generate strong random `APP_SECRET`, `CRON_SECRET`, DB password and all provider keys; never derive secrets from each other (M-8); rotate the inMobile URL secret.
- **CI security checks:** `npm audit --omit=dev --audit-level=high` (blocking), `npm ci` only, lint/typecheck, and a check that no production env resolves to a mock/console/local provider. Add secret-scanning on the repo.
- **Data protection:** complete the DPA/retention work in `docs/OPEN_ITEMS.md`; ensure erasure removes storage objects and webhook payloads; keep transcript-access auditing (already present).

---

## Remediation status (2026-10-18)

Original findings above are unchanged. Branch `claude/advisory-board-unlimited-app-iwswih`; verified with lint, `tsc`, 293 unit/DB tests, `next build`, `npm audit --omit=dev --audit-level=high` (0), a production-like boot, Docker image build/run and Chromium re-tests (details in the commit messages and `docs/PRODUKTIONSPLAN.md`).

| Finding | Status | Commit(s) | Note |
|---|---|---|---|
| C-1 | Fixed | `16314de` | Fail-closed boot guard (`instrumentation.ts`): production refuses mock/console/local providers, missing secrets/keys, non-https `APP_URL`, unknown env values; logs the provider set without secrets. Mock activation only via POST on an internal test checkout, never in production. Re-tested: standalone build and Docker image with mock config exit 1 with "Appen starter ikke". |
| H-1 | Fixed | `3fc0474` | `npm run create-admin` (one-time 7-day link, no password in code/logs); seed refuses `NODE_ENV/APP_ENV=production`; compose `migrate` runs with `NODE_ENV=production`; README updated. |
| H-2 | Fixed | `e9ac0af` | Client IP from `TRUSTED_PROXY_HOPS` (right-most trusted XFF entry; required ≥1 in prod); per-account lockout in DB (5 → 15 min, escalating, max 24 h); Postgres `RateLimit` store replaces the in-memory Map everywhere. Re-tested: 5 wrong logins with rotating XFF lock the account, even for the correct password. |
| H-3 | Fixed | `abfd648` | Console adapters redact links/tokens, addresses and numbers; sensitive messages (reset/invite) are never logged. Console adapters are also forbidden in production (C-1). |
| H-4 | Fixed (scheme to confirm) | `64f4a68` | HMAC-SHA256 over the raw body + signed timestamp (≤5 min), verified before `JSON.parse`, then zod shape check; idempotency kept. Header format is one constant to adapt once Frisbii/Alunta is chosen. |
| H-5 | Fixed | `c8b6e31`, `23afefd` | No server-action upload: presigned POST direct to S3 (size enforced by storage) or streamed local PUT; magic-byte validation from the first 64 bytes; concurrency caps; `bodySizeLimit` 10 MB; transcription reads a disk-backed Blob. Re-tested: 400 MB upload raised server RSS by ~24 MB. |
| H-6 | Fixed | `c1e8e52` | next 16.4.2 (bundles patched postcss) and prisma 7.10.1 (no vulnerable deepmerge-ts); exact pins; lockfile regenerated with npm. `npm audit --omit=dev`: 0. Remaining dev-only findings (Tailwind 3 / eslint plugins) documented in OPEN_ITEMS. |
| M-1 | Fixed (step 1); residual at step 6 | `4640815` | Step 1 response identical for existing/new e-mail (re-tested), owner gets a neutral "you already have an account" mail via `after()`. Step 6 can still distinguish; full fix needs e-mail verification before account creation (OPEN_ITEMS). |
| M-2 | Fixed | `724adc2` | Export uses explicit selects; re-tested: no `hostRoomUrl`, room URLs or provider ids. |
| M-3 | Fixed | `c938957` | Erasure cancels at the payment provider first (aborts if that fails), deletes recording objects and related WebhookEvent rows, then user data; webhook payloads redacted after 30 days. |
| M-4 | Fixed (no CAPTCHA) | `91fea95` | Trusted-IP + per-session limits, global daily budget for external lookups, shared DB cache incl. "not found". CAPTCHA (Friendly Captcha) left as TODO. |
| M-5 | Fixed | `268ebd3` | SMS country allow-list (default DK, editable in CMS), per-number and daily caps, `[ALERT]` log + admin dashboard alert on hits. |
| M-6 | Fixed | `27330b2` | CSP with per-request nonce (`strict-dynamic`), `frame-src` only Whereby (`'self'` in mock), HSTS in production, Permissions-Policy allowing camera/mic/display-capture only on `/meetings/<id>`, cookie always Secure in production. Re-tested with curl and Chromium (no CSP violations). |
| M-7 | Partially fixed | `b2a85c9` | Secret via header or query, rotation, body cap, rate limit, only recent known messages updated, STOP only for known numbers. Real signature pending inMobile docs. |
| M-8 | Fixed | `29d30c4` | Full 256-bit HMAC with `APP_SECRET` only (required in prod), 1-year expiry. Re-tested: tokens forged with the old derived key are rejected. |
| M-9 | Fixed | `c1e8e52`, `ab7ed4a` | Exact pins, `npm ci` only, CI with blocking `npm audit`, Renovate (weekly, grouped, review). |
| L-1 | Fixed | `16314de` | `/subscribe/success` has no side effects. |
| L-2 | Fixed | `e9ac0af`, `91fea95` | Rate limits and CVR cache in Postgres. |
| L-3 | Mitigated | `740bc1b` | Audit-write failures raise an alert (`[ALERT] audit_write_failed` + admin dashboard). Not tamper-evident (no hash chain). |
| L-4 | Fixed | `c8b6e31` | Magic-byte validation; `application/octet-stream` no longer accepted. |
| L-5 | Fixed | `64f4a68` | Strict `t=`/`v1=` parsing and 5-minute freshness for Whereby. |
