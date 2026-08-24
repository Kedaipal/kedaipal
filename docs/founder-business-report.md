# Founder Business Report

Kedaipal's **own** weekly numbers: MRR, who lapsed, signups, order volume,
founding slots. Distinct from Seller Insights (`/app/insights`,
[insights.md](./insights.md)), which is a single store's performance — this is
the platform view, and it is for Arif only.

Design spec:
[`docs/superpowers/specs/2026-08-23-founder-business-report-design.md`](./superpowers/specs/2026-08-23-founder-business-report-design.md).

## How it is delivered

A weekly scheduled routine (Monday 09:00 MYT) fetches
`GET /internal/business-report` from the **production** deployment, appends a
row to `05_Marketing/_System/Kedaipal_Metrics.xlsx`, and writes
`01_Strategy/Kedaipal_Business_Report_YYYYMMDD.md`. Nothing is pushed — the
file is filed for Arif to open when he wants.

There is deliberately **no in-app admin page**: this is a founder artefact, not
a product surface.

## The endpoint

`GET /internal/business-report` (`convex/http.ts`), guarded by an
`X-Report-Secret` header compared against the `BUSINESS_REPORT_SECRET` env var.

| Case | Response |
|---|---|
| Env var unset | `500 "server misconfigured"` |
| Missing/wrong header | `401 "invalid signature"` |
| Valid | `200` + the JSON payload |

The env check runs **before** the secret check, matching the webhook routes in
the same file, so a broken deploy can never be mistaken for an auth failure.

Auth is a shared secret rather than Clerk because the caller is an unattended
job with no user session. The secret unlocks exactly one read: there is no
mutation path, and the payload is aggregates only, never buyer or seller PII.

The comparison is constant-time and **hashes both sides first**. The three
signature verifiers elsewhere in the codebase let length short-circuit, which is
safe for fixed-length HMAC digests; here both operands are the raw secret, whose
length is itself secret, so digesting restores that precondition.

**Set the secret on prod only:**

```bash
npx convex env set BUSINESS_REPORT_SECRET <value> --prod
```

Unset in dev is correct — dev has no real numbers to report.

## MRR is derived from paid invoices, not plan prices

`subscriptions` has **no currency field**. The billing currency is chosen by the
admin at issue time and stored on the invoice, so deriving MRR from
`planPrice()` would price every store in MYR and count an SGD store's S$59 as
RM59.

More fundamentally, a plan constant is a *guess at* what was billed while the
last paid invoice is the *record of* it — surviving custom amounts, the founding
discount, Scale's banded pricing, and any future price change.

For each `active`, non-comped subscription: take that retailer's most recent
paid invoice and reduce its `total` to a monthly equivalent (annual ÷ 12).
Summed **per currency**; MYR and SGD are never blended. Rounding is per
subscription, so any figure can be reconciled by hand against one invoice.

An active subscription with no paid invoice is reported as
`activeWithoutPaidInvoice` rather than contributing zero — it means either an
uninvoiced store or a billing gap worth chasing, and both deserve to be visible.

## Churn: `past_due` splits four ways

Manual billing v1 has **no cancellation flow** — nothing writes
`status: "cancelled"`, so a seller who stops paying just sits at `past_due`.
That makes `past_due` the churn signal, but it is reached four different ways
and only one of them is a lost customer. Reporting a single blended number would
tell Arif he lost customers he did not lose.

| Bucket | Condition | What to do |
|---|---|---|
| **Lapsed customer** | Paid before, pending invoice **past** its `dueDate` | Real churn. Chase or write off. |
| **Awaiting payment** | Paid before, pending invoice **not yet** due | Nothing. Inside grace. |
| **Awaiting your invoice** | Paid before, **no** pending invoice | **Issue the renewal.** This is Arif's action item, not a loss. |
| **Trial expired** | **Never** had a paid invoice | Failed conversion, never a customer. |

The `awaiting_payment` bucket is not a nicety. `issueInvoice` deliberately does
not touch the subscription (its comment says so outright), and only `markPaid`
moves `past_due → active`. So the instant Arif issues the renewal for an
"awaiting your invoice" store, that row becomes `past_due` **with a future-dated
pending invoice**. Without this bucket the report would manufacture a lost
customer precisely when the right thing was done.

`lapsedThisWeek` counts only the first bucket.

### Comped stores

The billing cron's trial path flips `comped` rows to `past_due` too, unlike its
other two paths. Comped subscriptions are excluded from MRR and from every
bucket, and surfaced as `compedExcluded` / `subscriptions.comped` so they are
visible rather than silently vanished.

### `cancelled` is a structural zero

It is reported anyway. The zero is **not good news** — it means the field has no
writer. Reporting it means the number starts moving on its own the day a
cancellation flow ships, instead of needing a report change to notice.

## Load-bearing invariant: `updatedAt` is the lapse timestamp

"Lapsed this week" needs to know *when* a subscription flipped, and no field
records that. It works anyway because the only writers of a `subscriptions` row
are `invoices.markPaid`, the backfill, and the three cron flips — the first two
always move the status *away* from `past_due`, and the cron's trial-reminder
patch deliberately does not bump `updatedAt`. So for a row **currently** in
`past_due`, `updatedAt` is exactly the moment it flipped.

**Anyone adding a fourth `db.patch` on `subscriptions` that touches `updatedAt`
silently breaks this figure.** Making churn-over-time robust would mean stamping
the flip explicitly in the cron — a follow-up, and one that only produces data
from the day it ships.

## The window

Seven MYT days ending at **today's** MYT midnight, exclusive — so today is not
included. The billing cron runs 03:30 UTC (11:30 MYT) and the report fires 09:00
MYT, so this covers exactly the previous seven cron runs with neither a gap nor
an overlap between consecutive weeks. It also matches the closed-range
discipline of `analytics.getInsightsRange`, which never references "now".

Order volume reuses `isRevenueOrder`, so "revenue" means the same thing here as
on /app/insights: `pending` and `cancelled` are excluded.

## Exclusions are audited, not assumed

Internal/test stores are held out of every figure by three predicates: the
owner's Clerk subject being in `ADMIN_USER_IDS` (the principled one — it
self-heals from the allowlist), an `EXCLUDED_EMAIL_FRAGMENTS` substring match on
`notifyEmail`, and an explicit `EXCLUDED_SLUGS` escape hatch.

**There is deliberately no "unset email" rule.** `notifyEmail` is optional and
independent of the Clerk auth email — unset simply means the retailer receives
no email notifications — so excluding those rows would silently drop real paying
retailers from MRR and GMV.

The payload carries `excluded.retailerCount` and `excluded.slugs` so the
exclusion set can be eyeballed. A wrongly-excluded real store would otherwise
be undetectable.

## The `capped` contract

The order scan is bounded (`BUSINESS_REPORT_ORDER_SCAN_CAP`) and reads
**newest-first**, so a capped week under-reports its *earliest* days with a
plausible-looking number. When `capped` is true the routine must **not** publish
that week's volume. The cap ships in the payload beside the flag.

The cap is lower than Insights' 10k on purpose: that one is per retailer, while
this scan shares one query's read budget with `retailers`, four subscription
reads, two invoice reads and `foundingMembers`.

## Reads are N+1-free

`invoices` has only `by_retailer` and `by_status` — no compound index. The daily
billing cron reads invoices per subscription, which is fine at its scale but
N+1 across every retailer. This query instead does **one** `by_status` collect
per invoice status and reduces each to a per-retailer map.

`orders` has no cross-retailer time index (every index is `retailerId`-prefixed),
so the weekly scan rides Convex's system creation-time index, widened by a skew
buffer and then filtered precisely on `createdAt` — the technique
`analytics.ts` documents.

## Verification gate

Unit tests prove the arithmetic, not that it matches production. Dev carries no
subscriptions and prod cannot be exercised from a test, so before wiring the
schedule:

1. Deploy and set `BUSINESS_REPORT_SECRET` on prod.
2. Call the endpoint once by hand with the secret header.
3. Independently recompute the same figures against prod (Convex MCP
   `runOneoffQuery`) and diff the two.
4. Check `excluded.slugs` names exactly the internal stores and no real one.
5. Only then wire the weekly routine.

## When HitPay recurring billing lands

Ticket `86eyb6z4r` (unbuilt) replaces manual invoicing with real recurring
rails. At that point subscriptions gain genuine cancellation, and the four-bucket
`past_due` reading becomes a legacy path — the report should be **replaced**
there, not extended. Churn rate over time and dunning arrive with it.

## Convex MCP and production

`.mcp.json` runs the Convex MCP server with
`--cautiously-allow-production-pii`, which unlocks the read-only tools (`data`,
`logs`, `runOneoffQuery`) against the production deployment. This is what makes
step 3 of the verification gate possible, and it serves prod forensics
generally.

Two flags are deliberately **not** set:

- `--dangerously-enable-production-deployments` would allow mutations and
  `envSet`/`envRemove` against live prod.
- `--prod` would restrict the server to production, losing dev as a safe
  testing target.

**This config is committed, so it applies to every agent session opened in this
repo, including subagents — not just Arif's.** Production holds real buyer
phone numbers, addresses and order history, which is PDPA-relevant personal
data. Treat anything read from prod accordingly: it may be inspected to
diagnose, and must not be copied into docs, tickets, commits or test fixtures.
A flag change requires a session restart to take effect.
