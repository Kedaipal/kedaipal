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

## Reserved handles — what a store can never be called

A store lives at the **root** of the domain (`kedaipal.com/<slug>`), so it shares
one namespace with every page the app serves. Any top-level path — live today or
plausible tomorrow — is a handle a vendor must be refused, or the day we ship
that page every buyer link to it lands on someone's shop (or the shop breaks).

**One author:** [`convex/lib/reservedSlugs.ts`](../convex/lib/reservedSlugs.ts).
The server validator (`assertValidSlug`, used by `createRetailer`, the admin
onboard and `renameSlug`) and the client pre-check (`validateSlugShape` /
`slugSchema`, behind the live "URL slug" hint on onboarding, Settings → Store and
the admin onboard form) both import `isReservedSlug` + `RESERVED_SLUG_MESSAGE`
from it, so the two sides cannot disagree and the seller reads the same sentence
whichever side catches it: *"Reserved by Kedaipal — pick another slug"*.

**What is fenced, by group** (the file comments say why each group exists):

| Group | Examples | Source of truth |
| --- | --- | --- |
| Live routes | `app`, `track`, `claim`, `pricing`, `privacy`, `terms`, `cost` | derived from `src/routes/` on disk |
| `public/` folders | `img`, `guides`, `poster`, `video` | derived from `public/` on disk |
| Platform | `api`, `assets`, `admin`, `webhooks`, `status`, `www` | curated |
| Auth aliases | `login`, `signup`, `register`, `reset-password`, `account` | curated |
| Marketing pages we may add | `help`, `blog`, `changelog`, `partners`, `directory` | curated |
| Dashboard / buyer nouns | `orders`, `products`, `billing`, `checkout`, `pay`, `invoice` | curated |
| Generic tenant words | `store`, `shop`, `seller`, `vendor`, `official`, `verified` | curated |
| Environments + bug literals | `demo`, `staging`, `sandbox`, `null`, `undefined` | curated |
| Brand, **anywhere** in the text | `kedaipal-support`, `official-kedaipal`, `kedai-pal`, `Kedai Pal` | `containsBrand` — inside one token, or across separators when the match ends on a token boundary |

**Machine-checked, not remembered.** `src/lib/reserved-slugs.test.ts` scans
`src/routes/` and `public/` and fails the gate when a top-level segment is not
reserved — add a route, forget the list, the build says so (with the name to
add). It also refuses *dead* entries the slug shape could never match (a dot, an
underscore, under 3 chars): `favicon.ico` and `_` sat in the old hand-written
list for months protecting nothing. Dotted files (`sitemap.xml`, `robots.txt`)
and TanStack's `_server` are therefore deliberately **not** listed — the shape
check rejects them first, and a test pins that.

**The brand rule also guards the store name.** `assertValidStoreName` (server)
and `validateStoreName` (client, inline under the field on onboarding, Settings →
Store and the admin onboard form) refuse any name that contains `kedaipal` inside
one word, or spread across separators when the match ends on a word boundary
(`Kedai Pal` refused; **`Kedai Paling Murah`, `Kedai Palma` allowed** — the
boundary rule exists for exactly those, PR #263 review) — a store called "Kedaipal Support" on the
slug `abc-trading` is a stronger impersonation than any URL, because the *name*
is what renders in every WhatsApp message and on the storefront header. Substring,
not prefix, and no "fan" exemption: buyers do not parse URL structure, the shared
WABA already puts Kedaipal's number on every message, and no legitimate seller
names their business after their order tool (owner call, 8 Sep 2026). The
ordinary Malay `kedai` is untouched. Copy is one constant per rule
(`RESERVED_SLUG_MESSAGE`, `BRAND_NAME_MESSAGE`), imported by both sides.

**Not fenced, on purpose:** category and product slugs
(they live under `/<slug>/c/…` and `/<slug>/p/…`, so they can never collide —
`assertValidCategorySlug` skips the list); and existing stores — the check runs
on the **new** slug at create/rename only, so a store already on a word that
later becomes reserved keeps working. No dev or prod store sat on one when the
list was rebuilt (Sep 2026).

To reserve a new word: add it to the right group in `reservedSlugs.ts`. A new
route needs no thought at all — the test names the missing entry.

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

## `businessIdentity` — display data, not an identity key

`retailers.businessIdentity` (z8r3fdcrzj) carries the seller's *legal* identity
— registered name, SSM/UEN, billing address — purely for printing on the
invoices/receipts buyers download. It is **not** unique, **not** validated
against SSM, and plays no part in ownership or auth; the identity keys above
are unchanged. It's also deliberately separate from `businessAddress` (the
private delivery-pricing origin): this block is seller-published, that one must
never leak. See [`invoices-receipts.md`](./invoices-receipts.md).

## The open fork — multi-brand vendors

Some F&B sellers run multiple brands (a cake brand *and* a frozen-food brand).
Today each needs a separate account, subscription, invoice, and potentially its own
Founding spot. **Decision for v1: stay 1:1** — it keeps multi-tenancy, billing, and
the Founding cap clean. If "one owner, many stores" becomes a real segment, revisit
by splitting an **Owner** entity (login + billing) from **Stores** under it (1→N,
billing per store or bundled). That's a schema change, not a tweak — decide it
deliberately when a multi-brand seller actually shows up.
