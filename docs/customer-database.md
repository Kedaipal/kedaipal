# Customer Database (CRM-lite) — Implementation Reference

Reference doc for the first-class customer entity. **Backend + dashboard UI implemented and shipped.** This file documents what exists, why it was built this way, and what depends on it next (Automated Reminders, Broadcast).

## Context (2026-05-24)

Solves the universal *"who is this person, what did they order last time?"* pain. Every retailer benefits regardless of vertical. Unlocks the Pro tier (RM149) value proposition and is the foundation for Reminders and Broadcast — neither works without a customer entity.

Before this, the retailer scrolled WhatsApp chat history to recognise a returning customer. Now they see "Aisha, 7 orders, RM840 lifetime, last ordered on 2 May" at a glance.

## What got built

### Schema

`customers` table — keyed by `(retailerId, waPhone)`, with denormalized aggregates refreshed on order create/cancel so the list/detail views never scan the orders table.

```
customers: {
  retailerId, waPhone,
  name?,            // retailer-edited override — source of truth for display
  waProfileName?,   // raw WhatsApp pushname, auto-refreshed, never clobbers `name`
  notes?,           // retailer-private, never exposed to shoppers
  searchText,       // lowercase haystack (name + pushname + phone) for full-text search
  orderCount, totalSpent, firstOrderAt, lastOrderAt,
  createdAt, updatedAt,
}
```

Indexes: `by_retailer`, `by_retailer_phone`, `by_retailer_lastOrder`, `by_retailer_ltv`, `by_retailer_orderCount`, plus a `search_customers` full-text index on `searchText` (filtered by `retailerId`).

`orders` table gained `customerId: v.optional(v.id("customers"))` + a `by_customer` index. Optional because phone-less orders (link-in-bio checkout) and pre-migration orders aren't linked yet.

### Files

| Path | Purpose |
|---|---|
| `convex/lib/customer.ts` | Pure helpers — `getDisplayName`, `formatPhone`, `buildSearchText` (no Convex imports, unit-tested) |
| `convex/customers.ts` | Queries (`list`, `get`, `ordersByCustomer`, `search`), mutations (`updateNotes`, `updateName`), linking helpers (`linkOrderToCustomer`, `refreshWaProfileName`, `decrementAggregatesForCancel`), and the `backfillCustomers` migration |
| `convex/lib/whatsappWebhook.ts` | Pure inbound-payload parser — `extractInboundMessages` (now also captures `contacts[].profile.name`) |
| `convex/customers.test.ts` | 18 integration tests (linking, aggregates, late-bind, pushname precedence, search, cancellation, backfill) |
| `convex/lib/customer.test.ts`, `convex/lib/whatsappWebhook.test.ts` | Pure-helper unit tests |
| `src/lib/customer.ts` | Frontend mirror of `getDisplayName`/`formatPhone` (kept in sync with the Convex copy — slug.ts pattern) |
| `src/hooks/useDebounce.ts` | Debounce for the search input |
| `src/components/dashboard/customer-card.tsx` | Mobile customer card |
| `src/components/dashboard/customer-list.tsx` | Desktop sortable table (TanStack Table) + mobile card list |
| `src/components/dashboard/customer-detail.tsx` | Contact + WhatsApp + inline name editor, lifetime metrics, private notes, order history |
| `src/routes/app.customers.index.tsx` | List route — search, sort, pagination (`usePaginatedQuery` + Load more) |
| `src/routes/app.customers.$customerId.tsx` | Detail route |

### Name resolution

`getDisplayName(customer)` resolves the display name with strict precedence:

```
retailer-edited name  →  WhatsApp pushname  →  formatted phone number
```

Blank/whitespace values fall through. The rule is mirrored byte-for-byte in `convex/lib/customer.ts` and `src/lib/customer.ts` (the Convex bundle and the frontend bundle can't share a module).

### Order-linking lifecycle

`linkOrderToCustomer` is the single choke point that folds an order into the customer aggregates and stamps `order.customerId`. Callers only invoke it when the order is **not already linked**, so each order is counted exactly once.

- **`orders.create`** — links immediately when a `waPhone` is present.
- **`whatsapp.confirmOrderFromWhatsApp`** (late-bind) — phone-less orders (link-in-bio checkout) are linked when the shopper messages the WhatsApp number and the phone is stamped. Already-linked orders are skipped (no double-count).
- **Pushname capture** — `refreshWaProfileName` always overwrites `waProfileName` with the latest pushname from the webhook `contacts[].profile.name`, but fills `name` only when the retailer hasn't set their own override. The retailer edit is the source of truth and is never clobbered.
- **Cancellation** — `orders.updateStatus` calls `decrementAggregatesForCancel` on the first transition into `cancelled` (same idempotency guard as the stock-restore), reversing `orderCount`/`totalSpent` (floored at zero). Order-date aggregates are left as-is for v1.

### Search

`customers.search` uses the `search_customers` full-text index over `searchText` (lowercase `name + waProfileName + waPhone`), filtered by `retailerId`. A single query matches by name *or* phone. `limit` is clamped to `[1, 50]`.

### Dashboard UI

- **List** (`/app/customers`): debounced search (name/phone), sort by recency / LTV / order count. Desktop renders a **TanStack Table** with sortable headers driving the server-side sort; mobile renders stacked cards. `usePaginatedQuery` with a "Load more" control.
- **Detail** (`/app/customers/$customerId`): contact block with WhatsApp deep link + inline name editor, a 4-up metrics grid (orders / lifetime / **AOV** / customer-since), editable private notes, and order history linking back to each order.
- **Navigation**: "Customers" added to the desktop sidebar and the mobile bottom nav.
- **Cross-link**: the order detail page links to the customer profile when the order is linked.

### Backfill

One-shot migration to populate customers from existing orders. Batched (100/txn) and self-scheduling to stay within Convex transaction limits; idempotent (linked orders are skipped):

```
npx convex run customers:backfillCustomers '{"cursor": null}'
```

## Env requirements

None beyond what already exists. (The inbound webhook now also requires `WHATSAPP_APP_SECRET` for signature verification — see [`whatsapp-webhook-security.md`](./whatsapp-webhook-security.md) — but that's a separate concern.)

## Tier gating (deferred)

The pricing plan scopes this to **Pro (RM149) and above**, hidden from Starter with an upgrade tease. Gating is **not implemented** — there's no plan/tier field on `retailers` yet (subscription billing is Sprint 1–3). The feature is currently accessible to all retailers; a `NOTE` marker sits at the top of `src/routes/app.customers.index.tsx` where the gate goes.

## Known limitations

- **Phone-number change = new customer.** v1 treats a new `(retailerId, waPhone)` as a distinct customer; a manual merge tool is v2.
- **`identity.subject` for ownership.** Auth scoping uses `identity.subject` to match the existing pattern across `orders.ts`/`retailers.ts` (where `retailer.userId` is stored from `subject`). Convex guidelines prefer `tokenIdentifier`; switching is a cross-cutting migration, deliberately out of scope.
- **No React component tests.** The repo has no component test infra (all tests are `convex/**/*.test.ts`); the pure helpers are unit-tested and the components are verified via `tsc` + production build.
- **convex-test fake-timer requirement.** `customers.test.ts` uses `vi.useFakeTimers()` so `orders.create`'s scheduled email action doesn't fire and crash with "Transaction not started" (same root cause documented in `email-notifications.md`).

## Future work

- **Automated Reminders** and **Broadcast to Past Customers** (both blocked on this entity) — segment by recency/LTV, message via the WABA-protection gateway.
- Customer merge tool (phone-change case).
- Tier gating once subscription billing lands.
