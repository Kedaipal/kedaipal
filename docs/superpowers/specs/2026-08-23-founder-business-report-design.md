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
| MRR | Sum over `subscriptions` where `status === "active"` of the monthly-equivalent price: `planPrice(plan, billingCycle, retailer.isFoundingMember)`, annual ÷ 12. MYR only for v1 (no real SGD revenue yet). |
| Active / past_due / cancelled counts | Count of `subscriptions` by `status`, via the existing `by_status` index. |
| New signups this week | `retailers` with `createdAt` in the last 7 days (MYT week boundary, matching the rest of the codebase's MYT-midnight convention — see `convex/lib/fulfilmentDate.ts` for the existing pattern to reuse). |
| Churned this week | `subscriptions` with `status === "cancelled"` and `cancelledAt` in the last 7 days. |
| Order volume this week | Count + GMV of orders across all retailers in the last 7 days, via a bounded indexed scan — same shape as the existing `analytics.getInsightsRange` scan, not a full table scan. Excludes `pending`/`cancelled` orders, matching the existing Insights feature's revenue convention (`docs/insights.md`), so a burst of abandoned checkouts can't inflate the count. |

**Exclusion list:** a small, documented denylist of internal/test retailer
emails (mirrors what Arif already excludes by hand for the monthly-review
deck: `matrep88*`, `kristofer`, unset-email test rows) lives as a named
constant in `convex/lib/businessReport.ts`, not tribal knowledge.

## Components

- **`convex/lib/businessReport.ts`** (new, pure) — the aggregation logic
  above. No Convex imports at the top level where avoidable, so it's unit
  testable against fixture data without a live deployment.
- **`convex/admin.ts`** — new `internalQuery` wrapping the aggregation.
  `internal`, not public — reachable only from the HTTP route below, never
  from the dashboard's public API surface.
- **`convex/http.ts`** — new `GET /internal/business-report` route.
  Validates a shared-secret header (`X-Report-Secret`, compared against a new
  env var `BUSINESS_REPORT_SECRET`) before calling the internal query. `401`
  on missing/invalid secret, mirroring the existing webhook auth failure
  shape in this file. Returns a small JSON object: the metrics above plus the
  MYT week window they cover.
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
   week's MRR + delta vs the prior row, active/churned/new counts, one-line
   takeaway.
4. No push — the file is filed for Arif to open when he wants (his explicit
   delivery choice). No email, no WhatsApp send.

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
  - MRR sums correctly across founding / non-founding / monthly / annual
    mixes.
  - MYT week-boundary correctness (a signup/cancellation exactly at the
    boundary lands in the right week).
  - Denylist accounts are excluded from every count.
  - Order-volume scan respects its bound and doesn't silently under-report
    without surfacing that it was capped.
- One manual integration check during implementation: call the deployed
  route once with `curl`/an authenticated fetch and sanity-check the numbers
  against what the Convex dashboard shows before wiring the schedule.

## Out of scope (this design)

- Any in-app admin page — Arif chose a generated doc over a dashboard
  surface.
- A snapshot/history table in Convex — the weekly doc/spreadsheet row *is*
  the history.
- Per-retailer reporting — that's the existing `/app/insights` feature.
- A custom Kedaipal MCP connector — noted as a reasonable later addition,
  not required for this report to work.
