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
| `transactional` | the order's **one** outbound message (storefront confirmation template, or the counter-order confirmation), the free-form confirm reply to an inbound `ORD-`, founding welcome, diagnostics | **No** — always sends (core promise) |
| `session_message` | generic inbound replies (unknown fallback, store-QR acks, opt-out acks) | Yes |
| `utility_template` / `marketing_template` | the confirmation push logs as `utility_template` + template name (per-template cost accounting); `marketing_template` reserved for Broadcast | Yes |

> **The `transactional` row shrank hard (2026-08-04,
> [`86eyd63r8`](https://app.clickup.com/t/86eyd63r8)).** It used to read "order
> confirm, status updates, payment received, mockup, counter order…" — and that
> list is now, almost exactly, the list of sends that were **deleted**. An order
> sends the buyer exactly one WhatsApp message; status updates, payment-received
> pings, mockup notices, payment prompts, both payment reminders, the counter
> receipt PDF and the Lalamove POD photos are gone. See
> [`one-message-per-order.md`](./one-message-per-order.md).
>
> **"One message" is enforced by code structure, not by this gateway.** The
> confirmation is `transactional`, so it bypasses `canSend` entirely — the caps,
> kill switch, opt-out and quality halt never see it and could never have
> counted it. The only thing preventing a second send is that there is no second
> `wa.send` call site left, plus the `pushOwnsTheMessage` guard on inbound `ORD-`
> replies (`convex/whatsapp.ts:554`). Do not reach for the rate limiter to
> enforce message budgets: an order message that a cap could block is an order
> message that can silently fail to reach a paying buyer, which is the exact
> trade this category policy exists to refuse.

**Consequence to keep in mind:** pre-Broadcast, the surviving traffic is almost
entirely transactional, so the kill switch + caps mostly govern session replies
*today* and become fully load-bearing once Broadcast ships — which is exactly the
boundary we drew. The opt-out, quality auto-throttle, and audit log are valuable
immediately, and the audit log matters more than ever now that every logged row
is a **billable** message from 1 Oct 2026.

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
still throws (preserving each caller's fallback) and logs `failed`.

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

**The ack says out loud that order updates keep coming**, in both languages —
the confirmation for an order the buyer placed is `transactional` and bypasses
this gate by design (the category table above), so a buyer told only "you're
unsubscribed" who then receives one reasonably concludes the STOP failed. The
BM half omitted that sentence until `86eyn25gu`. Same reason the manual panel
spells it out: post-`86eyd63r8` the confirmation is the buyer's *only*
automatic message, so an opt-out has almost no visible buyer-side effect today
— what it actually suppresses is session replies now and Broadcast later.

Opt-out rows are keyed on the **canonical (digits-only) phone** via
`normalizeWaPhone`, on both write (`registerOptOut`/`reactivateOptIn`) and read
(`isOptedOut`). Stored numbers already normalize through `assertValidWaPhone`, but
keying the opt-out itself on the canonical form means a STOP suppresses later
sends even if some future write path stores a `+`/spaced number — opt-out
compliance never silently depends on every caller having normalized first.

### Manual opt-out (admin, 2026-08-17, ClickUp 86eyn25gu)

The keyword path only serves buyers who text the shared number themselves — a
counter buyer whose number the cashier typed has no self-serve way to withdraw
consent (PDPA audit finding L3). The Admin Console's WABA page now carries a
**Manual opt-out** panel: type a number → live status (`adminOptOutStatus`) →
one button that either opts it out (`adminRegisterOptOut`, the first caller of
the `manual_admin` source declared in the schema from day one) or re-activates
it (`adminReactivateOptIn`). Same scope as a STOP; idempotent both ways.

**Input is canonicalized to the international form the send gate keys on**
(`60…`, `65…`, `44…` — PR #191 review). Every key the send gate checks is
international (Meta's inbound `from`, checkout/counter numbers), so an opt-out
keyed on a bare local-digits strip would never match `isOptedOut` and fail
silently while the panel claimed otherwise. Input that reads as no number (an
MY landline, a partial number, letters) disables the button with a reason
instead of registering an unmatchable key; canonicalization also keeps
buyer-texted `START` able to undo an admin opt-out (one key, both paths —
pinned by test).

**Any country since [`z8r3fdh274`](https://app.clickup.com/t/z8r3fdh274).**
Buyers can give a WhatsApp number from any country
([`phone-numbers.md`](./phone-numbers.md)), and anyone can text STOP to the
shared number, so an MY/SG-only panel could neither register a foreign
buyer's opt-out nor undo a foreign STOP. This is the one buyer-number field
with **no retailer behind it and no picker beside it**, so
`readOptOutPhone` (`convex/lib/optOutPhone.ts` — pure, shared by the server
and the panel, which used to hand-copy the rejection message) first cleans the
input exactly as every buyer field does (`cleanPhoneInput`,
`convex/lib/phoneDial.ts`): invisible bidi marks — which WhatsApp and the
contacts app wrap a copied number in, and which hid a leading `00` from the
international arm — are removed, and full-width or script digits (`٠١٢…`,
`０１２…`) are mapped to ASCII instead of being dropped by the strict arms'
non-digit strip. So a number pasted out of a chat keys like the same number
typed. Then it tries fixed arms, most specific first:

1. **MY strict**, 2. **SG strict** (`assertValidMobileForCountry`) —
   byte-identical to the MY/SG panel, so every existing key is unchanged: every
   local spelling (`012-345 6789`, `9123 4567`, `60…`, `+65…`) keys as before
   and a landline is refused. The two are disjoint (MY mobiles start `1`, SG
   `8`/`9`).
3. **An explicit international prefix** (`+44 …`, `0044 …`) → the buyer
   parser (`parseBuyerWaPhone`) under the TYPED code's country, so the key is
   exactly the digits a buyer's checkout stores and Meta delivers. A `+60`/`+65`
   lands back on the strict arm in there, which is why `+60 3-1234 5678` is
   still a landline.
4. **Bare digits** (`447911123456`) → parsed as if typed with a `+` — the form
   the register's Copy button hands back, so a copied row round-trips. A
   `60…`/`65…` routes back to the strict arm that already refused it.

Arms 3–4 run only after 1–2 refuse, so they never re-key a number the panel
already accepted. What they cost is the old "no input satisfies two arms"
guarantee: a mistyped number can now read as a real foreign one
(`61234567890` is an Australian mobile). So **the status line names the country
it read the number as** — *"This United Kingdom (+44) number is not currently
opted out."* — before anything is registered. Country only, never digits. The
rejection copy (`OPT_OUT_PHONE_MESSAGE`) is built from the strict arms' own
kinds and examples plus the any-country rule, and a test pins that every
example it shows is accepted.

**Status and Re-activate also look the typed digits up VERBATIM** when the
canonical key finds nothing (`findLiveOptOut`). A STOP is keyed on whatever
Meta delivered (`registerOptOut` → `normalizeWaPhone`), and for a few countries
that `wa_id` is a form no parser produces — Mexico's legacy `521…` mobile
prefix — so the register could list a row the canonicalizer can't reach, and
that row's **Re-activate** (which sends the row's own digits back) threw "enter
a valid number" at the admin. Before z8r3fdh274 that was every non-MY/SG STOP
row. The verbatim lookup only ever FINDS an existing row: **registering still
demands a canonical number**, so an unmatchable key is never written. The audit
entry takes its last four digits from the row's own key.

**The register lists who is currently opted out** (`adminOptOutList`), because
the lookup field structurally cannot: it answers "is THIS number opted out?"
and you have to know the number first, so "who is opted out?" — the question a
PDPA request actually asks — had no answer, and an admin could not confirm
their own opt-out registered without retyping it. The vendor rows already show
a 30-day opt-out *count*, so the data was teased and then unreachable.

Rows come off a new **`optOuts.by_active` index keyed on `reactivatedAt`**:
opting back in stamps that field rather than deleting the row, so the live set
is exactly the rows where it is absent, and re-activations that accumulate
forever can never crowd a live row out of a bounded newest-first scan. The
table underneath stays the **consent ledger** — when consent was withdrawn and
when it was restored — which is why re-activating removes a row from the list
and from nothing else.

Numbers render **masked to last-4**, like the status line and the audit log:
session replay captures rendered text, and a list paints many at once. The full
number rides in the payload for the row's Copy action, which never paints it.
The list renders at zero too, with the empty state explaining what would appear
there — it is the only place this feature announces itself.

Every manual action is audited via **`logGlobalAdminAction`** — a new
`adminAuditLog` shape with **no `retailerId`** (the field widened to optional),
because the opt-out is global to the shared number, not a store action. The
audit `targetId` carries the phone's **last four digits only**: the audit log
has no retention, so a full phone must never land in it — the `optOuts` row
holds the full number for correlation. Pinned by test in
`wabaProtection.test.ts` ("admin manual opt-out").

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
`phone_number_quality_update`, `account_update`, and the three template fields
below. The repo previously relied only on the `messages` field.

## Template lifecycle webhooks (ClickUp `z8r3fddtkh`)

We run six Meta-approved utility templates (buyer confirm push, payment
reminder, claim link, three seller alerts — the registry is
`configuredTemplates()` in `convex/lib/whatsapp.ts`). Meta can change any of
them **after** approval, and from 1 Oct 2026 the category is the only thing
that sets the per-send price (utility RM 0.0564 vs marketing RM 0.3467 — 6.1×).
Before this, the handler explicitly ignored template events; the first sign of
a recategorised template would have been the invoice.

Parsed in `convex/lib/wabaTemplateWebhook.ts` (pure, no Convex imports) from
the same webhook, keyed by `field`:

| Field | What it says | Pages ops when |
| --- | --- | --- |
| `message_template_status_update` | `APPROVED` / `REJECTED` / `PAUSED` / `DISABLED` / `PENDING_DELETION` / … | REJECTED, PAUSED, DISABLED, PENDING_DELETION, FLAGGED — every send naming the template now fails outright |
| `template_category_update` | `previous_category` → `new_category` | the template **leaves** UTILITY / AUTHENTICATION / SERVICE (the 6.1× case; an appeal window opens). Winning an appeal back is recorded, not alerted |
| `message_template_quality_update` | `GREEN` / `YELLOW` / `RED` | YELLOW or RED — Meta's warning before it pauses |

**Two things the panel has to get right, both found by rendering it against
real webhook data:**

- **Meta never announces the category a template was approved under** — only
  the ones it *changes*. Left honest, the "billed as" chip would read
  `unknown` for ever on every healthy template, which is the panel's headline
  column permanently blank. Every template we register is a utility one (each
  send goes out under `utility_template`), so a **configured** template reads
  **`UTILITY (assumed)`**, muted rather than green because we were told
  nothing; a real category event always beats the assumption, and a template
  we do *not* configure stays `unknown`. Rules + truth table:
  `src/lib/waba-template-chips.ts`.
- **Languages are discovered, not assumed.** `en` and `ms` always show (the two
  `TEMPLATE_LANGUAGE` can ask for), and any other language code Meta reports
  is rendered alongside them, so an event under a locale we never send is
  surfaced rather than recorded and silently dropped.
- **No chip is ever derived from a scan with a shared budget.** The three
  kinds arrive at very different rates — quality events are the chatty ones,
  and a Meta retry re-inserts — so a shared page budget lets the noisy kind
  bury the others: 200 quality rows would hide an older `PAUSED` and an older
  `UTILITY→MARKETING`, and the panel would render a paused, marketing-billed
  template as healthy utility, with the `(assumed)` fallback asserting a fact
  it holds contrary evidence for (found in PR #267 review). Each chip is one
  indexed `.first()` on **`by_template_kind`**, and languages are found by
  walking `by_template` downwards one single-document read at a time, so
  neither a noisy kind nor a noisy language can starve anything. Cost per
  template is ~9 single-document reads, not a 200-row page.

Every event is persisted to **`wabaTemplateEvents`** (`recordTemplateEvent`);
alerting ones schedule `sendWabaTemplateAlert` → email to `ADMIN_ALERT_EMAIL`
(fallback `EMAIL_FROM`) naming the template, the change and the fix
(appeal / re-submit / review copy). The admin console
(`/app/admin/waba` → **Message templates**, `adminListTemplates` — the LAST
section on the page, below the vendor list and the opt-out register: it is
reference state an operator consults, not one of the two things they came to
do) shows each
configured template per language with its newest **status · billed-as ·
quality**, lists env vars that are *unset* as "not configured" so a silent
send path is visible, surfaces templates Meta mentions that we don't
configure, and keeps the last 20 raw events under a disclosure. Its empty
state says which three fields to subscribe.

**Testing it without waiting for Meta:** `node scripts/dev-template-webhook.mjs
<scenario> [template] [language]` fires a correctly *signed* event at the
deployment, so it exercises verify → parse → row → alert exactly as Meta
would. `approved` / `pending` / `restore` / `quality-ok` are silent;
`paused` / `disabled` / `downgrade` / `quality-red` alert **and send a real
ops email**. Sits beside the existing Lalamove and Delyva webhook simulators.

**Retention:** 90 days (`purgeExpiredWabaTemplateEvents`, 04:20 UTC daily), but
the newest row per (template, language) is always kept — Meta posts only on
change, so a healthy template may go a year between events. The sweep advances
an `observedAt` cursor instead of re-reading from the start and stopping once a
page deletes nothing: a page can legitimately be all keep-rows, and stopping
there would strand genuinely expired rows behind them (PR #267 review).
Termination comes from the moving window, not from having deleted something.

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

`optOuts` (global, by_phone + by_created) · `wabaHealth` (history, by_observed) ·
`wabaTemplateEvents` (per-template history, by_observed + by_template) ·
`retailerSendingLimits` (kill switch + cap overrides, by_retailer) ·
`outboundMessageLog` (audit, by_retailer_sent + by_phone_sent + by_sent) ·
`messageLogRollups` (permanent monthly cost-ledger aggregates).

**Retention:** `outboundMessageLog`, `wabaHealth` and `wabaTemplateEvents` are
purged on a 90-day window (the outbound log rolls up into `messageLogRollups`
first; the newest health row, and the newest row per template, are always
kept); `optOuts` is **never** purged — see
[`docs/data-retention.md`](./data-retention.md) for the full policy table.

## Env vars

| Var | Required | Purpose |
| --- | --- | --- |
| `ADMIN_ALERT_EMAIL` | no | health-alert + template-alert recipient (falls back to `EMAIL_FROM`) |
| `WHATSAPP_PAYMENT_REMINDER_TEMPLATE` | no | the seller's manual payment reminder as a utility template (unset ⇒ free-form, best-effort) — see [`payment-reminder.md`](./payment-reminder.md) |

(`WHATSAPP_*` send creds are unchanged from the existing send path.)

## Tests

- `convex/lib/wabaLimits.test.ts` — caps ramp/tiers, category policy, opt-out keywords.
- `convex/lib/wabaWebhook.test.ts` — health-event mapping.
- `convex/lib/wabaTemplateWebhook.test.ts` — template status/category/quality
  parsing + the alert truth table; `convex/wabaTemplateEvents.test.ts` — signed
  webhook → row → ops email, the admin per-template view (including a language
  we never send), keep-the-newest purge; `src/lib/waba-template-chips.test.ts`
  — chip tone/label rules, including the assumed-utility case.
- `convex/wabaProtection.test.ts` — category gating (transactional always sends;
  session blocked on pause/opt-out/quality/cap), opt-out lifecycle, health history,
  and end-to-end (paused transactional still sends; opted-out session suppressed
  pre-Meta; STOP registers + acks).

## Acceptance ↔ implementation (real-now core)

- *Pause a single seller in one action* → `pauseRetailer` + banner + retailer email.
- *Paused/blocked sends never reach Meta* → `canSend` returns before `adapter.send`; logged `blocked_*`.
- *Cross-retailer STOP honoured everywhere* → global `optOuts`, checked in `canSend`.
- *Quality webhook captured + auto-throttle* → `recordWabaHealth` + `canSend` quality gate.
- *Default per-seller caps enforced* → tiered/ramped inline rate-limiter.
- *Per-send audit* → `outboundMessageLog`.
