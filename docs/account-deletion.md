# Account deletion — the tenant erasure cascade (2026-08-17, ClickUp 86eyetzbk)

**Status: implemented.** `retailers.deleteUser` erases a seller's account and
every artefact it owns, keyed by Clerk subject (`userId`). This is the PDPA
erasure path for a retailer; the buyer-level equivalent (deleting one
customer's data on request) is ticket `86eydwct5`.

## What it deletes

In phase order (`DELETION_PHASES` in
[`convex/lib/accountDeletion.ts`](../convex/lib/accountDeletion.ts)):

orders (+ their `orderEvents`, their `paymentClaims` rows and **all three**
owned blobs — buyer reference image, payment proof, mockup image(s)) → products
(via the shared `deleteProductCascade`: variants, images, junctions) → leftover
`productCategories` → categories (+ tile blobs) → `deliveryJobs` (+ POD
photos) → `deliveryQuotes` → `customers` → `pickupLocations` (manager name +
phone) → `counterCheckoutSessions` (buyer phone + pushname) → `orderClaims`
(buyer phone + name) → `subscriptions` (+ voiding pending invoices, killing
their Pay-now links and the saved-card session) → `subscriptionUsage` →
`creditPurchases` (pending checkouts expired, rows kept) → `creditAccounts` →
`creditLots` → `foundingMembers` → `retailerMembers` (+ a "store closed" email
to each active one) → `retailerSendingLimits` → `outboundMessageLog` (buyer
phones) → `slugHistory` → `optOuts` attribution → the retailer's own blobs
(logo, cover, payment QRs) and finally the retailer row.

Before the original ticket the cascade stopped after the first handful of
tables, so nine `retailerId`-bearing tables survived — including two holding
**buyer phone numbers** (`counterCheckoutSessions`, `outboundMessageLog`) — and
it freed only the payment-proof blob, leaking the buyer's reference image and
the mockups.

`orderClaims` was a later instance of the same bug (added 2026-10-10). A claim
link (86eyq0epn) carries a required buyer `waPhone` and an optional
`buyerName`, and its own daily purge cron deliberately exempts `completed`
rows on the grounds that "order retention is the PDPA pack's job" — while the
PDPA pack had no phase for it. So every completed claim kept its buyer's phone
and name indefinitely after the seller's account was erased, with its
`retailerId` **and** its `sessionId` (the counter session dies a phase earlier)
both dangling. A claim is an OFFER, not a record of what Kedaipal charged the
seller, so there is nothing to weigh against erasing it: the rows are deleted
outright.

## Retained by DECISION (not omissions)

| Kept | Why |
| --- | --- |
| `invoices` + their frozen PDF blobs | Financial records of what Kedaipal charged the seller. They carry billing data, not buyer PII, and a business must be able to produce its own invoicing history after a customer leaves. |
| `adminAuditLog` | An audit trail must outlive the tenant it audits — "who at Kedaipal touched this store?" is unanswerable if the answer is deleted with the store. Rows hold ids and last-4 hints, never buyer PII. |
| `creditLedger` rows | The financial record of what the seller bought and spent (purchased credits are deferred revenue until spent or expired). Seller billing data, no buyer PII. |
| `creditPurchases` rows + their receipt PDFs | What the seller paid Kedaipal for top-up packs — the same kind of record as an invoice. The phase doesn't delete them; it expires every still-pending checkout so a payment can't land in a deleted store. |
| `optOuts` rows | A row is the buyer's **global** standing instruction ("do not message me") across the whole shared WABA number — it is not the seller's data to erase, and deleting it would silently re-consent that buyer. Only `triggeredByRetailerId` is cleared, so no dangling reference remains. |

If any of these ever changes, change it as a decision here — not as a silent
line added to the cascade.

## Why it's paginated

The old cascade was one ACID mutation doing unbounded `.collect()` sweeps, so a
high-volume tenant exceeded Convex's transaction read/write limits and deletion
**failed outright** — exactly the tenant most likely to ask for erasure.

It is now **self-chaining**: each invocation processes a bounded batch
(`DELETE_USER_BATCH = 25` rows), advancing through phases in one transaction
while budget remains, then schedules itself with the current `phase` + `cursor`
until every phase completes. Invoke it **once** with just `{ userId }` —
`phase`/`cursor` are internal continuation state.

Consequences worth knowing:

- **It is no longer all-or-nothing.** The cascade spans several transactions,
  so invoke it once the tenant is inactive; a row created mid-cascade by a
  still-live storefront could survive as an orphan.
- The **retailer row is deleted last**, so every continuation can re-resolve the
  tenant by `userId`, and each phase is idempotent — a crashed batch just
  resumes.
- **One `.paginate()` per invocation.** Convex allows a single paginated query
  per mutation, and two phases paginate (`slugHistory`, `optOuts` —
  `PAGINATED_PHASES` in `lib/accountDeletion.ts`). The driver hands off to a
  scheduled continuation before entering a second paginated phase in the same
  invocation. This was a latent crash found in the field (z8r3fdbmc9): on a
  small tenant `slugHistory` finished inside one invocation's budget, the loop
  rolled into `optOuts`, the second paginate threw, the invocation's writes
  rolled back, and the cascade **stalled with no continuation scheduled**.
  convex-test does not enforce the limit, so only a real deployment surfaces
  it — the tests now drain `finishAllScheduledFunctions` instead of asserting
  single-invocation completion.
- Progress is logged per phase (counts + ids only — never phone numbers or
  message bodies, per the log-redaction convention in
  [`docs/whatsapp-webhook-security.md`](./whatsapp-webhook-security.md)).

## One blob helper, two cascades

Two different code paths erase orders — the admin hard delete
(`deleteOrderCascade`) and this tenant cascade — and each used to open-code its
own blob list, which is precisely how the account path came to free only one of
three. Both now call **`deleteOrderOwnedBlobs`**
([`convex/lib/orderBlobs.ts`](../convex/lib/orderBlobs.ts)), so a future
order-owned blob field is freed by both callers or neither. Same posture as
`productDelete.ts` on the product side.

## How it's invoked

`internal`-only — there is no shopper- or retailer-facing path. Today it's run
by hand from the Convex dashboard:

```
npx convex run retailers:deleteUser '{"userId": "user_abc123"}'
```

Wiring an **automatic** trigger (a Clerk `user.deleted` webhook, or an admin
console action) is ticket `86eydwct5`, together with the buyer-level erasure
mutation and the retention crons. Until then, an account-deletion request is a
manual ops action.

## A forgotten table is now a failing test

Which tables hold personal data is a property of the **schema**, not of this
cascade — so a new table with a `waPhone` on it is a new PDPA obligation, and
`DELETION_PHASES` is a hand-maintained list in another file that nothing forced
anyone to update. That is exactly how `orderClaims` was missed.

[`convex/accountDeletionCoverage.test.ts`](../convex/accountDeletionCoverage.test.ts)
closes that loop: it reads the tables straight out of `schema.ts`, flags any
whose field names look like a person's contact details (phone / email /
address / a qualified `*Name`), and fails unless the cascade **visits** each
one. A new table either gets a phase, or gets listed under the phase whose
cascade already erases it (`PHASE_TABLES`, which today records that the
`orders` phase takes `orderEvents` + `paymentClaims` and the `products` phase
takes `productVariants` + `productCategories`). The failure names the table and
the offending fields, so the author has to decide rather than guess.

Membership proves the cascade *visits* a table; what it does there is the
phase's own call (`optOuts` is visited to keep its row on purpose). The
row-level outcomes are asserted in `retailers.test.ts`.

Tests: `convex/retailers.test.ts` → "retailers deleteUser (internal cascade)"
covers full-tenant purge, cross-tenant isolation, every previously-orphaned
table (`orderClaims` included, seeded `completed` — the status no cron sweeps),
the retained-by-decision rows, the opt-out attribution clear, all three blob
kinds, and multi-page self-chaining completion. Plus
`accountDeletionCoverage.test.ts` above.
