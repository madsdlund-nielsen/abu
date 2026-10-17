# Advisory Board Unlimited (ABU) – Implementation plan

## Product
Customers subscribe to an "advisory board as a service". The subscription is billed monthly and set by:
- number of advisors: 2, 3 or 4
- meeting frequency: every 4, 8 or 12 weeks
- price per advisor per meeting: set per advisor by admin (`AdvisorProfile.pricePerMeetingDkk`, default 1,750 DKK). All prices are excl. VAT (confirmed by the owner).

Monthly price = sum(advisors' meeting prices) × (52 / weeks) / 12, rounded to whole kroner (`monthlyPriceForBoard` in `src/lib/pricing.ts`).
The price is frozen at purchase (`SubscriptionAdvisor.pricePerMeetingDkk`); a later admin price change only affects new subscriptions and plan changes.
The marketing pages show "from" prices, i.e. the table below with everyone at the default 1,750 DKK.

| Frequency | 2 advisors | 3 advisors | 4 advisors |
|---|---|---|---|
| every 4 weeks  | 3,792 | 5,688 | 7,583 |
| every 8 weeks  | 1,896 | 2,844 | 3,792 |
| every 12 weeks | 1,264 | 1,896 | 2,528 |

## Roles
- ADMIN: creates advisor accounts (sends an invite/set-password link), assigns advisors to customers, sees everything, can upload a recording manually to start transcription.
- ADVISOR: edits profile (bio, title, expertise, photo URL), sets weekly recurring availability + blocked dates, sees their meetings, joins meetings, reads transcripts.
- CUSTOMER: onboards themselves (contact, CVR lookup, short test that suggests a board of 2-4 advisors, board builder with swap/add/remove and frequency), pays, books meetings, joins meetings, reads transcripts. See `docs/PLAN-onboarding.md`.

## Vendors (EU only, Danish preferred – no US companies as data processors)
| Need | Vendor | Country | Notes |
|---|---|---|---|
| Hosting (app + Postgres) | Hetzner Cloud or Simply.com VPS | DE / DK | Docker image + docker-compose |
| Subscription payments | Frisbii (formerly Reepay) | DK | Checkout sessions + webhooks, MobilePay/cards |
| Video meetings | Whereby Embedded | NO (EEA) | REST API creates rooms, cloud recording to own S3 bucket |
| Recording storage | Hetzner Object Storage (S3 API) | DE | |
| Transcription + summary | Mistral AI (Voxtral + chat models) | FR | Adapter makes self-hosted Whisper possible |
| Transactional email | SMTP – Simply.com mail or Brevo | DK / FR | nodemailer, any SMTP |
Everything has a `mock` mode so the app runs end-to-end locally with no accounts.

## Tech stack (open-source libraries only, no SaaS)
- Next.js 15 (App Router, server actions) + TypeScript + Tailwind CSS
- PostgreSQL 16 + Prisma
- Auth built in: argon2/bcrypt password hashes, DB-backed sessions, httpOnly cookie, no external IdP
- zod for validation, date-fns + date-fns-tz (Europe/Copenhagen)
- vitest for unit tests
- UI language: Danish

## Data model (Prisma)
- User(id, email unique, passwordHash?, role ADMIN|ADVISOR|CUSTOMER, name, phone, createdAt)
- Session(id = random token hash, userId, expiresAt)
- PasswordToken(id, userId, tokenHash, purpose INVITE|RESET, expiresAt, usedAt)
- AdvisorProfile(userId PK, title, bio, photoUrl, active bool, pricePerMeetingDkk) + AdvisorTag(advisorId, tagId) + Tag(slug, name, description, sortOrder, active)
- OnboardingQuestion / OnboardingAnswer(boardSize?) / AnswerTagWeight(weight 1-5) – CMS content for the test; OnboardingSession – server-side onboarding state (7 days)
- CustomerProfile(userId PK, companyName, cvr, address, billingEmail, cvrData Json, cvrVerified, testAnswers Json snapshot)
- AvailabilityRule(id, advisorId, weekday 0–6 (Mon=1 ISO), startMinute, endMinute) – Copenhagen local time
- AvailabilityBlock(id, advisorId, startsAt, endsAt, reason) – exceptions/holidays
- Subscription(id, customerId, advisorCount, frequencyWeeks, monthlyPriceDkk, status PENDING|ACTIVE|PAST_DUE|CANCELLED, provider, providerSubscriptionId, providerCustomerId, startedAt, cancelledAt)
- SubscriptionAdvisor(subscriptionId, advisorId, pricePerMeetingDkk snapshot) – the customer's board
- Meeting(id, subscriptionId, startsAt, endsAt, status BOOKED|COMPLETED|CANCELLED, roomUrl, hostRoomUrl, providerMeetingId, createdById)
- MeetingParticipant(meetingId, userId)
- Recording(id, meetingId, storageKey, source WEBHOOK|UPLOAD, status RECEIVED|TRANSCRIBING|DONE|FAILED, error)
- Transcript(id, meetingId unique, text, segments Json?, summary text?, language, createdAt)
- WebhookEvent(id, provider, externalId unique, payload Json, processedAt) – idempotency
- AuditLog(id, userId?, action, entity, entityId, createdAt) – GDPR traceability

## Booking rules
- Meeting length: env `MEETING_DURATION_MINUTES` (default 120). Slot step 30 min. Bookable window: 2 days to 16 weeks ahead.
- A slot is offered if, for every advisor on the customer's board: fully inside an AvailabilityRule on that weekday, no AvailabilityBlock overlaps, and no other BOOKED meeting of that advisor overlaps (incl. 30 min buffer).
- Quota: periods of `frequencyWeeks` counted from subscription.startedAt; max one non-cancelled meeting per period. Customer can only book in the current or next period.
- Only ACTIVE subscriptions can book. Cancelling ≥ 48 h before the start frees the quota; later than that it counts as used.
- Slot computation is a pure function in `src/lib/slots.ts` with unit tests. Re-check in a transaction at booking time (race safety).

## Meetings and transcription
- When booked, `video.createMeeting()` (Whereby: POST https://api.whereby.dev/v1/meetings, fields hostRoomUrl, recording to customer S3) stores roomUrl/hostRoomUrl. Advisors get hostRoomUrl. Mock: in-app page with a placeholder room.
- Meeting page /meetings/[id] embeds the room (iframe / `<whereby-embed>`) for participants only, plus a GDPR notice: "Mødet optages og transskriberes automatisk".
- Webhook /api/webhooks/video: recording finished → Recording row → transcription job.
- Admin/advisor fallback: upload an audio/video file on the meeting page → same pipeline.
- Transcription pipeline `src/lib/transcription`: adapter interface `transcribe(fileBuffer, mime) → {text, segments, language}`; Mistral implementation (POST https://api.mistral.ai/v1/audio/transcriptions, model `voxtral-mini-latest`, multipart). Then `summarize(text)` via Mistral chat completions (`mistral-small-latest`, Danish meeting summary with decisions and action items). Mock adapter returns fixed text.
- Jobs: simple DB-backed queue processed in-process (`src/lib/jobs.ts`) plus `/api/cron/process-jobs` protected by CRON_SECRET – no Redis needed.

## Payments (Frisbii)
- 3 plans in Frisbii, one per frequency: `abu-4w`, `abu-8w`, `abu-12w`. The amount is set per subscription (amount override in øre, excl. VAT; VAT is added per the Frisbii setup), because the price depends on the chosen advisors. A plan change recalculates and sends the new amount. To be verified against the Frisbii API.
- Checkout: server creates a Frisbii checkout session (POST https://checkout-api.reepay.com/v1/session/subscription, basic auth with private key, plan handle, customer handle = user id) → redirect to the hosted checkout URL.
- Webhook /api/webhooks/payments: verify signature (HMAC-SHA256 of timestamp+id with webhook secret), idempotent via WebhookEvent; subscription_created/renewal → ACTIVE, invoice_failed → PAST_DUE, subscription_cancelled/expired → CANCELLED.
- Customer can change plan (new plan handle) or cancel from /account/subscription.
- Mock provider: checkout redirects straight to a success page that activates the subscription.

## Pages
Public: / (landing with "from" price calculator), /priser, /login, /kom-i-gang (onboarding; /signup redirects), /set-password?token=, /reset-password, /privatliv (privacy policy template), /vilkaar (terms template).
Customer: /dashboard, /subscribe (board builder for customers without an active subscription), /account/subscription (board builder to change board and frequency), /book, /meetings, /meetings/[id], /account.
Advisor: /dashboard, /availability, /profile, /meetings, /meetings/[id].
Admin: /admin, /admin/advisors (+new, invite, [id] price/tags/active), /admin/onboarding (test CMS + preview), /admin/tags, /admin/customers (+[id] CVR data and test answers), /admin/meetings, /admin/subscriptions.

## GDPR basics in the code
- Data export (JSON, incl. CVR data, test answers and onboarding sessions) and account deletion request on /account; deletion also removes OnboardingSession data. Expired onboarding sessions are deleted by the job queue.
- Recordings are deleted from storage once transcription is done (configurable `DELETE_RECORDINGS_AFTER_TRANSCRIPTION=true`).
- Consent text at signup + recording notice before joining.
- AuditLog for admin actions and transcript access.
- No third-party analytics, no external fonts/CDNs (self-host fonts with next/font local or system fonts).

## Deliverables
- Working app with `docker compose up` (postgres + app), `npm run dev`, seed script (admin, 4 advisors with availability, 1 demo customer).
- `.env.example` with every variable documented.
- README (Danish): setup, architecture, vendors, deployment to Hetzner.
- docs/OPEN_ITEMS.md: accounts to create, decisions needed, known gaps.
- Unit tests: pricing (per advisor), matching, CVR (modulus 11, adapters), onboarding validation, slot computation, quota periods, webhook signature.
- `npm run build`, `npm run lint`, `npm test` pass.
