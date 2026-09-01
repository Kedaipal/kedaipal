# Subscription auto-renewal + Pay-now — HitPay on Kedaipal's own account

**ClickUp:** [`86eyb6z4r`](https://app.clickup.com/t/86eyb6z4r) · **Status:** built, sandbox verification pending
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
| Salt | `HITPAY_BILLING_SALT` (env) | seller's stored salt (orders) / `HITPAY_BILLING_SALT` (invoices) |
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
| `HITPAY_BILLING_SALT` | The matching webhook salt |

**Both or nothing.** Absent ⇒ every surface (Pay-now, auto-renewal, plan
picker) quietly stays hidden and manual billing renders byte-identical to
before — fail-open-to-manual. These are **deployment env**, never a table:
`billingConfig` is readable by every signed-in seller via
`paymentInstructions`, so a platform secret can't live there.

Also: the V2 events must be **registered in HitPay's dashboard** (Developers
→ Webhook Endpoints → `<CONVEX_SITE_URL>/webhook/hitpay`, select the four
recurring/charge events) — the salt shown there is `HITPAY_BILLING_SALT`.

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
