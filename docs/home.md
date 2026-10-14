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
existing indexes; **no schema change**.

Every read over a RANGE takes its window boundary from the CLIENT as a
MYT-midnight epoch rather than reading `Date.now()` itself, so the query is
stable within a day and Convex can cache it — the same discipline
`getInsightsRange` follows. `getTodayPulse` is the exception and reads the
clock server-side, exactly as `getTodayStats` does: "today" is not a boundary
the client gets to choose, and that query is deliberately live rather than
cached — it re-runs as orders land.

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

**A refusal is not an answer of zero.** `getInsightsRange` returns
`{ gated: true }` for *every* closed range on Starter, and the first version
read that as an empty trend — so the hero drew six flat bars under "Today
against the last 6 days" and a Starter who sold RM 800 yesterday was shown a
chart saying they sold nothing all week. The context trend is now `null` when
gated, distinct from `[]`, and one bar makes `SalesHero` hide the chart
altogether: today's figures stay, the Pro teaser below says why the week is
missing, and the "last Monday you closed at…" line goes quiet for the same
reason. Starter stores pay us, and this is the one chart they can see — it had
to be right or absent, never invented.

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

**Who can see those ids, and why it is allowed.** The ids ride on the Insights
reads, which are gated on the **`insights`** area grant — so a teammate holding
`insights` but *not* `customers` receives them. That is deliberate and it is the
boundary worth naming, because it is the one place this feature widens who sees
anything customer-shaped.

What they receive is a list of opaque Convex ids, a `firstOrderAt` timestamp
and `initial` — **one** uppercase character, because the avatar stack the design
draws can render exactly one, and `MASK_PII` hides even that. No name, no phone,
no address, no spend, no order history: nothing that resolves to a person
without a second read they are not allowed to make. Every door onto the
customer themself — `customers.get`, `customers.list`,
`customers.search`, the customer page — still requires the **`customers`** grant
*and* the `crm` plan feature, and `countLapsedRegulars` returns `null` rather
than a figure for a reader without them. The ids exist on Home for exactly one
purpose: to be de-duplicated across two windows so "27 of 42" is not invented
by adding two counts together.

**What would change this answer.** That one character is the ceiling, not a
starting point. The moment this payload carries anything a reader could turn
into a person — a full name, a phone, a spend figure, an order count — it stops
being an opaque key and becomes customer data, and it belongs behind the
`customers` grant like everything else. Treat adding a field here as a
permission decision, not a payload one.

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

#### A tile's filter has to be visible and removable on the other side

A tile opens the inbox on `ffrom`/`fto`, an arbitrary inclusive due span — the
panel's own due control (`fwin`) only names Today / Tomorrow / This week, and
Plan ahead offers seven days. That span is the **same axis** as `fwin`, so the
two are mutually exclusive and render as ONE filter: one applied chip ("Due Thu
16 Oct"), one entry in "Clear all (N)", and a selected row inside the Due date
section that switches it off in place. Picking a named window retires the span
rather than ANDing with it, because a Thursday span AND today is the empty set.

The first version counted the span as an active filter without rendering or
clearing it, which made the empty state a **dead end**: a seller tapping an
empty Thursday got "No orders match your filters → Clear filters", tapped it,
and the list stayed empty with nothing on screen to blame. The vocabulary now
lives in one place — [`src/lib/inbox-filter-params.ts`](../src/lib/inbox-filter-params.ts)
— and both "is anything filtering?" and "what does Clear all clear?" derive
from it, so the next filter param cannot be counted without being clearable.
The due-today banner reads the span too, and stops offering to filter to today
when the seller arrived from the Today tile.

### The chart's axis is not one label per bar

Seven weekday names fit the hero's width. Thirty do not — they ran together as
an unbroken `TueWedThuFriSatSun` smear. And over a month the weekday is the
wrong **unit** anyway: "Tue" names four different days, so "Best: Thu" could
not be looked up.

So the 30-day view prints **dates on a weekly cadence** (`16 Sept · 23 Sept ·
30 Sept · 7 Oct · 14 Oct`), counted back from the LAST bar so the most recent
day always carries a label and the thinning eats into the old end. Shorter
windows keep a weekday on every bar, which is what the board draws. Nothing is
lost: **every** bar carries a `title` with its full day and takings, so the 25
unlabelled columns still answer on hover.

Two layout rules make it hold:

- **The label is positioned, not aligned.** A date is wider than its own
  column, and `text-align` cannot pull overflowing text back — in LTR it spills
  right whatever the alignment, which clipped `14 Oct` to `14 Oc` against the
  card edge on a phone. Ticks are absolutely positioned: centred normally,
  pinned `left-0`/`right-0` at the two ends.
- **The bar row has a height below `lg`.** It shipped as `h-[84px] flex-1`, and
  `flex-1` is `flex: 1 1 0%` — in that column the zero is a *height* basis, and
  below `lg` the parent has no height to grow into, so the row resolved to
  **1px and the chart drew no bars at all on any phone**. It only ever worked on
  desktop, where `lg:flex-row` stretches the chart column against the figures
  beside it. The row is now a fixed 84px at the base width and takes `lg:flex-1`
  only where there is space to grow into.

### Stale unpaid is a strict subset of unpaid

`STALE_UNPAID_DAYS = 3` (`convex/lib/orderBuckets.ts`). Both counts come from
one author — `isOpenUnpaid` and `isStaleUnpaid` — so Home can say "3 of your 9
unpaid orders are over 3 days old" and have both halves mean the same thing.

"Not received" rather than "unpaid", deliberately: an order the buyer has
**claimed** to have paid is still money the seller does not have, and it is the
one most worth chasing, because somebody is waiting on a human to look.
`unpaidStaleOldestAt` rides along so the row can say "oldest is from Wed 30 Sep"
rather than only a count.

Because it is a **strict subset**, the row's link has to carry every rule
`isOpenUnpaid` applies *and* the age bound: open buckets, not-received, placed
before the cutoff. It shipped without the bucket, which let a delivered order
still carrying an unpaid status into the list — the same defect this redesign
had already fixed for "To collect". The cutoff is floored to the minute so the
href is stable between renders instead of new on every tick.

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

---

## The page (T1 + T3)

`src/routes/app.index.tsx` is now the **state switch and nothing else** — it
resolves which shape the store is in, assembles the setup checklist, and hands
rendering to `src/components/home/*`. It was 1,185 lines holding every shape
inline, which is why changes to the steady page kept breaking onboarding.

### The five shapes

| Phase | When | What leads |
| --- | --- | --- |
| `new` | no required step done | Welcome card + the three-step row |
| `waiting` | set up, `!activatedAt` | Share card, then an empty sales frame |
| `first` | within 7 days of `activatedAt` | Celebration, then the real hero |
| `steady` | everything else | Strip → exceptions → sales → plan ahead |
| loading | `products` unresolved | `HomeSkeleton`, shaped like the real zones |

`products` decides the shape, so the skeleton holds until it resolves — a flip
after first paint is the thing the skeleton exists to prevent.

### Order on mobile

Greeting → (credit card if `out`) → action strip → (credit card if `low`) →
exception rows → Sales (chips + hero + three cards) → Plan ahead → Your store
(credit card if `ok`, share card).

### Rules worth knowing before changing it

- **The strip says each number once.** "Needs attention" used to repeat the
  strip's own counts as rows. The exception rows now carry only what the strip
  *cannot* say: unpaid orders older than `STALE_UNPAID_DAYS`, and out-of-stock
  products. No row may duplicate a strip count.
- **One period control** governs the hero AND the three cards, so the page can
  never show a 30-day headline over a 7-day chart. It lives in the URL (`?p=`)
  and is omitted when it is the default, so the common URL stays clean while a
  refresh still keeps the seller's window.
- **Plan ahead is period-independent.** The chips change what the store has
  already earned; Plan ahead answers what is coming. Tying it to "30 days"
  would be a forecast of the past.
- **Credit placement is derived from tone**, never chosen per surface
  (`creditPlacement`), so the card can never be amber while sitting politely at
  the foot of the page. On Home the promoted card replaces the shell banner's
  credit branches so the lock sentence is not said twice.
- **Out of credits relabels, never disables.** The strip cells stay links —
  a seller who cannot see an order must always be able to release the buyer.
- **Home's only buyer-identity surface is one masked initial per face.** The
  recent-orders list was the page's masked surface and the redesign removed it,
  so `src/routes/app.index.tsx` left the `MASK_PII` sweep table with that
  reasoning recorded there. The Customers card then brought the board's avatar
  stack back, so `src/components/home/customers-card.tsx` carries a row of its
  own: an initial beside that buyer's order history is still identity, and Home
  is Clarity-recorded. Everything else Home renders is a count, a product name
  or a source label. Re-add the route's row the moment a buyer's name, phone,
  address or note appears on the page itself.

### Looking at it

`/app` is Clerk-gated, so the components cannot be reached in a preview without
signing in. They were reviewed by rendering the real components to static HTML
with the production stylesheet (the harness pattern) — which is how three
defects were caught that reading the Tailwind would not have shown: the
out-of-credits sub-labels clipping to "accepting pa…", the hero printing
"RM 4,860.00" at 42px, and the stale-unpaid row carrying a redundant year.
