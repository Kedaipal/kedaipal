# Founder Weekly Business Report — Design

**Status:** approved, not yet planned/implemented.
**Owner:** Arif (founder/CTO).

## Purpose

Arif has no way today to see Kedaipal's own business health (MRR, active
stores, churn, signups) without hand-assembling it once a month for the
`kedaipal-monthly-review` deck (which itself requires a manual screenshot of
the `retailers` table). This adds a lightweight, automatic weekly snapshot:
Convex computes the real numbers, a scheduled agent turns them into a short
readable doc filed for Arif to open when he wants — no push, no login, no
manual screenshot.

This is explicitly **platform-wide** (Kedaipal's own business), not a
per-retailer seller report — that's the existing `/app/insights` feature and
is untouched by this work.

## Why not the existing `convex` MCP server

The project's `.mcp.json` already runs the stock `npx convex mcp start`
server. It's the right tool for interactive dev/debugging (which is what this
whole design session used it for), but it can't be the transport for this
report:

- The `prod` deployment is marked `readOnly` by the MCP server itself —
  `data`, `run`, `runOneoffQuery`, and all mutating tools are rejected on it;
  only `tables`/`functionSpec`/`insights` work. There is no real-data read
  path to prod through this server today.
- Even where it isn't blocked, `run` can invoke *any* function with admin
  rights. A weekly report only ever needs five aggregate numbers — handing a
  scheduled routine the same access an interactive dev session has is a much
  bigger blast radius than the task requires.

A future **custom Kedaipal MCP connector** (narrow, tenant/report-scoped
tools, discussed earlier in this session) is a reasonable follow-up once
there's more than one use case for it, but is out of scope here — this report
does not need one to exist.

## Approach

Three options were weighed:

- **A — Route through the existing Convex MCP against prod.** Ruled out per
  the section above (blocked today, and wrong shape even if it weren't).
- **B — A small signed Convex HTTP endpoint (chosen).** One new route in
  `convex/http.ts`, protected by a shared-secret header — the same pattern
  already used for the HitPay/Lalamove/WhatsApp webhook verification in this
  codebase. It runs an internal aggregation query and returns only the
  report's numbers: no PII, no order-level detail, no write capability.
- **C — A Convex-native cron does everything server-side, no agent.** Most
  robust (survives even if Claude Code is never opened that week), but
  Convex code can't produce the readable weekly narrative the way an agent
  can — Arif explicitly wants a generated doc, not raw numbers.

**B** keeps Convex as the sole source of truth for the numbers (tested,
versioned, reviewable code) while letting a scheduled agent do the part it's
actually good at: turning numbers into a short written takeaway.

## Metrics computed

All computed **live** at request time from existing tables — no new Convex
schema, no snapshot table. Trend-over-time is provided by the *output file*
(each week's row/doc), not by server-side history.

| Metric | Definition |
|---|---|
| MRR, **per currency** | For each `subscriptions` row where `status === "active"` **and `comped !== true`**, take that retailer's most recent `paid` invoice and reduce its `total` to a monthly equivalent (`total ÷ months in [periodStart, periodEnd]`). Sum **separately per `invoice.currency`**; never blend MYR and SGD into one figure. See "Why MRR reads invoices" below. An active subscription with no paid invoice is counted in a `activeWithoutPaidInvoice` field rather than silently contributing 0. |
| Subscription counts by status | `trialing` / `active` / `past_due` counts of `subscriptions`, via the existing `by_status` index. |
| New signups this week | `retailers` with `createdAt` in the last 7 days (MYT week boundary, matching the rest of the codebase's MYT-midnight convention — see `convex/lib/fulfilmentDate.ts` for the existing pattern to reuse). |
| Founding slots | Taken + remaining, from the existing `foundingMembers.getSpotsRemaining` (already live, already tracked by hand in the monthly deck). |
| Order volume this week | Count + GMV of orders across all retailers in the last 7 days. `orders` has **no cross-retailer time index** (every index is `by_retailer`-prefixed), so this reads Convex's system `by_creation_time` index — a *different* shape from `analytics.getInsightsRange`, which is `by_retailer`-scoped and skew-widened. Bounded scan with an explicit `capped` flag in the response, same discipline as Insights. Excludes `pending`/`cancelled` orders, matching the existing Insights revenue convention (`docs/insights.md`), so abandoned checkouts can't inflate the count. |

### Deliberately NOT reported: churn

`subscriptions.cancelledAt` is **never written anywhere in the codebase**, and
`status: "cancelled"` is never set by any mutation — it exists only as a member
of the type union (`convex/subscriptions.ts`). Manual billing v1 flips a lapsed
subscription `trialing`/`active` → `past_due` via the daily cron and never
reaches `cancelled`.

A "churned this week" metric would therefore print `0` every week forever and
read as good news. That is worse than an absent metric. The truthful signal
available today is the **`past_due` count**, which the cron genuinely
maintains; its week-over-week movement comes from the report file, not from
the server.

Making churn-over-time measurable would require stamping the moment the cron
flips a subscription to `past_due` (`updatedAt` is not usable — any patch
bumps it). That is a deliberate follow-up, not part of this design, and it
would only start producing data from the day it ships.

### Why MRR reads invoices, not plan constants

`subscriptions` has **no currency field**. Currency is chosen by the admin at
invoice time (`currencyArg ?? "MYR"`, `convex/invoices.ts`) and stored on the
**invoice**. Deriving MRR from `planPrice(plan, cycle, founding)` would
therefore assume MYR for every store, so an SGD store's S$59 would be summed
as RM59.

More fundamentally: a plan constant is a *guess at* what was billed, while the
last paid invoice is the *record of* what was billed. Reading invoices
survives custom amounts, Scale's banded pricing, the founding discount, and
any future price change without drifting from reality.

**Exclusion list:** a small, documented denylist of internal/test retailer
emails (mirrors what Arif already excludes by hand for the monthly-review
deck: `matrep88*`, `kristofer`, unset-email test rows) lives as a named
constant in `convex/lib/businessReport.ts`, not tribal knowledge.

**Comped guard:** the schema defines `comped` as "full access, never charged",
but `markPaid` sets `status: "active"` and never clears the flag. Nothing
writes `comped: true` to the database today (the only occurrence is the
in-memory fail-open descriptor in `convex/subscriptions.ts`), so this is a
manual-dashboard scenario the schema explicitly anticipates for pilot stores.
One predicate closes it, so it is not left to chance.

## Components

- **`convex/lib/businessReport.ts`** (new, pure) — the aggregation logic
  above. No Convex imports at the top level where avoidable, so it's unit
  testable against fixture data without a live deployment.
- **`convex/admin.ts`** — new `internalQuery` wrapping the aggregation.
  `internal`, not public — reachable only from the HTTP route below, never
  from the dashboard's public API surface.
- **`convex/http.ts`** — new `GET /internal/business-report` route.
  Validates a shared-secret header (`X-Report-Secret`) against a new env var
  `BUSINESS_REPORT_SECRET` using a **constant-time compare**, reusing the
  `timingSafeEqual` pattern the codebase already implements three times
  (`convex/lib/whatsappSignature.ts`, `lalamoveSignature.ts`, `hitpay.ts`) —
  a raw `===` would be the odd one out. Returns `401 "invalid signature"` on a
  bad secret and `500 "server misconfigured"` when the env var is unset,
  matching the existing webhook failure shapes in this file exactly. On
  success returns a small JSON object: the metrics above plus the MYT week
  window they cover.
- **`BUSINESS_REPORT_SECRET`** — new env var, **prod only** (`envSet` on the
  prod deployment selector). Dev has no real numbers worth protecting behind
  a schedule, so it isn't set there.

## Scheduling + delivery

A weekly cloud routine (via the `schedule` skill), Monday 9am MYT:

1. Fetch `GET /internal/business-report` on the prod deployment with the
   secret header.
2. Append one row to the existing `05_Marketing/_System/Kedaipal_Metrics.xlsx`
   (reusing the trend-tracking file the `kedaipal-monthly-review` skill
   already maintains, rather than starting a parallel spreadsheet).
3. Write a short `01_Strategy/Kedaipal_Business_Report_YYYYMMDD.md`: this
   week's MRR per currency + delta vs the prior row, active/trialing/past_due
   counts, new signups, founding slots, one-line takeaway.
4. No push — the file is filed for Arif to open when he wants (his explicit
   delivery choice). No email, no WhatsApp send.

The generated doc is Arif-facing prose, so it follows the same house style the
`kedaipal-monthly-review` skill pins: no em-dashes, no Oxford comma, every
metric labelled with the window it covers.

The routine's copy of the secret lives in the routine's own config, never in
the repo or in chat.

## Error handling

- Missing/invalid secret → `401`, no data returned, no partial computation.
- If the aggregation query throws (e.g. a scan hits its bound), the route
  returns `500` with no numbers rather than a partially-computed report —
  the routine should skip that week's file rather than write a doc it can't
  trust, and note the gap in the next week's doc (mirrors the
  `kedaipal-monthly-review` skill's "leave a marked placeholder rather than
  inventing it" rule).

## Testing

- `convex/lib/businessReport.test.ts` (unit, no live deployment needed):
  - MRR reduces monthly and annual invoice periods to the right monthly
    equivalent, including a founding-discounted invoice.
  - **MYR and SGD stay in separate buckets** and are never summed together.
  - An active subscription with no paid invoice lands in
    `activeWithoutPaidInvoice` rather than contributing 0 to MRR.
  - A `comped` active subscription contributes nothing to MRR.
  - MYT week-boundary correctness (a signup exactly at the boundary lands in
    the right week).
  - Denylist accounts are excluded from every count.
  - Order-volume scan respects its bound and surfaces `capped` rather than
    silently under-reporting.

### Verification gap (read before implementing)

There is **no way to validate this against real numbers before deploying**:
the dev deployment has zero `subscriptions` rows (verified 2026-08-23), and
the Convex MCP server marks prod `readOnly`, rejecting `data` /
`runOneoffQuery` there. Unit tests prove the arithmetic, not that it matches
production reality.

The manual check is therefore an ordered gate, not an optional sanity pass:

1. Deploy the route to prod and set `BUSINESS_REPORT_SECRET`.
2. Call it once by hand with the secret header.
3. Reconcile every figure against the Convex dashboard by eye (subscription
   counts by status, the paid-invoice totals behind MRR, retailer count).
4. Only once those agree, wire the weekly schedule.

## Out of scope (this design)

- Any in-app admin page — Arif chose a generated doc over a dashboard
  surface.
- A snapshot/history table in Convex — the weekly doc/spreadsheet row *is*
  the history.
- Per-retailer reporting — that's the existing `/app/insights` feature.
- A custom Kedaipal MCP connector — noted as a reasonable later addition,
  not required for this report to work.
- Churn over time — blocked on there being no cancellation flow at all (see
  "Deliberately NOT reported: churn"). The enabling change is a
  status-change stamp in the daily billing cron.

## Review log

**2026-08-23, self-review against the codebase.** The first draft specified
two metrics this schema cannot truthfully produce, both caught by reading the
code rather than the spec:

- "Churned this week" would have been permanently `0` (`cancelledAt` is never
  written; `status: "cancelled"` is never set). Removed, with `past_due`
  reported instead.
- MRR derived from `planPrice()` would have silently counted an SGD store's
  S$59 as RM59 (`subscriptions` has no currency field; currency lives on the
  invoice). Rewritten to read paid invoices, per currency.

Also corrected: a comped-store revenue guard, a false claim that the
cross-retailer order scan matches `analytics.getInsightsRange` (it cannot —
no cross-retailer time index exists), a raw secret compare where the codebase
already uses `timingSafeEqual`, and an under-stated verification gap.

**2026-08-24, superseded at implementation.** Two changes above what this spec
says, both from reading the billing code more closely:

- **`past_due` splits FOUR ways, not "report past_due only".** A row can be
  `past_due` with a pending invoice **not yet due** — reached exactly when Arif
  issues the renewal for a lapsed store, since `issueInvoice` deliberately does
  not touch the subscription and only `markPaid` clears `past_due`. Filing that
  as churn would manufacture a lost customer precisely when the right action was
  taken. Buckets are now: lapsed customer / awaiting payment / awaiting your
  invoice / trial expired.
- **The exclusion denylist must not include "unset email".** This spec listed
  "unset-email test rows". `notifyEmail` is optional and independent of the
  Clerk auth email, so that rule would silently drop real paying retailers from
  MRR and GMV. Replaced by an `ADMIN_USER_IDS` membership check (self-healing)
  plus an email-fragment match and an explicit slug list, with the exclusion set
  surfaced in the payload for auditing.

Delivered scope also adds prod-readable Convex MCP
(`--cautiously-allow-production-pii`), which turns this spec's "reconcile
against the dashboard by eye" gate into an independent recomputation.
See [`docs/founder-business-report.md`](../../founder-business-report.md).
