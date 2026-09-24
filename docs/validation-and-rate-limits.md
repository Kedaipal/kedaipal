# Validation & Rate Limits

Cross-cutting guardrails that protect every mutation: rate limiting, input validation at the trust boundary, and legal-consent versioning.

## Trust boundaries

There are three classes of mutation, each with a different trust model:

| Class | Auth | Capability | Examples |
|---|---|---|---|
| **Authenticated retailer** | Clerk identity, ownership-checked (`retailer.userId === identity.subject`) | — | `updateStatus`, `markPaymentReceived`, product writes |
| **Public storefront** | none | retailer is named in args | `orders.create` |
| **Public tracking** | none | knowing the high-entropy `trackingToken` *is* the capability (`shortId` is not a secret) | `updateDeliveryAddress`, `claimPayment`, `generateOrderProofUploadUrl` |

Because the public classes are unauthenticated, **rate limiting is the first line of defence** and validation must assume hostile input.

## Rate limits

Defined in [`convex/lib/rateLimiter.ts`](../convex/lib/rateLimiter.ts) using `@convex-dev/rate-limiter`. Always call `rateLimiter.limit(...)` **before any DB reads** in the handler.

| Limit | Kind | Rate | Capacity (burst) | Keyed by | Why |
|---|---|---|---|---|---|
| `orderCreate` | token bucket | 120/min | 60 | `retailerId` | Shapes traffic *within* a live sale — the old 5-burst silently capped a drop at five near-simultaneous checkouts, and a throttled buyer costs a real sale (raised in `86eyph341`). |
| `orderCreateDaily` | token bucket | 500/day | 500 | `retailerId` | Bounds *total* exposure: every order schedules a Meta-billed confirmation template to a caller-chosen number via the `transactional` category, which **bypasses WABA protection by design** — so the burst bucket alone would allow ~172k attacker-driven sends/day on the shared WABA. 500/day exceeds the top tier's *monthly* order cap, so no legitimate store can hit it; continuous refill, no midnight reset to time an attack against. |
| `productWrite` | fixed window | 20/min | — | Clerk subject | One user can't bulk-trash inventory (beta: tightened from 60). |
| `productBulkImport` | token bucket | 5/min | 2 | Clerk subject | Heavy per call (many writes/txn) but bursty during an import session (beta: tightened from 20). |
| `addressUpdate` | token bucket | 5/min | 3 | `shortId` | Abuse on one order can't starve others; typical edits are 1–2. |
| `paymentClaim` | token bucket | 5/min | 3 | `shortId` | Allows legit re-submits (fix reference / replace screenshot). |
| `proofUpload` | token bucket | 3/min | 2 | `shortId` | One upload URL per claim attempt is the realistic ceiling. |

**Adding a new public mutation?** Add a matching limit here and call it first. Pick the key so abuse is contained to the smallest blast radius (per-order > per-retailer > global).

## Input validation

### Order items (`orders.create`)

- 1–100 items (`MAX_ITEMS_PER_ORDER`).
- Each product must exist, belong to the retailer, be `active`, and match the order `currency`.
- Per-product quantities are summed across line items, then checked against `stock` (positive integers only).

### Delivery address ([`convex/lib/address.ts`](../convex/lib/address.ts))

`assertValidAddress` — **Malaysia-only for v1** — trims, sanitizes, and enforces:

| Field | Rule |
|---|---|
| `line1` | 3–120 chars (required) |
| `line2` | ≤120 chars (optional) |
| `city` | 2–60 chars |
| `state` | must be one of the 16 `MY_STATES` (incl. WP Kuala Lumpur / Labuan / Putrajaya) |
| `postcode` | exactly 5 digits (`/^\d{5}$/`) |
| `notes` | ≤200 chars (optional) |
| `mapsUrl` | valid http(s) URL, ≤500 chars (optional) |

**Address invariant** (enforced in `orders.create` and `updateDeliveryAddress`): required when `deliveryMethod === "delivery"`, forbidden when `"self_collect"`. Address is editable by the shopper only while the order is `pending`.

> Expanding markets: replace `MY_STATES` with a country-keyed map and accept a country code on the address object (noted in the file header).

### Phone — three validators, by whose number it is

The full rules: [`phone-numbers.md`](./phone-numbers.md).

| Kind | Validator | Rule |
|---|---|---|
| **Buyer** (checkout, booking, track repair, counter manual bind) | `assertValidBuyerWaPhone` ([`convex/lib/buyerPhone.ts`](../convex/lib/buyerPhone.ts)) | Any country, judged by the country picked on the field (`waDialCountry`; absent = the store's). MY/SG picks take the strict mobile arm; other countries the generated dial table (trunk prefix + mobile lengths). Stored as E.164 digits, the form Meta delivers inbound. |
| **Seller / platform** (store contact, alert number, pickup manager, support line) | `assertValidMobileForCountry` ([`convex/lib/slug.ts`](../convex/lib/slug.ts)) | A mobile of the store's country; landlines refused. |
| **Machine-inbound** (Meta's `from`, the counter's store-QR scan, opt-out keys) | `assertValidWaPhone` / `normalizeWaPhone` (`convex/lib/slug.ts`) | Loose E.164-ish, 8–15 digits — never refuses a number WhatsApp just delivered. |

Optional at `orders.create` at the protocol level (the storefront form requires it); the WhatsApp webhook stamps `customer.waPhone` later if missing. **Not mirrored** — the client imports the server's own pure modules (`src/lib/schemas.ts` and `src/lib/phone.ts` import from `convex/lib/slug.ts` and `convex/lib/buyerPhone.ts`), so a client gate and the server validator can't disagree.

### Payment reference (`claimPayment`)

Trimmed; capped at 80 chars (`PAYMENT_REFERENCE_MAX`). See [`payment-handshake.md`](./payment-handshake.md).

## The mirrored-validation pattern

Some helpers that run on **both** backend and frontend are duplicated (not imported):

| Concern | Backend (security boundary) | Frontend (UX) |
|---|---|---|
| Slug / store-name shape | [`convex/lib/slug.ts`](../convex/lib/slug.ts) | [`src/lib/slug.ts`](../src/lib/slug.ts) (shape rules only; reserved handles are imported from `convex/lib/reservedSlugs.ts`) |
| Email | [`convex/lib/slug.ts`](../convex/lib/slug.ts) `assertValidEmail` | [`src/lib/schemas.ts`](../src/lib/schemas.ts) (Zod) |
| Address | [`convex/lib/address.ts`](../convex/lib/address.ts) | [`src/lib/schemas.ts`](../src/lib/schemas.ts) (Zod) |
| Legal versions | [`convex/lib/legal.ts`](../convex/lib/legal.ts) | [`src/lib/legal.ts`](../src/lib/legal.ts) |

**Rule:** change one side → change the mirror in the same PR. The backend copy is authoritative; never rely on frontend validation alone.

**Prefer importing to mirroring.** A pure module in `convex/lib/` (no Convex runtime imports beyond the `ConvexError` class) can be imported by `src/` directly, which removes the drift instead of policing it. Phone validation (`convex/lib/slug.ts`, `convex/lib/buyerPhone.ts`) and the customer display helpers (`convex/lib/customer.ts`, re-exported by `src/lib/customer.ts` since z8r3fdh274 — it used to be a hand-kept mirror) already work that way.

## Legal consent

Versions are single-sourced in [`convex/lib/legal.ts`](../convex/lib/legal.ts) (mirrored in `src/lib/legal.ts`) as ISO dates:

- `TERMS_VERSION`, `PRIVACY_VERSION`, `AUP_VERSION` — each moves independently; `convex/lib/legal.ts` is the source of truth (mirrored in `src/lib/legal.ts`)
- `LEGAL_CONTACT_EMAIL` = `hello@kedaipal.com`

Flow:
1. `createRetailer` stamps `{terms,privacy,aup}AcceptedAt` + version at onboarding. (An `acceptanceIp` column existed until 86eyn25fu; no client ever passed it and a Convex mutation can't observe the request IP, so an always-empty "legal defensibility" field was dropped.)
2. `recordConsentAcceptance` re-stamps on re-acceptance.
3. The frontend's `consentIsStale` compares stored versions against current to trigger the re-acceptance banner.

**Bumping a version:** edit the string in **both** legal files when a document's content materially changes; the banner then prompts existing retailers to re-accept.
