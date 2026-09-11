# Subscription auto-renewal + Pay-now — HitPay on Kedaipal's own account

**ClickUp:** [`86eyb6z4r`](https://app.clickup.com/t/86eyb6z4r) · **Status:** built; sandbox-verified end-to-end on MY (TnG) and SG (PayNow) — V2 event verification pending the endpoint secret
**Files:** `convex/lib/hitpayBilling.ts` (pure), `convex/subscriptionPayments.ts` (actions/queries), `convex/invoices.ts` (settle core + self-serve + renewal issuance), `convex/subscriptions.ts` (cron), `convex/http.ts` (webhook branches), `convex/billingEmail.ts` + `convex/lib/billingEmailCopy.ts` (emails), `src/components/settings/{billing-tab,auto-renewal-card,plan-picker-card}.tsx`, `src/routes/app.admin.billing.tsx`

## What it is

Sellers pay Kedaipal without a founder in the loop, on two rails that both
funnel into the ONE settle path (`settleInvoicePaid` — the exact code the
admin mark-paid flow uses, founding claim included):

1. **Pay-now** — every issued invoice mints a one-off HitPay payment request
   against **Kedaipal's own HitPay account**; the hosted-checkout URL is a
   green button in the billing tab and in the issue/reminder/overdue emails.
   The v1 completion webhook (or the seller landing back on the billing tab —
   `verifyInvoicePayment`, the lost-webhook safety net) settles it.
2. **Auto-renewal** — the seller authorises a **card or Touch 'n Go wallet
   once** (`save_payment_method=true` recurring-billing session); each renewal
   the daily cron issues is then charged merchant-initiated
   (`POST /v1/charge/recurring-billing/{id}`) for the **invoice total** —
   never a cached plan amount, so founding discounts and plan changes are
   always right.

Plus the piece the ticket assumed already existed and didn't: **the daily cron
now auto-issues renewal invoices** (`invoices.internalIssueRenewalInvoice`).
The old behaviour locked an active seller whose period lapsed with no pending
invoice (because Arif hadn't typed one); the machine now writes the bill
instead, and the seller keeps access through the invoice's normal 14-day
grace. The overdue flip at `dueDate` is still the only lock.

And **self-serve subscribe** (`invoices.subscribeSelf`): a trialing /
past-due / cancelled seller picks Starter or Pro, monthly or annual (framed
"2 months free"), gets an invoice + Pay-now button, pays, done. A
`foundingIntent` store automatically gets its promised founding price;
founding is never otherwise self-selectable — the last slots stay Arif's to
hand out via the admin console, and **manual admin issue/mark-paid is fully
retained** for bank-transfer holdouts.

## Why merchant-initiated charges, not HitPay's plan cycle

- HitPay's scheduled-plan mode bills a **fixed amount on its schedule** —
  wrong the moment a founding discount or plan change applies, and its
  currency support for plans is SGD-documented only.
- Merchant-initiated means **we own amount, timing, retries** — and the
  charge response is **synchronous** (`status: "succeeded"` / not), which is
  the primary success/failure signal because **HitPay ships no
  charge-failure webhook**.
- Structural safety: with no `autoRenew` on the sub, nothing ever charges —
  so "turn off auto-renewal" is guaranteed by local state alone, never
  blocked, never dependent on a remote DELETE succeeding.

## The no-double-charge invariant

A charge action can die between HitPay taking the money and us settling.
Defences, in order:

1. `recordChargeAttempt` stamps `lastChargeAttemptAt` +
   `pendingChargeInvoiceId` **before** the HTTP call.
2. A later run seeing a fresh stamp with no recorded outcome **reconciles
   first**: `GET /recurring-billing/{id}` and compare `times_charged` to our
   `autoRenew.timesCharged`. Remote ahead ⇒ the money is real ⇒ settle with
   `recordedBy = reconciled:<session>:<n>`, never re-charge.
3. Network throws and HitPay 5xx are recorded as outcome **"unknown"** — not
   counted as an attempt, no seller email, retry ~24h later through the
   reconcile guard. Only a definitive decline (2xx-not-succeeded or 4xx)
   counts toward dunning.

## Dunning (Kedaipal-owned)

`AUTO_CHARGE_RETRY_DELAYS_MS` = attempt at period end, retry +2d, retry +5d
(3 attempts total — inside the 14-day invoice grace, sized for "TnG wallet
tops up on payday"). Each decline emails `autoRenewFailed` (Pay-now CTA;
the final one says retries stopped). The pending invoice + Pay-now link is
always the way out; the overdue lock at `dueDate` + its email are unchanged.
A settle **by any rail** (auto-charge, Pay-now, admin mark-paid) clears the
dunning state inside `settleInvoicePaid`.

**Heal-on-attach:** re-authorising while a machine-issued renewal pends (or
while past_due) charges immediately — fixing your card shouldn't wait for
tomorrow's cron. A fresh **self-serve** invoice is deliberately NOT charged
at attach (its Pay-now button is right there; an implicit first charge would
be a surprise).

**Pre-charge notice:** auto-renew sellers get `autoRenewUpcoming` once per
cycle in the 3-day window before `currentPeriodEnd` (amount + method + date +
how to turn it off) — the no-surprise-MIT rule card networks expect.
Deduped by `renewalNoticeSentForPeriodEnd`.

## Webhooks — one route, two schemes

`POST /webhook/hitpay` now discriminates on the **`Hitpay-Signature` header**:

| | V2 events (new) | v1 completion (existing) |
|---|---|---|
| Sender | Kedaipal's account, dashboard-registered | per-request `webhook` param |
| Body | JSON | form-encoded |
| Signature | HMAC-SHA256 over **raw body**, header `Hitpay-Signature` | HMAC over sorted `key+value` concat, `hmac` **field** |
| Salt | `HITPAY_BILLING_WEBHOOK_SALT` — the **endpoint's own** secret (env) | seller's stored salt (orders) / `HITPAY_BILLING_SALT` (invoices) |
| Events | `charge.created`, `recurring_billing.method_attached/detached/subscription_updated` | `status=completed` |

The v1 branch resolves **orders first** (`by_gateway_request` on orders),
then **invoices** (same-named index on invoices). Unknown ids still 200-ack.
Recurring `charge.created` is corroboration only (the sync response settles
first; duplicates no-op); attach/detach/status events maintain `autoRenew`.
Event payload parsing (`extractRecurringEvent`) is deliberately tolerant and
returns null → ack for anything unrecognised.

## Settle idempotency (`invoices.internalSettleFromGateway`)

- pending + amount & currency match → settle through `settleInvoicePaid`
  (founding rank claim runs **through the same path** — no fork; pinned by
  test).
- already paid by the same payment id → duplicate, plain no-op.
- paid another way / voided → **`late_payment`** stamp on
  `invoices.gatewayIssue` (admin console shows "possible double payment"),
  nothing else changes.
- amount/currency mismatch → **`amount_mismatch`** stamp, NO settle (a stale
  link paid after a reissue must not activate the wrong bill).
- Manual `markPaid` / `voidInvoice` on a link-carrying invoice schedules a
  best-effort DELETE of the HitPay request so the dead link stops taking
  money.

## Env vars (Convex deployment)

| Var | Meaning |
|---|---|
| `HITPAY_BILLING_API_KEY` | Kedaipal's own HitPay API key (sandbox `test_`-prefixed; mode inferred like the BYO path) |
| `HITPAY_BILLING_SALT` | The **API-key** salt — signs the per-request v1 completion webhooks |
| `HITPAY_BILLING_WEBHOOK_SALT` | The **registered endpoint's** signing secret — signs the dashboard V2 events. Optional: falls back to `HITPAY_BILLING_SALT`, but on a real account the two DIFFER, and without it every V2 event 401s |

**The first two, both or nothing.** Absent ⇒ every surface (Pay-now, auto-renewal, plan
picker) quietly stays hidden and manual billing renders byte-identical to
before — fail-open-to-manual. These are **deployment env**, never a table:
`billingConfig` is readable by every signed-in seller via
`paymentInstructions`, so a platform secret can't live there.

Also: the V2 events must be **registered in HitPay's dashboard** (Developers
→ Webhook Endpoints → `<CONVEX_SITE_URL>/webhook/hitpay`, select the four
recurring/charge events) — the signing secret shown for THAT endpoint is
`HITPAY_BILLING_WEBHOOK_SALT`, **not** the API-key salt (sandbox-proved).

## Currency + methods

- Session methods per billing currency (`AUTO_RENEW_METHODS`): MYR = `card`,
  `touch_n_go`; SGD = `card` (PayNow can't be tokenised). FPX/DuitNow are
  push-only and never appear.
- A 422 on the full MYR list (TnG cross-border not enabled on the account)
  degrades to card-only with a loud log — never a seller dead-end.
- Renewal/self-serve invoice currency: last **paid** invoice's currency,
  falling back to `BILLING_CURRENCY_FOR_COUNTRY[retailer.country]`.
- `times_to_be_charged=100` is set **explicitly** (HitPay defaults to 1,
  which would kill the second renewal; 100 = documented max ≈ 8 years of
  monthly charges — at exhaustion the charge fails into normal dunning and
  the seller re-authorises).

## Webhooks: TWO mechanisms, TWO secrets (sandbox-proved, 11 Sep 2026)

- **Per-request v1 completion webhooks** — we pass `webhook=<our URL>` when
  minting each invoice payment request, so they need **no dashboard setup** and
  are signed with the **API-key salt** (`HITPAY_BILLING_SALT`), field-concat
  HMAC. This is what settles Pay-now invoices.
- **Dashboard-registered V2 events** (`charge.created`,
  `recurring_billing.*`) — no per-session parameter exists, so registration in
  Developers → Webhook Endpoints is the only way to receive them. They are
  signed with **that endpoint's own secret** (`HITPAY_BILLING_WEBHOOK_SALT`),
  raw-body HMAC-SHA256 hex in `Hitpay-Signature`. Proved the hard way: a real
  `method_attached` verified against *neither* HMAC form of the API salt. The
  var falls back to the API salt when unset, and the rejection log says so.

**The real V2 payload is an ENVELOPE, not the docs' flat object:**

```json
{ "event": "recurring_billing.method_attached",
  "affected_method_id": "…",
  "recurring_billing": { "id": "…", "status": "active", "cycle": "save_card",
    "reference": "<our subscription id>",
    "payment_provider_charge_method": "touch_n_go",
    "default_method": { "payment_provider": "touch_n_go", … } } }
```

The billing id is NESTED and the authorised rail lives in
`payment_provider_charge_method` — the docs-derived reader found neither, which
is why an attach recorded the default "card" for a Touch 'n Go wallet.
`extractRecurringEvent` now reads the envelope first and keeps the flat shape
as a fallback; both forms are pinned by tests carrying verbatim captured
payloads.

**What registration buys** (money flows without it): the true method label, and
detach detection. Without it the redirect reconcile still attaches the method
but cannot see WHICH, and a method removed at HitPay's end is only discovered
when the next charge fails into normal dunning.

## Subscribe = auto-renewal by default (Zaki, 11 Sep 2026)

The plan picker's primary CTA is **"Subscribe to {plan}"** — invoice created,
then straight to HitPay's authorisation page; **attaching the method charges
the open bill immediately** (`applyMethodAttached` schedules the charge for
ANY pending invoice — the authorisation page displayed exactly that amount,
so authorising IS the consent) and every later renewal charges itself. The
Netflix shape: subscribing enrols you; cancelling is the explicit act. This
REVERSED the earlier don't-charge-self-serve-at-attach rule by owner decision.

Two things keep it honest for the Malaysian rails:

- **The escape hatch is first-class, not buried**: "Prefer to pay each bill
  yourself? Get an invoice instead" sits under the CTA, because DuitNow and
  bank-transfer sellers structurally CANNOT tokenise — for them the invoice +
  Pay-now link is the whole product. The opt-in "Turn on auto-renewal" card
  remains for already-active sellers who came in manually.
- The authorisation session shows **the open bill's total** when one exists
  (an annual subscribe shows the annual figure), else the current renewal
  price; `customer_name` carries the store name so HitPay's dashboard lists a
  real customer instead of "N/A".

Sandbox-verified API rules encoded the same day: a save-payment-method
session REJECTS `times_to_be_charged` (so no charge-count ceiling exists on
the tokenised path), and a 422 on `payment_methods` means the account lacks
(some of) our preferred rails — the retry omits the param and lets the
account's own tokenisable set decide.

## Founding price — the 3-month lapse window (Zaki, 3 Sep 2026)

The 30% founding price survives a subscription lapse of up to **3 months**
(`FOUNDING_PRICE_LAPSE_MS`, lib/plans.ts); sit unpaid longer and NEW bills are
at list price. The **rank + badge never revert** (existing rule) — only the
pricing is forfeited. One rule for every automated issuer
(`foundingPricingApplies`): cron renewals, `subscribeSelf`, the auto-renewal
setup display amount and the pre-charge notice all resolve it identically —
the check keys off `isFoundingMember` + the sub's `currentPeriodEnd`, and a
claimed member's never-cleared `foundingIntent` flag deliberately cannot
bypass it (unclaimed intent = the first conversion, no lapse to measure, so
it always qualifies). The **admin issue form keeps its explicit founding
checkbox** — Arif's judgment can override in either direction.

Never enforced silently: the founding ribbon states the condition, and a
lapsed member's plan picker explains why prices read standard
(`billingGatewayAvailable.foundingPricing` / `foundingPricingLapsed` — the
picker must use the server-resolved flag, never client-side `foundingIntent`,
or a lapsed member would SEE the discount while being BILLED list).

At go-live this needs nothing: the current founding cohort is active (inside
the window) so they keep renewing at their price automatically; everyone else
already bills at list.

## Invariants preserved

- **`subscriptions.updatedAt` is the past_due flip moment** (founder report).
  Every new patch (`autoRenew` state, notice stamps, session records) leaves
  it alone; only real status transitions touch it. Pinned by test.
- `markPaid` semantics unchanged (existing suite passes untouched).
- Buyer-gateway code paths (seller BYO) byte-identical.
- Storefront/order pipeline never touched by any of this.

## Sandbox verification checklist (before prod)

1. Set sandbox `HITPAY_BILLING_API_KEY`/`_SALT` on dev, register the webhook
   in the sandbox dashboard.
2. Billing tab → plan picker → invoice → **Pay now** → sandbox checkout →
   invoice flips paid (webhook), receipt email lands.
3. **Turn on auto-renewal** → authorise a test card → attach recorded
   (webhook or return reconcile) → confirmation email.
4. `npx convex run subscriptionPayments:chargeDueRenewal '{"invoiceId":"…"}'`
   against a seeded pending renewal → settles.
5. Verify the **method_attached payload shape** against
   `extractRecurringEvent` (the docs are thin; the parser is tolerant but the
   sandbox is the truth) — adjust the probes if HitPay spells fields
   differently, and confirm whether `times_to_be_charged` is consumed in
   save-card mode.
6. Production: Arif's open HitPay support thread must confirm **TnG
   tokenisation cross-border for MY customers + MYR on the tokenised charge
   path** on the live SG account (86eyb6z2d question set). Card rail works
   regardless.
