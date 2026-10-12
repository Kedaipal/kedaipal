# Dashboard Home (`/app`)

The page a seller opens every morning. It leads with **sales** — what the store
earned, how much of it is collected, what is selling and who is coming back —
with operations condensed into one strip above it. Insights (`/app/insights`)
stays the deep dive (custom ranges, scrubber, payment donut); Home answers
"how is my business doing" in one screen without being asked.

Ticket: [`z8r3fdrgzj`](https://app.clickup.com/t/z8r3fdrgzj). Design canvas:
eight artboards (Home · Pro / Starter / desktop, Onboarding 1–3, Credits low /
out).

> **Scope note — dark mode is deliberately out.** The canvas renders the sales
> hero as `background: var(--foreground)`, which inverts to a near-white slab
> under the app's dark tokens, and every label inside it is written against
> `var(--background)`. Dark mode is not shipped yet (Zaki, 12 Oct 2026), so Home
> is built for light only and the hero's dark treatment is settled when dark
> mode lands — not guessed at here. See PR #241.

---

## The reads (T2)

Five reads feed the page beyond what Insights already computed. All are on
existing indexes; **no schema change**. Every one takes its window boundary
from the CLIENT as a MYT-midnight epoch rather than reading `Date.now()`
itself, so the query is stable within a day and Convex can cache it — the same
discipline `getInsightsRange` follows.

| Read | Where | Feeds |
| --- | --- | --- |
| `analytics.getTodayPulse` | `convex/analytics.ts` | Today's earned / collected / order count, **ungated** |
| customer identities per window | `getInsightsRange` + `getTodayStats` | Customers card |
| `customers.countLapsedRegulars` | `convex/customers.ts` | "8 regulars have gone quiet" |
| `orders.countDueByDay` | `convex/orders.ts` | Plan ahead strip |
| `searchOrders` stale-unpaid counts | `convex/orders.ts` | Stale-unpaid exception row |
| `credits.getUsagePace` | `convex/credits.ts` | "About 3 days of orders at this week's pace" |

### Today is free, trends are Pro

Decision 1 on the ticket loosens the Starter gate: **today's** revenue,
collected and order count are free on Home for every plan, while the 7- and
30-day views and the three insight cards stay Pro. `getTodayPulse` is therefore
a separate query from `getTodayStats` rather than a flag on it — `getTodayStats`
carries products, payments, sources and customer identities, all of which *are*
the Pro product, and a shared handler would put them one edit away from leaking.

Both still require the **`insights` area grant**. The plan decides whether a
store has paid for trends; the grant decides whether this teammate may go near
the store's money at all. Loosening the first never loosens the second.

### Returning vs new customers: ids cross the wire, not verdicts

Home's window is a **closed range plus today**, answered by two queries. The
same buyer can appear in both — a regular who ordered on Tuesday and again this
morning — so the two halves must be unioned as a **set** before anything is
counted. Adding two counts would invent a customer.

Both queries therefore return `customers: { id, firstOrderAt }[]`, and the
client classifies **once**, against the window's own `from`
(`splitCustomers`, `src/lib/insights-view.ts`):

> `firstOrderAt < from` → returning, else new.

Classifying server-side would be wrong, not merely redundant: today's query
would decide against *today's* midnight, calling nearly everyone returning, and
the union of two differently-classified sets is meaningless.

Orders with no `customerId` (link-in-bio checkout arrives without a phone)
contribute revenue but no identity — the card counts identified buyers, which
is what "27 of 42 customers" honestly means. The id set is capped at
`CUSTOMER_SET_CAP` (2,000) with a `customersCapped` flag, surfaced rather than
silently truncated.

### Plan ahead counts exactly what "Due today" counts

`countDueByDay` deliberately reuses the inbox chip's two rules, because Home
shows **both numbers on one screen** and a page that contradicts itself is worse
than a page with one fewer number:

- **Open orders only** (new / in-progress). A delivered Saturday order needs no
  prep; counting it would make Saturday look heavier than the work is.
- **Never counter orders.** A counter sale stamps today as its fulfilment date
  at create — it is a receipt, not a promise — so at a counter-heavy store they
  would swamp every tile ([`86ey8r734`](https://app.clickup.com/t/86ey8r734)).

Every day in the window is returned **including empty ones**, so a quiet
Wednesday renders as visibly quiet rather than missing.

### Stale unpaid is a strict subset of unpaid

`STALE_UNPAID_DAYS = 3` (`convex/lib/orderBuckets.ts`). Both counts come from
one author — `isOpenUnpaid` and `isStaleUnpaid` — so Home can say "3 of your 9
unpaid orders are over 3 days old" and have both halves mean the same thing.

"Not received" rather than "unpaid", deliberately: an order the buyer has
**claimed** to have paid is still money the seller does not have, and it is the
one most worth chasing, because somebody is waiting on a human to look.
`unpaidStaleOldestAt` rides along so the row can say "oldest is from Wed 30 Sep"
rather than only a count.

**Two "outstanding" figures exist and must never be merged:** the sales hero's
"not paid yet" is *this period's* revenue orders; the strip's "To collect" is
*every* open unpaid order. They are different questions with different answers.

### Credit pace

`getUsagePace({ retailerId, since })` counts **order consumption only** —
ledger entries carrying an `orderId`, debits net of refunds. Grants, top-ups,
expiries and admin adjusts all move the balance but say nothing about demand;
including them would make a monthly refresh read as a week of furious trading.

Floored at zero: a week of nothing but cancellations is "no pace", never a
forecast that the balance is growing. The line only renders when the credit
tone is `low` and the pace is at least one order a day — below that, "about 40
days left" is noise dressed as a forecast.

> The `orderId` guard is currently unreachable — both ledger writers set it. It
> is kept, and pinned by a test that writes a non-order debit directly, because
> the rule is "count orders", not "trust that nobody ever adds a non-order
> debit". A rule keyed on today's writers is a proxy that rots.

---

## Credit-gate classification

`customers.countLapsedRegulars` and `orders.countDueByDay` are registered in
`convex/creditLockCoverage.test.ts` under `OPEN_READS`: both return **counts
only**, no order or customer data. A gated order still counts toward the day's
workload for the same reason the nav badge counts it — Home is what sends the
seller to look.

> **Known gap, pre-existing, not widened here:** `convex/analytics.ts` is not in
> that test's `READ_MODULES`, so Insights' aggregate money from gated orders was
> never swept. `getTodayPulse` follows the existing pattern. Whether a gated
> order's revenue belongs in Insights is a credit-gate design question, not a
> Home question — worth its own ticket.
