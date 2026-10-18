# Security audit — ABU **delta** (since 162a28a) + Postgres RLS assessment

**Scope:** `/home/user/abu` — the changes merged after the previous full audit (`docs/SECURITY-AUDIT.md`), i.e. `git diff 162a28a..HEAD`: advisor profile‑photo upload/serving (sharp pipeline, `/api/avatar`, storage adapter), activation gating + admin profile editing, the whole‑board meetings rule, lead advisor + admin‑only tags, and CI/deploy workflow changes. Plus a database Row‑Level‑Security assessment (Part B).
**Method:** static review of the whole diff; dynamic verification against a dedicated standalone build on `PORT=3104` with database `abu_sec2` (migrate deploy + seed), Postgres 16 running as the `postgres` OS user. Crafted malicious/edge images (EXIF+GPS+ICC+XMP+COM polyglot, orientation 6/8, PNG/WebP with metadata, animated WebP, header‑only and real decompression bombs 49/64 MP, RGBA bomb, patched‑SOF JPEG, SVG/GIF renamed `.png`, trailing‑HTML JPEG, 16‑bit/CMYK/progressive) run through the **real** `processAvatar`. `npm audit --omit=dev`. READ‑ONLY on the repo — nothing in `/home/user/abu` was modified.
**Date:** 2026‑10‑18. **Stack:** Next.js 16.4.2 (App Router, server actions, `src/proxy.ts`), Prisma 7.10.1 + `@prisma/adapter-pg`, PostgreSQL 16, sharp 0.35.5 / libvips 8.18.7, bcrypt + DB sessions, roles ADMIN/ADVISOR/CUSTOMER.

## Severity summary (delta findings only)

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 4 |
| Info | 4 |

The previous audit's remediations (C‑1, H‑2, H‑5, M‑2, M‑3, M‑6 and the rest) were re‑checked and are **not regressed** (see "Regression re‑verification"). The delta is well‑engineered; the image pipeline, access control, authz, and the one‑lead invariant all held up under dynamic testing. Part B (RLS) is the substantive section: RLS is **not enabled at all** and the current single‑role setup would make it ineffective even if switched on.

---

## Delta findings

### D‑1 — `immutable` avatar caching is not invalidated on photo removal / erasure (Low)
**Files:** `src/lib/avatar-serve.ts:11-13` (`IMMUTABLE_PUBLIC = "public, max-age=31536000, immutable"`, `IMMUTABLE_PRIVATE`), `src/lib/avatar.ts:removeAdvisorPhoto`, `src/lib/erasure.ts:66-77`.
**Description:** A served avatar at `GET /api/avatar/<id>?size=…&v=<version>` is returned with `Cache-Control: public, max-age=31536000, immutable` (active advisor) — confirmed dynamically. A **replace** is safe because the version (`photoUpdatedAt`) changes, so the old URL is simply orphaned. But on **remove** (advisor removes their photo, or GDPR erasure) there is no new version: the exact URL `?v=<oldversion>` was handed to browsers/CDNs as immutable for a year, and those caches will keep serving the deleted image without revalidating. The origin object is deleted (good), but already‑distributed copies survive.
**Proof (dynamic):** active advisor → `cache-control: public, max-age=31536000, immutable`, `etag:"mve8r9ja-512"`; wrong `?v=` → `public, no-cache`; after‑removal the route 404s but the previously‑cached immutable response is honoured by caches by definition.
**Fix:** for personal data prefer a revalidating policy (e.g. `public, max-age=0, must-revalidate` or a modest `max-age` with `stale-while-revalidate`) instead of `immutable`, or keep `immutable` but document that removal only purges the origin and set a short shared‑cache lifetime via `s-maxage`. At minimum note this in the erasure runbook.

### D‑2 — Avatar upload buffers the whole file in a server action before the concurrency gate (Low)
**Files:** `src/app/actions/advisor-photo.ts:33` (`Buffer.from(await file.arrayBuffer())`), `src/lib/avatar.ts:166-170` (`tryAcquireStreamSlot()` is acquired **inside** `saveAdvisorPhoto`, after the buffer already exists), `next.config.mjs` (`serverActions.bodySizeLimit: "10mb"`).
**Description:** Recording upload was moved off the server‑action path in H‑5, but avatar upload reintroduces a (bounded) buffering path: the action reads the entire `File` into RAM via `arrayBuffer()` before `saveAdvisorPhoto` tries to acquire the shared stream slot (`MAX_CONCURRENT_STREAMS = 2`). The heavy sharp decode is correctly slot‑capped, but the 10 MB buffer is held by every concurrent request while it waits for a slot, and there is no per‑user in‑flight cap on avatar uploads (unlike recordings, which have `MAX_PENDING_PER_USER`). Authenticated (ADVISOR/ADMIN) only, and each request is capped to `bodySizeLimit` 10 MB, so this is a small, authenticated memory‑pressure surface — far below the old 500 MB H‑5.
**Fix:** acquire the concurrency slot (or a lightweight semaphore) before reading `arrayBuffer()`, and/or add a per‑user concurrent‑avatar cap mirroring `MAX_PENDING_PER_USER`. Keep `MAX_AVATAR_BYTES` (5 MB) enforced (it is, before and after the read).

### D‑3 — Weak inactive‑advisor enumeration oracle (Low)
**Files:** `src/lib/avatar-serve.ts:28-40`.
**Description:** `serveAvatar` calls `getViewer()` (a session/DB lookup) **only** when a profile exists, has a `photoKey`, and is inactive; non‑existent ids and photo‑less advisors 404 after a single `findUnique`. This is a marginal timing side‑channel that can distinguish "inactive advisor that has uploaded a photo" from "no such advisor / no photo". Active advisors' photos are public by design (shown pre‑login in the onboarding catalog), so they are not a secret; the 404 body is byte‑identical across all negative cases (verified). Impact is minimal.
**Fix:** optional — resolve the viewer before branching, or add a tiny constant‑work path, so the inactive‑with‑photo case is not distinguishable by latency.

### D‑4 — Avatar responses lack `Vary: Cookie`; `private` is the only thing preventing shared‑cache mix‑ups (Low/Info)
**Files:** `src/lib/avatar-serve.ts:15,45-66`.
**Description:** For an inactive advisor the response is authorization‑dependent (admin/owner → 200, everyone else → 404) but is returned with `Cache-Control: private, max-age=31536000, immutable` and **no** `Vary: Cookie` (the emitted `Vary` lists only the Next RSC headers — verified). Because the response is `private`, only the per‑user browser cache stores it, so it is not exploitable in a correctly‑behaving shared cache. A misconfigured intermediary that ignores `private` could cache the authenticated 200 and serve it to others.
**Fix:** add `Vary: Cookie` on the avatar route (defense in depth), and keep `private` for the non‑public (inactive) case (already done).

### D‑5 (Info) — `leadEligible` is intentionally exposed to unauthenticated visitors
`loadCatalog()` serializes a boolean `leadEligible` per advisor to the browser (verified: present 7× in the customer `/account/subscription` RSC payload) and the board builder renders a "Kan være ansvarlig" marker. This is an owner‑intended UI feature, **not** a leak of the admin tag: the admin tag's name ("Lead‑kvalificeret"), slug, `systemKey` and `kind:"ADMIN"` are **absent** from every customer‑facing payload (verified — 0 occurrences). If the business does not want visitors to learn *which* advisors are lead‑qualified, suppress the boolean for non‑admins; otherwise this is fine.

### D‑6 (Info) — CI `paths-ignore` vs required status checks
`.github/workflows/ci.yml` uses `paths-ignore: ["docs/**","**/*.md"]`. If "CI" is a *required* status check, a docs‑only PR never triggers it and can get stuck pending (GitHub treats skipped required checks inconsistently). Operational, not a vulnerability. Consider a dummy "CI passed" job that always runs, or make the check non‑required.

### D‑7 (Info) — `deploy.yml` deploy step is still a placeholder
The deploy job only `echo`s. When the real step is added (ssh/docker), keep the current good posture: `permissions: contents: read`, `environment: production` (add required reviewers), never interpolate untrusted input into `run:`, pass secrets only via the `production` environment. No issue today.

### D‑8 (Info) — sharp pixel limit note
`MAX_INPUT_PIXELS = 50_000_000` is enforced twice (`limitInputPixels` on decode + an explicit `w*h` check after `metadata()`). A real 49 MP RGBA bomb decoded in 403 ms at +8 MB RSS; a 64 MP bomb and a header‑only 400 MP PNG were rejected pre‑decode. This is a sensible ceiling. Consider lowering to ~25 MP (no legitimate profile photo needs 50 MP) to further shrink the decode cost, but not required.

---

## Checked and OK (delta)

**Image‑parser attack surface (dynamic, through real `processAvatar`):**
- **Magic‑byte + decode consistency:** type is sniffed from the first 16 bytes (`detectImageType`) *and* re‑checked against sharp's decoded `meta.format` (`SHARP_FORMAT[mime]`), so a PNG header in front of other content is rejected. SVG (`<svg onload>/<script>`), GIF, HEIC, PDF, HTML, RIFF‑not‑WEBP all **rejected** (`bad_format`); SVG can never be stored (no XSS).
- **Metadata/EXIF/GPS/ICC/XMP/COM stripping:** every accepted output contained **none** of the injected secrets (`SecretCam`, GPS IFD, `XMP-SECRET`, `<script>`, `ADBE`/ICC, `Exif`, `xpacket`). Output is a single `VP8 ` chunk WebP — verified both from the pipeline and from the bytes served over HTTP. sharp's default `keepMetadata: 0` plus re‑encode to sRGB drops EXIF/XMP/IPTC/ICC; CMYK and 16‑bit inputs are colour‑converted.
- **Decompression bombs:** header‑only 20000×20000 → rejected pre‑decode (`too_many_pixels`); patched‑SOF JPEG claiming 60000×60000 → rejected; real 64 MP → rejected; 49 MP / 49 MP‑RGBA → accepted and downscaled (within the 50 MP limit) at bounded memory.
- **Polyglots / trailing data:** JPEG‑magic‑prefixed HTML → `corrupt`; valid JPEG with appended `<html><script>` → accepted but re‑encoded to a clean 512² WebP (trailing bytes gone).
- **Animated WebP:** `pages: 1` forces a single frame — output `pages=1`, animation dropped.
- **Orientation:** EXIF orientation 6/8 handled via `autoOrient()` and dimension swap before the square crop (unit‑tested + confirmed).
- **Timeouts / concurrency / memory:** per‑image `timeout({seconds:15})`, `sharp.cache(false)`, and a shared 2‑slot cap (`tryAcquireStreamSlot`). Peak RSS across the whole crafted corpus stayed ~184 MB.

**Avatar serving access control (`/api/avatar/[advisorId]`, dynamic):**
- Active advisor, no auth → 200 `image/webp`, `public, immutable`, `ETag`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`.
- Inactive advisor → 404 to anonymous, 404 to a customer, 404 to a **different** advisor, **200 `private, immutable`** to admin and to the advisor themselves. `canViewAvatar` enforces (active ∨ admin ∨ self). No IDOR.
- Enumeration: non‑existent id, photo‑less advisor, invalid `size`, and key‑injection attempts (`..%2f..%2fetc`, `abc/def`) all return the **identical** 404 (`avatarNotFound`, `no-store`). `advisorId` is validated `^[A-Za-z0-9_-]{1,64}$`; storage key is `avatars/<id>/<randomToken>.webp` with the id re‑validated in `newAvatarKeys`.
- `?v=` cache poisoning: the served bytes are always the current `photoKey` regardless of `?v=`; only the exact current version gets `immutable`, any other value gets `no-cache`, so no stale image can be cached under a new URL. `ETag`/`If-None-Match` → 304 correctly.
- `LocalStorage.resolve` still rejects traversal (`../udenfor` throws; unit‑tested for `openStream` too). S3 `openStream` returns null on 404 (no error leak).

**IDOR on upload/replace/remove:** `authorize(actor, advisorId)` = ADMIN ∨ (ADVISOR ∧ `actor.id === advisorId`). The server action forces `advisorId = user.id` for advisors (admin‑supplied `advisorId` ignored unless the actor is ADMIN). Unit test "en rådgiver kan kun ændre sit eget billede – et forfalsket advisorId ignoreres" passes. Customers can't reach these (`requireRole("ADVISOR","ADMIN")`). Replace/remove swap the key under `SELECT … FOR UPDATE` and delete old objects **after** commit, so concurrent uploads never orphan the live key or the DB row (ordering analysed; FOR UPDATE serialises the swaps). Upload/replace/remove are all audit‑logged.

**Activation gating & admin profile editing:**
- `setAdvisorActiveAction` → `requireRole("ADMIN")` → `setAdvisorActive`, which re‑evaluates `canActivate` on the **stored** DB state, so a forged request that skips the UI still can't activate an unready advisor (tests: reject new invitee, reject out‑of‑range price, allow when complete; all pass).
- **Mass assignment closed:** `updateAdvisorAction` no longer accepts `active` (field removed from the zod schema); test "updateAdvisorAction kan ikke ændre aktiv-status (et forfalsket felt ignoreres)" passes. Activation is only reachable via the dedicated action.
- Shared zod schema `advisorProfileSchema` (title ≤120, bio ≤4000, phone ≤30) used by both self and admin edit; admin edit audit‑logs the changed field names. No `active`/photo/URL fields are writable through profile edit.
- **XSS:** bio/title rendered as React text (`{a.bio}`, `{profile.title}`) — auto‑escaped; the old `photoUrl` free‑text URL input is **removed** (closing the external‑image IP‑leak vector), replaced by the processed upload. No `dangerouslySetInnerHTML` anywhere in the diff.

**Whole‑board meetings rule:** `meetingAdvisorChangeError` allows a bare remove only when an extra participant exists beyond `advisorCount`; `changeMeetingAdvisors`/`rescheduleMeeting` revalidate inside a transaction under `pg_advisory_xact_lock(hashtext('meeting:…'/'adv:…'))`; `bookMeeting`/`getBookableSlots` now require `hasWholeBoard(sub)`. GDPR deletion of an advisor audits each affected meeting and raises an `advisor_erased` alert whose text contains **no PII** (survives the deletion). All single‑path; no bypass via other actions.

**Lead advisor & admin‑only tags:**
- Admin tag does **not** leak: `loadCatalog` filters `tags` to `kind:"COMPETENCE"` and emits only the derived `leadEligible` boolean; confirmed on the public onboarding page and the customer subscription page (0 occurrences of name/slug/`systemKey`/`kind:ADMIN`).
- Server rejects admin tags in onboarding weights: `setAnswerWeightAction` looks up the tag and errors if `kind !== "COMPETENCE"`.
- One‑lead invariant: partial unique index `SubscriptionAdvisor_one_lead_per_subscription ON (subscriptionId) WHERE isLead` is present and **enforced** — a direct SQL attempt to set a second lead on a subscription failed with `duplicate key value violates unique constraint`. All lead mutations run under `pg_advisory_xact_lock(hashtext('lead-assignment'))` and set all `isLead=false` before setting one true. `setLeadManually`/`applyBalancing` re‑validate membership + eligibility under the lock and skip stale moves.
- Notification recipients for `board_lead_changed` are scoped to the customer + the new lead + the previous lead only (not the whole board), and not sent on first assignment. `createTagAction` (kind) and `updateTagAction` (system tag can't be deactivated) are ADMIN‑only.

**CI/workflow:** `permissions: contents: read`; no `pull_request_target`; actions SHA‑pinned (Renovate updates); `npm audit --omit=dev --audit-level=high` is a blocking step; draft PRs skipped; a prod‑config‑guard step boots the standalone build with mock config and asserts it exits 1. `deploy.yml` uses `environment: production` and only runs on tags/dispatch after CI is green.

**Migrations:** `20261018140000` (TagKind enum, `Tag.kind` default COMPETENCE, nullable‑unique `systemKey`, `SubscriptionAdvisor.isLead`, the partial unique index, idempotent system‑tag insert `ON CONFLICT(slug)`) and `20261018150000` (drop `photoUrl`, add `photoKey`/`photoUpdatedAt`) applied cleanly via `migrate deploy`; both additive/safe, the `photoUrl` drop is intentional and documented (pre‑launch, no data). The `systemKey` unique index correctly permits multiple NULLs.

**Dependencies:** `npm audit --omit=dev` → **0 vulnerabilities**. sharp 0.35.5 + libvips 8.18.7 are current and not subject to any known advisory in audit. next 16.4.2 / prisma 7.10.1 unchanged from the merge.

### Regression re‑verification (previous Fixed items)
- **C‑1** (fail‑closed boot guard) — intact and *tightened*: `productionConfigProblems` still rejects mock/console/local providers, missing secrets, non‑https/`COOKIE_SECURE=false`, `TRUSTED_PROXY_HOPS < 1`; it now also validates the new `S3_FORCE_PATH_STYLE` (enum) and S3 vars. CSP `img-src` was tightened to drop `https:`. Not regressed.
- **H‑2** (per‑account lockout, trusted‑proxy IP) — `src/lib/lockout.ts`, `auth.ts`, `rate-limit.ts`, `consent.ts` are byte‑identical since 162a28a (empty diff). Not regressed.
- **H‑5** (no server‑action file buffering for recordings) — recordings still use presigned/stream paths, `bodySizeLimit` 10 MB. Avatars add a *bounded* ≤10 MB server‑action buffer (see D‑2) but not the 500 MB regression. Acceptable.
- **M‑2** (export select‑only) — export adds avatar **metadata only** (`photoKey`+note, no bytes) and advisor `boards` with `isLead`/status/`createdAt` but **no customer PII**; still no `hostRoomUrl`/room URLs/provider ids. Not regressed.
- **M‑3** (erasure purges storage + webhooks + cancels provider) — now also deletes both avatar objects (aborts the erasure if that delete fails). Enhanced. Not regressed.
- **M‑6** (CSP/HSTS/Permissions‑Policy, Secure cookie) — verified live: `Content-Security-Policy` with per‑request nonce + `strict-dynamic`, `img-src 'self' data: blob:` (no external hosts), `frame-src 'self'`, `object-src 'none'`, `base-uri`/`form-action 'self'`; `Permissions-Policy` denies camera/mic/display‑capture/geolocation/payment/usb; `/api/*` gets `default-src 'none'`. Not regressed (improved).

---

## Part B — PostgreSQL Row‑Level Security assessment

### Facts found (verified on the running `abu_sec2` DB, built from the repo migrations)
1. **RLS is completely absent.** `grep` over `prisma/migrations/**` finds no `ROW LEVEL SECURITY`, `CREATE POLICY`, `FORCE`, `GRANT`/`REVOKE`, `CREATE ROLE`, `set_config`/`current_setting`. On the live DB, **all 31 tables** have `relrowsecurity = false` and `relforcerowsecurity = false`, and `pg_policies` for schema `public` is **empty (0 policies)**.
2. **The app connects as role `abu`.** From `DATABASE_URL = postgresql://abu:abu@…` (same in `docker-compose.yml` for both the `app` and the `migrate` service). `abu` is: `rolsuper = f`, `rolbypassrls = f`, `rolcreatedb = f`, `rolcreaterole = f`, `rolcanlogin = t`. So it is **not** a superuser and does **not** hold BYPASSRLS — a good baseline.
3. **But `abu` owns every table.** `pg_get_userbyid(relowner) = abu` for all 31 tables (and `_prisma_migrations`). **A table owner bypasses RLS unless `ALTER TABLE … FORCE ROW LEVEL SECURITY` is set.** Therefore, even if someone ran `ALTER TABLE … ENABLE ROW LEVEL SECURITY` today, the app's own role would silently ignore every policy. `abu` also holds full `SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` as owner, and the same credential runs migrations and the app.
4. **No DB‑side least privilege / transport hardening:** one role for app + migrations; weak default password (`POSTGRES_PASSWORD:-abu`); `DATABASE_URL` has no `sslmode`; no `statement_timeout`.

**Conclusion of facts:** the owner's assumption that "Postgres RLS is enabled" is **incorrect** — it is neither enabled nor configured, and the single‑owner‑role model means RLS would be a no‑op for the app role until role separation + `FORCE` are introduced. All tenant isolation today lives purely in application code (`requireUser`/`requireRole` + ownership checks), which the previous audit found sound (I‑2). RLS would be genuine **defense in depth**, not a replacement.

### Where RLS would actually add protection
- An **SQL‑injection or broken‑authz bug** in a server action (e.g. a missing ownership `where`) would still be constrained by the database to the current principal's rows.
- A **compromised app process** (RCE, SSRF‑to‑DB, leaked creds) using the app role could not read/modify arbitrary tenants' rows.
- It forces **least privilege**: the app role loses ownership/DDL and cannot bypass policies.

It does **not** defend against a bug *within* the correct principal's own scope, and it adds real complexity (every query must run in a transaction that sets the principal).

### How to implement with Prisma 7 + `@prisma/adapter-pg`
Two viable patterns:
- **(A) Per‑request `SET LOCAL` in an interactive transaction.** Wrap a request's queries in `prisma.$transaction(async (tx) => { await tx.$executeRaw\`SELECT set_config('app.user_id', ${userId}, true)\`; await tx.$executeRaw\`SELECT set_config('app.role', ${role}, true)\`; … })`. `set_config(…, true)` is transaction‑local, so it resets automatically. Policies read `current_setting('app.user_id', true)`.
- **(B) A Prisma client extension** (`$extends({ query: { $allOperations } })`) that transparently runs every operation inside such a transaction with the `set_config` calls injected from request‑scoped context (e.g. `AsyncLocalStorage` populated by `getCurrentUser`). This avoids touching every call site but turns every query into a transaction.

**Pooling / performance:** `SET LOCAL`/`set_config(…, true)` is transaction‑scoped, which is **compatible with pgBouncer transaction mode** (the setting dies with the transaction, so it never leaks to the next pooled client). A session‑level `SET` would **not** be safe under transaction pooling — avoid it. Cost: every read becomes a transaction (an extra round trip + a `BEGIN`/`COMMIT`); measure, and keep the raw advisory‑lock transactions as they are. The pg adapter supports interactive transactions, so both patterns work.

**Separate DB roles (required for RLS to mean anything):**
- `abu_migrate` (or keep `abu` as the migration/owner role): owns the tables, runs `prisma migrate deploy` and `seed`. **Not** used by the app.
- `abu_app`: `LOGIN`, **no** BYPASSRLS, **not** a table owner, granted only `SELECT/INSERT/UPDATE/DELETE` on the needed tables. This is the role the running app uses. Because it is not the owner, policies apply without needing `FORCE` — but set `FORCE` on the owned tables anyway so the owner is covered too.
- Optional `abu_jobs`: a role (or a policy branch keyed on `app.role = 'system'`) for cross‑tenant background work — the notification scheduler, cleanup jobs (`cleanupStaleUploads`, webhook retention), and webhook handlers that legitimately touch many tenants before a user context exists.

### Tables and policies
Tenancy here is: a **CUSTOMER** owns their `User`/`CustomerProfile`/`Subscription`(+`SubscriptionAdvisor`)/`Meeting`(+participants/recordings/transcripts) and their `OnboardingSession`/`Lead`/`MarketingConsent`/`NotificationLog`; an **ADVISOR** owns their `User`/`AdvisorProfile`/availability and sees meetings/subscriptions they participate in; **ADMIN** sees everything; **CMS/content** is world‑readable, admin‑writable.

- **User** — self or admin; (advisors readable to customers only via the catalog projection, so keep `User` row access to self/admin and expose advisor display data through `AdvisorProfile` policies instead).
- **Session, PasswordToken** — owner (`userId = app.user_id`) or admin/system; sessions are looked up by hash, so the policy is `userId = current_setting('app.user_id')` OR `app.role IN ('admin','system')`.
- **CustomerProfile** — `userId = app.user_id` or admin.
- **AdvisorProfile** — `SELECT` where `active` (public catalog) OR self OR admin; write self/admin. (Mirrors `canViewAvatar`.)
- **Subscription / SubscriptionAdvisor** — customer owner (`customerId = app.user_id`), or advisor who is a member (`EXISTS (SELECT 1 FROM "SubscriptionAdvisor" sa WHERE sa."subscriptionId" = id AND sa."advisorId" = app.user_id)`), or admin.
- **Meeting / MeetingParticipant** — participant (`EXISTS … MeetingParticipant mp WHERE mp."meetingId"=id AND mp."userId"=app.user_id`) or admin; mirrors `canAccessMeeting`.
- **Recording / Transcript** — via the parent meeting's participant check or admin; system role for the transcription pipeline.
- **NotificationLog** — recipient (`userId`/email match) or admin/system.
- **Lead / MarketingConsent / OnboardingSession** — admin/system write; subject read by email/session‑token match (these are pre‑account, so largely `app.role IN ('admin','system')` with a narrow self‑by‑email read).
- **AuditLog** — admin/system read; **insert‑only** for app (no update/delete) — good fit for append‑only.
- **WebhookEvent** — admin/system only.
- **CMS: ContentBlock, Tag, OnboardingQuestion/Answer, AnswerTagWeight, NotificationTemplate/Rule, AppSetting** — `SELECT` to all authenticated (or public for content shown pre‑login), write only `app.role='admin'`. Note: admin‑tag confidentiality is already handled in app code; RLS would additionally let you restrict `Tag WHERE kind='ADMIN'` reads to admin at the DB.
- **System/infra: Job, RateLimit, CvrLookupCache, IdempotencyKey, _prisma_migrations** — `app.role='system'`/owner only; these have no end‑user tenancy.

### Pitfalls to plan for
- **`FORCE ROW LEVEL SECURITY`** on every owned table, or the owner (migration role / anyone who ends up owning) bypasses policies — this is exactly why RLS looks "enabled but ineffective" today.
- **Migrations & seed** must run as the owner/migration role (RLS off for it) — do not point them at `abu_app`.
- **Advisory‑lock raw queries** (`pg_advisory_xact_lock` in `booking.ts`, `meeting-admin.ts`, `lead.ts`) and other `$queryRaw`/`$executeRaw` (`lockout.ts`, `avatar.ts` `FOR UPDATE`, `notifications/service.ts`, `jobs.ts`, `rate-limit.ts`, `erasure.ts`) run as the app role and must either be covered by policies or run under the `system` context; advisory locks themselves are not row‑scoped and are unaffected, but the `SELECT … FOR UPDATE` row reads are.
- **`$queryRaw` result shaping** won't bypass RLS (it's the same role) — good, but any admin/cross‑tenant raw query must set `app.role='admin'/'system'` first.
- **Every query in a transaction** (pattern B) changes transaction semantics — watch for nested `$transaction` and the interactive‑transaction timeout (already 15 s in several places).
- **Tests** (`vitest` DB tests) seed and assert across tenants — run them as the owner role, or add a test `app.role='system'` context, or they will start failing once policies bite.
- **`set_config` injection:** always pass `userId`/`role` as **bound parameters** to `set_config`, never string‑interpolated.

### Phased plan + effort
- **Phase 0 — easy wins now (no RLS), ~0.5–1 day:**
  - Create a non‑owner `abu_app` role with only DML grants; point the app at it; keep migrations on the owner role. (Biggest single risk reducer.)
  - `REVOKE` broad privileges and restrict sensitive tables (`WebhookEvent`, `AuditLog`, `Session`, `PasswordToken`, `Job`, `RateLimit`) to the roles that need them.
  - Strong `POSTGRES_PASSWORD` (drop the `:-abu` default), separate migration credentials.
  - Add `?sslmode=require` (or `verify-full`) to `DATABASE_URL`; set `statement_timeout` (e.g. 15 s) and a sane `idle_in_transaction_session_timeout` on the app role.
- **Phase 1 — RLS scaffolding, ~1–2 days:** add the Prisma client extension (pattern B) + `AsyncLocalStorage` principal context wired from `getCurrentUser`; a `system` context helper for jobs/webhooks; migration that `ENABLE`+`FORCE`s RLS on tables but installs only permissive `USING (true)` policies first (no behaviour change) to shake out the "everything must be in a transaction" plumbing under load.
- **Phase 2 — real policies, tenant tables first, ~2–3 days:** `User/Session/CustomerProfile/AdvisorProfile/Subscription/SubscriptionAdvisor/Meeting/MeetingParticipant/Recording/Transcript/NotificationLog`; add DB tests per table (positive + negative).
- **Phase 3 — remaining tables + CMS + infra, ~1–2 days:** `Lead/MarketingConsent/OnboardingSession/AuditLog/WebhookEvent`, CMS read‑all/admin‑write, system tables; load/perf test under pgBouncer transaction mode.

### Example SQL (representative tables)
```sql
-- Roles (run once, as a superuser / the DB provisioner)
CREATE ROLE abu_app LOGIN PASSWORD '***';           -- NOT owner, NO BYPASSRLS
GRANT USAGE ON SCHEMA public TO abu_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO abu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO abu_app;
-- migrations keep running as the owner role (e.g. abu); app uses abu_app

-- Meeting: participant or admin
ALTER TABLE "Meeting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Meeting" FORCE  ROW LEVEL SECURITY;
CREATE POLICY meeting_access ON "Meeting"
  USING (
    current_setting('app.role', true) IN ('admin','system')
    OR EXISTS (SELECT 1 FROM "MeetingParticipant" mp
               WHERE mp."meetingId" = "Meeting".id
                 AND mp."userId" = current_setting('app.user_id', true))
  );

-- Subscription: customer owner, member advisor, or admin
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE  ROW LEVEL SECURITY;
CREATE POLICY sub_access ON "Subscription"
  USING (
    current_setting('app.role', true) IN ('admin','system')
    OR "customerId" = current_setting('app.user_id', true)
    OR EXISTS (SELECT 1 FROM "SubscriptionAdvisor" sa
               WHERE sa."subscriptionId" = "Subscription".id
                 AND sa."advisorId" = current_setting('app.user_id', true))
  );

-- AdvisorProfile: public if active, else self/admin (mirrors canViewAvatar)
ALTER TABLE "AdvisorProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdvisorProfile" FORCE  ROW LEVEL SECURITY;
CREATE POLICY advisor_read ON "AdvisorProfile" FOR SELECT
  USING (active
         OR "userId" = current_setting('app.user_id', true)
         OR current_setting('app.role', true) IN ('admin','system'));
CREATE POLICY advisor_write ON "AdvisorProfile" FOR ALL
  USING ("userId" = current_setting('app.user_id', true)
         OR current_setting('app.role', true) IN ('admin','system'))
  WITH CHECK ("userId" = current_setting('app.user_id', true)
         OR current_setting('app.role', true) IN ('admin','system'));

-- AuditLog: admin/system read, app insert-only (append-only)
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE  ROW LEVEL SECURITY;
CREATE POLICY audit_read   ON "AuditLog" FOR SELECT
  USING (current_setting('app.role', true) IN ('admin','system'));
CREATE POLICY audit_insert ON "AuditLog" FOR INSERT WITH CHECK (true);
```
```ts
// Prisma extension sketch (pattern B)
const principal = new AsyncLocalStorage<{ userId: string; role: 'admin'|'advisor'|'customer'|'system' }>();
export const rlsPrisma = base.$extends({
  query: {
    async $allOperations({ args, query }) {
      const p = principal.getStore() ?? { userId: '', role: 'system' };
      return base.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${p.userId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.role',    ${p.role},   true)`;
        return query(args); // runs inside the same tx; SET LOCAL resets on commit
      });
    },
  },
});
// requireUser() populates principal.run({userId, role}, …); jobs/webhooks use role:'system'.
```
*(Confirm the extension actually rebinds `query` to the transaction client in your Prisma 7 version; if not, prefer pattern A — explicit `$transaction` wrappers in the data‑access layer — which is more verbose but unambiguous.)*

---

## Prioritised remediation list
1. **Part B / Phase 0 (highest value):** split the DB role — run the app as a non‑owner `abu_app` without BYPASSRLS; keep migrations on the owner role; strong DB password; `sslmode=require`; `statement_timeout`. This alone removes the "app owns everything" risk and is a prerequisite for any future RLS.
2. **D‑1:** change the avatar `Cache-Control` away from a 1‑year `immutable` for removable personal data (or document that removal purges origin only); add to the erasure runbook.
3. **D‑2:** gate avatar uploads with the concurrency slot before buffering, and add a per‑user in‑flight cap.
4. **D‑4 / D‑3:** add `Vary: Cookie` to the avatar route; optionally neutralise the inactive‑advisor timing oracle.
5. **Part B / Phases 1–3:** adopt RLS as defense in depth per the plan above (after Phase 0).
6. **D‑5 / D‑6 / D‑7 / D‑8:** confirm `leadEligible` public exposure is intended; handle the `paths-ignore` vs required‑check interaction; keep the deploy job hardened when it's implemented; consider lowering the pixel ceiling.

---

## Remediation status (2026-10-18)

The findings and the RLS assessment above are unchanged (append-only). Branch `claude/advisory-board-unlimited-app-iwswih`.
Verified with `npm run lint`, `npx tsc --noEmit`, `npm test` (439 tests, all DB tests running **as `abu_app`** against a test
database provisioned with `npm run db:roles` and migrated as `abu_owner`), `npm run build`, `npm audit --omit=dev --audit-level=high`
(0 vulnerabilities), a Chromium smoke test against the production build running as `abu_app` (admin login with TOTP, all admin
pages, booking, avatar upload/remove with header checks), production-mode boots, and `docker compose up` with the new init flow.

| Finding | Status | Commit | Note |
|---|---|---|---|
| D-1 | Fixed | `7448315` | No `immutable` for avatars any more. Current version: `public` (inactive: `private`), `max-age=300, must-revalidate` + `ETag`. After removal/erasure the revalidation returns `404 no-store`, so cached copies stop being served within 5 minutes. Verified live: `cache-control: public, max-age=300, must-revalidate`, `If-None-Match` → 304, after removal → 404 `no-store`. Erasure runbook (README «GDPR») notes the ≤ 5 min cache tail. |
| D-2 | Fixed | `7448315` | Upload moved from the server action to `PUT /api/avatar/<id>` (raw body). Order: authz → `Content-Length` (> 5 MB → 413, body never read) → per-user in-flight cap (1, → 429) → shared slot (→ 503) → body read as a stream with a 5 MB cap (aborted as soon as it is exceeded, also for chunked bodies) and a 30 s timeout → sharp. Origin check as for recordings. `serverActions.bodySizeLimit` lowered from 10 MB to 1 MB (no server action handles files any more). Verified live: 6 MB → 413. |
| D-3 | Fixed | `7448315` | `serveAvatar` resolves the viewer in parallel with the profile lookup on every path (missing, no photo, active, inactive); unit test asserts one viewer lookup per path. |
| D-4 | Fixed | `7448315` | `Vary: Cookie` on all avatar responses (200/304/404). Verified live: Next merges it with its RSC values (`vary: rsc, next-router-state-tree, …, Cookie`). |
| D-5 | Accepted (documented) | docs | `leadEligible` stays as the owner's intended UI feature; README («Ansvarlig rådgiver») documents that the boolean is visible pre-login and where to suppress it. |
| D-6 | Documented | `6483471`, docs | `ci.yml` header and README («CI») explain the `paths-ignore` × required-check interaction: do not make the CI jobs required checks (deploy runs CI anyway), or drop `paths-ignore`. `docs/OPEN_ITEMS.md` updated accordingly. |
| D-7 | No change | — | `deploy.yml` left as is (placeholder deploy step); keep the posture described above when the real step is added. |
| D-8 | Fixed | `7448315` | `MAX_INPUT_PIXELS` 50 MP → 25 MP (a 24 MP camera image still passes; files > 5 MB are rejected anyway). Error text derived from the constant. |

### Part B — RLS Phase 0 (done; no policies yet)

| Item | Status | Commit | Note |
|---|---|---|---|
| Role separation | Done | `6483471` | `prisma/roles.sql` (idempotent, pure SQL) run by `npm run db:roles` (superuser URL in `DATABASE_URL_PROVISION`, passwords from `ABU_*_PASSWORD`, sent as SCRAM-SHA-256 verifiers) or by `docker/postgres/initdb` on the compose Postgres' first start. Chosen over a Prisma migration because roles are cluster-global and need a superuser, passwords must come from the environment, and the same file must run against several databases (`abu`, `abu_test`) and again on password rotation. `abu_owner` owns the database, schema `public` and every object (ownership is transferred from a legacy single-role setup — verified on a copy of an old `abu`-owned DB). `abu_app`: `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`, no role memberships, only `SELECT/INSERT/UPDATE/DELETE` + `USAGE` on sequences, no `TRUNCATE`/`REFERENCES`/`TRIGGER`, no `CREATE` on `public`, no `TEMP`; `ALTER DEFAULT PRIVILEGES FOR ROLE abu_owner` grants DML on future tables; `REVOKE ALL ON SCHEMA public / DATABASE FROM PUBLIC`. `abu_jobs` is provisioned (same grants, longer timeouts) but not used yet — reserved for Phase 1's system context. |
| Sensitive tables | Done | `6483471` | Migration `20261019100000_db_roles_phase0` (runs as owner after the tables exist): app roles lose all access to `_prisma_migrations`, and `AuditLog` is append-only for them (`SELECT/INSERT`). FK `ON DELETE SET NULL` on `AuditLog.userId` still works (RI actions run as the table owner). |
| Two connection strings | Done | `6483471` | `DATABASE_URL` (runtime, `abu_app`) and `DATABASE_URL_MIGRATE` (owner) used by `prisma.config.ts`, seed and `create-admin` (`scripts/owner-db-env.ts`). Compose: superuser `postgres` only for provisioning, `migrate` as `abu_owner`, `app` as `abu_app`; owner/superuser variables blanked in `app`; no default passwords (`${VAR:?}`), compose refuses to start without `POSTGRES_PASSWORD`, `ABU_OWNER_PASSWORD`, `ABU_APP_PASSWORD`; healthcheck over TCP so `migrate` only starts after the init script. `docker compose run --rm db-roles` re-runs the roles. |
| TLS to DB | Done | `cd9164d` | `sslmode` with libpq semantics (`disable`/`require`/`verify-ca`/`verify-full`; `prefer`/`allow` rejected), CA from `DATABASE_SSL_CA` or `sslrootcert`. Production guard requires TLS unless the host is a Unix socket, loopback or the compose service `postgres` on the internal bridge network (documented exception in README). Verified against a local TLS-enabled Postgres: verify-full with the right CA → `TLS=ja`; wrong CA / no CA / hostname mismatch → refused; `verify-ca` and `require` behave as libpq. Migrations use Prisma's own URL parameters (`sslmode=require&sslaccept=strict&sslcert=<CA>`, verified; wrong CA refused). |
| Timeouts and pool | Done | `cd9164d`, `6483471` | On the `abu_app` role: `statement_timeout 15s`, `lock_timeout 10s` (also advisory locks), `idle_in_transaction_session_timeout 30s` (above the 15 s interactive-transaction timeout, so Prisma's own error wins); the same values are sent as startup parameters by the pg adapter. Pool `max` = `DATABASE_POOL_MAX` (default 10). No current job needs more; the exemption path is `SET LOCAL statement_timeout` (tested) or `abu_jobs` (5 min) in Phase 1. |
| C-1 guard (DB role) | Done | `3e2d91b` | One startup query (`pg_roles` for `current_user`, ownership of objects in `public` and of `"User"` incl. membership of the owner role, DB owner, `CREATE` on `public`, `pg_stat_ssl`). Production refuses superuser, BYPASSRLS, CREATEROLE, CREATEDB, owner/owner-member, DB owner, DDL rights, or an unreachable DB; logs `[db] rolle=… · TLS=…` (never the URL). Static checks also reject `abu_owner`/`postgres` by name, short DB passwords and owner/superuser variables in the app process. Verified: prod boot as `abu_owner`, `postgres`, the legacy superuser `abu` and a role that is a member of `abu_owner` all exit 1 with «Appen starter ikke»; as `abu_app` it starts. |
| CI | Done | `6483471` | Service container has only `postgres`; `npm run db:roles` with random per-run passwords (masked), migrations as `abu_owner`, `npm test` as `abu_app` (SCRAM over TCP, so the verifiers are exercised too). |
| Tests | Done | `3e2d91b`, `6483471`, `cd9164d` | `src/lib/db-privileges.test.ts` (as `abu_app`): `CREATE/ALTER/DROP/TRUNCATE`, index, function, schema, `TEMP`, `ALTER TYPE`, `SET ROLE abu_owner`, `ALTER/CREATE ROLE` → 42501; `GRANT` without grant option has no effect; `pg_authid` and `_prisma_migrations` unreadable; CRUD works; `AuditLog` append-only; role timeouts; the guard accepts `abu_app` and rejects `abu_owner` in prod mode. Unit tests for URL/TLS/pool config, the guard, the production config checks and the SCRAM verifier (RFC 7677 vector). Existing tests needed only one change: `AuditLog` cleanup now uses an owner connection (`TEST_DATABASE_URL_OWNER`). No raw DDL, `TRUNCATE` or owner-only code existed in the app. |

### What Phase 1 (RLS policies) must account for
- **Owner and seed:** with `FORCE ROW LEVEL SECURITY` the owner is subject to policies too — migrations that touch data, `prisma/seed.ts` and `create-admin` (all run as `abu_owner`) must set `app.role = 'system'` (or the policies must exempt the owner explicitly).
- **System context:** the in-process scheduler (`processJobs`, notifications, `cleanupStaleUploads`, retention/redaction in `erasure.ts`), webhooks and the cron route have no user; give them `app.role = 'system'` — or move them to `abu_jobs` (already provisioned, longer timeouts) with a policy branch for that role.
- **Raw SQL** runs as `abu_app` and will be filtered: `SELECT … FOR UPDATE` in `lockout.ts`/`avatar.ts`, the `UPDATE … RETURNING` claim queries in `jobs.ts`/`notifications/service.ts`, `rate-limit.ts` upsert, `erasure.ts` redaction. Advisory locks are unaffected.
- **Pre-login paths** (login, MFA, password reset, onboarding, avatar GET for the public catalog, unsubscribe links, `RateLimit`, `CvrLookupCache`) need explicit policies or the system context.
- **Transactions and timeouts:** pattern B wraps every operation in a transaction; keep total work under `statement_timeout`/`idle_in_transaction_session_timeout` (15 s / 30 s) and Prisma's interactive-transaction timeout; nested `$transaction` must reuse the outer one. `SET LOCAL`/`set_config(…, true)` only (pgBouncer transaction mode safe), always with bound parameters.
- **RI actions** (e.g. `AuditLog.userId ON DELETE SET NULL`) run as the table owner with RLS not forced — that is fine, but do not rely on policies to block cascades.
- **Tests** run as `abu_app`; once policies bite, DB tests need a `system` context helper for setup/cleanup (the owner connection in `src/test/db.ts` is the natural place).
- **Grants for new tables** come from `ALTER DEFAULT PRIVILEGES` only when the table is created by `abu_owner`; never run migrations as another role (re-run `npm run db:roles` if that happens). Every new sensitive table should get an explicit `REVOKE` in its migration, like `AuditLog`.
