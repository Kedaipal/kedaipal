# Vendor Identity & Uniqueness (v1)

How a retailer ("vendor") is identified, what's unique, and the deliberate
**1 login : 1 store** decision. Flagged here so the multi-store question is a
conscious fork, not a surprise when a multi-brand seller hits the wall.

## The three IDs — don't conflate them

| ID | What it is | Role |
|----|-----------|------|
| `userId` (Clerk subject) | the **login** | **the real owner key** — source of truth, `by_user` index |
| `slug` | `kedaipal.com/<slug>` | the **public handle** — globally unique, renameable (`slugHistory` keeps redirects) |
| `_id` (Convex doc id) | internal row id | internal references only |

The slug addresses the store publicly but is **not** identity (it's renameable).
The store is owned by exactly one Clerk `userId`.

## What's unique, and who enforces it

- **`userId` → store: strictly 1:1.** `createRetailer` checks `by_user` and throws
  *"Each account can own one retailer."* This is the hard gate.
- **`slug`: globally unique.** Collision-checked in `createRetailer` + live
  availability in onboarding (`checkSlugAvailability`) and the admin onboard form.
- **email: unique per Clerk account — enforced by *Clerk*, not us.** One verified
  email = one Clerk account = (via 1:1) one store. We store `notifyEmail` only as a
  *notification* field (normalized lowercase/trim via `assertValidEmail`); it is
  **not** an identity key.
- **`waPhone`: NOT unique** (deliberate — see below). Optional contact field.

## Can the same email own multiple stores? No.

Clerk allows one account per email, and we allow one store per account. So a
duplicate email dead-ends: the client signing in with an existing email lands back
in their **existing** store (onboarding redirects them to `/app`). To run two
stores today you need two separate logins.

**Admin "onboard a client" pre-check.** Because the failure is otherwise only
discovered when the client clicks the invite, the admin form pre-checks the typed
email against our `notifyEmail` (`retailers.checkEmailHasStore`, admin-only via the
`by_notify_email` index) and **warns + disables the invite** when a store already
uses it. This checks the right question — *"already owns a store"* — rather than
merely *"exists in Clerk."* It's a strong heuristic (notifyEmail is editable, so
not a hard guarantee); the real 1:1 gate remains `createRetailer`.

**Self-signup** needs no extra email check: Clerk natively blocks signing up with a
taken email, and `createRetailer` blocks a second store per login.

## Why `waPhone` is intentionally NOT unique

- It's **optional** — you can't reliably gate identity on an often-blank field.
- It's **not the sending number** — under the shared-WABA model outbound goes
  through Kedaipal's number; `waPhone` is just the seller's display/contact detail.
- The real anti-duplicate gate is **one paid subscription per login** — a second
  store already costs a second account + invoice, so there's little abuse to close.
- Hard-uniqueness would add friction + edge cases (re-typed numbers, family-shared
  lines) for marginal benefit.

(Note: customers are keyed by `(retailerId, customer waPhone)` — a *different*
number from the retailer's own `waPhone`. Don't conflate the two.)

## The open fork — multi-brand vendors

Some F&B sellers run multiple brands (a cake brand *and* a frozen-food brand).
Today each needs a separate account, subscription, invoice, and potentially its own
Founding spot. **Decision for v1: stay 1:1** — it keeps multi-tenancy, billing, and
the Founding cap clean. If "one owner, many stores" becomes a real segment, revisit
by splitting an **Owner** entity (login + billing) from **Stores** under it (1→N,
billing per store or bundled). That's a schema change, not a tweak — decide it
deliberately when a multi-brand seller actually shows up.
