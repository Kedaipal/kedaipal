# WABA protection — kill switch, send guardrails, opt-out & health auto-throttle

> **Plain-English overview + the decisions we made** (for non-engineers /
> recall): [`docs/waba-protection-overview.md`](./waba-protection-overview.md).
> This file is the engineering reference.

ClickUp: [`86expmgep`](https://app.clickup.com/t/86expmgep). Kedaipal sends every
seller's WhatsApp notifications through **one shared, Meta-verified WhatsApp
Business number** (the "no Meta setup" moat — see [`CLAUDE.md`](../CLAUDE.md)).
That concentrates risk: one bad-actor retailer (spam, a runaway loop, complaints)
can degrade the quality rating or trip Meta's per-number limits for **every**
seller. This module is the gateway that makes the shared model safe on paid plans.

## Scope shipped vs. relocated

This is the **real-now core** of `86expmgep` — everything that's load-bearing
pre-Broadcast. Deliberately relocated to their owning tickets (they can't be
validated without features that don't exist yet, and would otherwise be
speculative):

- **Admin UI** (`/admin/retailers/:id`, `/admin/waba-health`) → **Admin Console**
  ticket [`86ey25er1`](https://app.clickup.com/t/86ey25er1). Until it ships, the
  kill switch + visibility run via the Convex CLI (below).
- **Spam-pattern detection, Marketing-category auto-pause, gradual-ramp UI,
  retailer "sending health" widget, delivery/read receipts** → the **Broadcast**
  work. There are no broadcasts/batches to police yet; the schema is ready
  (`outboundMessageLog.category` + `delivered`/`read` statuses) for when it lands.

## The category policy (the key design decision)

Every send is tagged with a **category**, and **transactional order messages are
exempt from all gating** — opt-out, retailer pause, caps, and the quality halt.
This is straight from the ticket's edge cases ("pause ALL outbound *except*
transactional order confirmations"; "even when paused, allow order confirmation
through"). Rationale: pausing a misbehaving seller, or honouring a global STOP,
must never break a buyer's *active order* updates.

| Category | Used for today | Gated? |
| --- | --- | --- |
| `transactional` | order confirm, status updates, payment received, mockup, counter order, founding welcome, diagnostics | **No** — always sends (core promise) |
| `session_message` | generic inbound replies (unknown fallback, checkout-bind, opt-out acks) | Yes |
| `utility_template` / `marketing_template` | reserved for templates ([`86ey1fgjw`](https://app.clickup.com/t/86ey1fgjw)) + Broadcast | Yes |

**Consequence to keep in mind:** pre-Broadcast, almost all real traffic is
transactional, so the kill switch + caps mostly govern session replies *today*
and become fully load-bearing once Broadcast ships — which is exactly the
boundary we drew. The opt-out, quality auto-throttle, and audit log are valuable
immediately.

## The gate

`makeGuardedSender(ctx, retailerId, category)` is a drop-in for the raw channel
adapter (`.send(to, msg)`), so the orchestration in `convex/whatsapp.ts` is
unchanged except for *which* sender it builds. Per send it calls `canSend`, then
hits Meta and logs the outcome. `canSend(ctx, { retailerId, toPhone, category })`
checks, in order (non-transactional only):

1. **Quality halt** — latest `wabaHealth`: LOW → block all non-transactional;
   MEDIUM/UNKNOWN → block Marketing only. → `blocked_quality`
2. **Global opt-out** — active `optOuts` row for the phone. → `blocked_optout`
3. **Retailer kill switch** — `retailerSendingLimits.pausedAt` set. → `blocked_retailer_paused`
4. **Caps** — burst (30/5min) + tiered daily, via the rate-limiter. → `blocked_capreached`

A blocked send **returns without throwing** (so a caller's catch/fallback doesn't
re-send the blocked message) and writes a `blocked_*` row. A genuine Meta failure
on an inline send still throws (preserving each caller's fallback) and logs
`failed`; on the durable path below, the failure is retried instead.

## Durable retry for transactional sends (ClickUp `86ey5dz0a`)

A transient Meta failure (429 / 5xx / network blip) used to silently drop the
buyer's message — the notify actions logged `failed` and moved on. Transactional
sends are now **durably retried** via the official
[`@convex-dev/action-retrier`](https://www.convex.dev/components/retrier)
component (registered in `convex.config.ts`, configured in
`convex/lib/actionRetrier.ts`).

**Policy: 5 attempts total** (1 + `maxFailures: 4` retries) with exponential
backoff + jitter (~250ms → 500ms → 1s → 2s). Retries are scheduled through the
database, so they survive action crashes; no always-on infra.

**The retry unit is ONE Meta HTTP delivery, never the gating.** The guarded
sender's default transactional path calls one mutation,
`enqueueTransactionalSend`, which atomically:

1. runs the same `decideSend` gate as `canSend` (once — a retry can never
   replay a gating decision or re-consume rate-limit tokens),
2. enqueues `deliverTransactional` (an action whose **only** throw path is the
   Meta call itself — so a "Meta accepted it but a later step failed" replay
   cannot double-send), and
3. inserts the audit row as **`pending`** with the retrier `runId`.

When the run settles, the `onDeliverComplete` callback patches that same row to
its terminal `sent` / `failed` (+ last error) — **one `outboundMessageLog` row
per message, never one per attempt**. A lingering `pending` row means a run is
in flight (or, pathologically, that its callback never fired — visible, not
silent).

**What is deliberately NOT durably retried:**

- **Gated categories** (`session_message`, templates) — single inline attempt,
  exactly as before. Replaying them would fight the protection layer:
  `canSend` consumes rate-limit tokens as a side effect, and a kill-switch /
  opt-out decision must not be re-evaluated per attempt.
- **Ordered / fallback sequences** — `sendPaymentMessage` (confirm reply,
  payment-due, counter pay-later) and the mockup CTA→text degradation need
  `await`-with-throw semantics the fire-and-forget component can't give
  (message order across separate runs isn't guaranteed, and `.send()` resolving
  at enqueue would break throw-driven fallbacks). These construct their sender
  with `{ retry: false }` and get **bounded inline retries** instead
  (`withInlineRetries`, `convex/lib/retry.ts`: 3 attempts, 250ms/500ms), then
  rethrow — same caller-visible contract as before, just more resilient.

Caller-visible semantics on the durable path: `.send()` resolving means
**enqueued** (with retries behind it), not confirmed-delivered — e.g. the
order-document "sent" state and the founding-welcome stamp now mark hand-off.
The transient receipt/invoice blob is held 10 minutes, comfortably beyond the
full backoff window, so a retried document send never fetches a deleted blob.

Tests: `convex/wabaProtection.test.ts` ("durable transactional retry") — note
tests asserting on durable sends must register the component
(`@convex-dev/action-retrier/test`) and drain via
`t.finishAllScheduledFunctions(vi.runAllTimers)` under fake timers enabled
**before** anything schedules.

## Per-retailer caps

`convex/lib/wabaLimits.ts` → `resolveSendingLimits`:

| | First 30 days | After 30 days |
| --- | --- | --- |
| Starter | 50/day | 50/day |
| Pro | 50/day | 200/day |
| Scale | 50/day | 500/day |
| Burst (all) | 30 / 5-min | 30 / 5-min |

New accounts are floored to 50/day regardless of tier — the anti-abuse ramp.
Admin overrides (`retailerSendingLimits.dailyCap` / `burstCap5min`) win. Enforced
via `@convex-dev/rate-limiter` with **inline config** per call (keyed by
retailerId) — deliberately *not* pre-registered in `lib/rateLimiter.ts`, since the
component only allows inline overrides for unregistered names.

## Cross-retailer opt-out

Inbound **STOP / BERHENTI / UNSUB** (exact match, EN+MS) → a **global** `optOuts`
row suppressing non-transactional sends to that phone across the *whole* shared
number. **START / MULA** re-opts-in (`reactivateOptIn` stamps `reactivatedAt`).
Handled in `handleInbound` before any other intent; the ack reply is
`transactional` so it isn't suppressed by the opt-out it's confirming.

Opt-out rows are keyed on the **canonical (digits-only) phone** via
`normalizeWaPhone`, on both write (`registerOptOut`/`reactivateOptIn`) and read
(`isOptedOut`). Stored numbers already normalize through `assertValidWaPhone`, but
keying the opt-out itself on the canonical form means a STOP suppresses later
sends even if some future write path stores a `+`/spaced number — opt-out
compliance never silently depends on every caller having normalized first.

## WABA health webhooks (auto-throttle)

Meta posts health changes to the **same** webhook URL as inbound messages, keyed
by the change `field`. Parsed in `convex/lib/wabaWebhook.ts` → `recordWabaHealth`
appends a `wabaHealth` history row; `canSend` reads the latest. Event mapping:
quality `FLAGGED`→LOW, `DOWNGRADE`→MEDIUM, `UNFLAGGED`/`UPGRADE`/`ONBOARDING`→HIGH;
severe `account_update` (restrict/ban/violation/disable)→LOW; benign account
updates emit nothing.

> Recovery today is "latest event governs" (a HIGH event lifts the halt). A
> 24h-sustained-recovery refinement is noted but deferred — Meta quality events
> aren't frequent enough for flapping to matter pre-Broadcast.

**⚠️ Subscribe these fields in the Meta App dashboard** (App → WhatsApp →
Configuration → Webhook fields) — it's a dashboard toggle, **not** code:
`phone_number_quality_update`, `account_update`, and `message_template_status_update`
(the last is for the templates ticket; we log-and-ignore it here). The repo
previously relied only on the `messages` field.

## Alerts

A non-GREEN health change schedules `sendWabaAlert` → email via the existing
Resend path to `ADMIN_ALERT_EMAIL` (falling back to `EMAIL_FROM`, so no new config
required). A paused retailer is emailed via `notifyRetailerPaused`, and sees a
**non-dismissable dashboard banner** (`SendingPausedBanner`, `src/routes/app.tsx`)
that makes clear order messaging is *not* affected — discoverability for an
otherwise invisible flag.

## Operating it

**Admin UI (non-dev operators):** `/app/admin/waba` ("WABA Safety" in the admin
nav, Clerk-allowlist gated via `ADMIN_USER_IDS`). Search a vendor → Pause/Resume
with a **reason-required confirmation modal**; a WABA-health banner up top
(degrades gracefully to "no Meta health updates yet" until the webhook fields are
subscribed). Backed by `adminListVendors` / `adminPauseRetailer` /
`adminResumeRetailer` / `adminGetWabaHealth`. This is the first slice of the Admin
Console ticket `86ey25er1`; cap-editing + full send-log live there.

**CLI (dev / scripts):**
```bash
npx convex run wabaProtection:pauseRetailer  '{"retailerId":"<id>","reason":"spam"}'
npx convex run wabaProtection:resumeRetailer '{"retailerId":"<id>"}'
npx convex run wabaProtection:getWabaHealth
npx convex run wabaProtection:listRecentOutbound '{"retailerId":"<id>"}'
```

## Schema (`convex/schema.ts`)

`optOuts` (global, by_phone) · `wabaHealth` (history, by_observed) ·
`retailerSendingLimits` (kill switch + cap overrides, by_retailer) ·
`outboundMessageLog` (audit, by_retailer_sent + by_phone_sent + by_run;
durably-retried sends add a `pending` status + `runId`, patched terminal on
completion — see the durable-retry section).

## Env vars

| Var | Required | Purpose |
| --- | --- | --- |
| `ADMIN_ALERT_EMAIL` | no | health-alert recipient (falls back to `EMAIL_FROM`) |

(`WHATSAPP_*` send creds are unchanged from the existing send path.)

## Tests

- `convex/lib/wabaLimits.test.ts` — caps ramp/tiers, category policy, opt-out keywords.
- `convex/lib/wabaWebhook.test.ts` — health-event mapping.
- `convex/wabaProtection.test.ts` — category gating (transactional always sends;
  session blocked on pause/opt-out/quality/cap), opt-out lifecycle, health history,
  end-to-end (paused transactional still sends; opted-out session suppressed
  pre-Meta; STOP registers + acks), and durable retry (transient→retried→sent
  with one row; permanent→5 bounded attempts→one failed row; session never
  retried; inline-retry helper contract).

## Acceptance ↔ implementation (real-now core)

- *Pause a single seller in one action* → `pauseRetailer` + banner + retailer email.
- *Paused/blocked sends never reach Meta* → `canSend` returns before `adapter.send`; logged `blocked_*`.
- *Cross-retailer STOP honoured everywhere* → global `optOuts`, checked in `canSend`.
- *Quality webhook captured + auto-throttle* → `recordWabaHealth` + `canSend` quality gate.
- *Default per-seller caps enforced* → tiered/ramped inline rate-limiter.
- *Per-send audit* → `outboundMessageLog`.
