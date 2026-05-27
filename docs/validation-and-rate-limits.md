# Validation & Rate Limits

Cross-cutting guardrails that protect every mutation: rate limiting, input validation at the trust boundary, and legal-consent versioning.

## Trust boundaries

There are three classes of mutation, each with a different trust model:

| Class | Auth | Capability | Examples |
|---|---|---|---|
| **Authenticated retailer** | Clerk identity, ownership-checked (`retailer.userId === identity.subject`) | — | `updateStatus`, `markPaymentReceived`, product writes |
| **Public storefront** | none | retailer is named in args | `orders.create` |
| **Public tracking** | none | knowing the `shortId` *is* the capability | `updateDeliveryAddress`, `claimPayment`, `generateOrderProofUploadUrl` |

Because the public classes are unauthenticated, **rate limiting is the first line of defence** and validation must assume hostile input.

## Rate limits

Defined in [`convex/lib/rateLimiter.ts`](../convex/lib/rateLimiter.ts) using `@convex-dev/rate-limiter`. Always call `rateLimiter.limit(...)` **before any DB reads** in the handler.

| Limit | Kind | Rate | Capacity (burst) | Keyed by | Why |
|---|---|---|---|---|---|
| `orderCreate` | token bucket | 30/min | 5 | `retailerId` | Each storefront throttled independently; absorbs a small checkout burst. |
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

### Phone (`assertValidWaPhone`, [`convex/lib/slug.ts`](../convex/lib/slug.ts))

Normalizes to an E.164-ish form (8–15 digits). Optional at checkout — the WhatsApp webhook stamps `customer.waPhone` later if missing. Mirrored on the frontend in [`src/lib/slug.ts`](../src/lib/slug.ts).

### Payment reference (`claimPayment`)

Trimmed; capped at 80 chars (`PAYMENT_REFERENCE_MAX`). See [`payment-handshake.md`](./payment-handshake.md).

## The mirrored-validation pattern

Helpers that run on **both** backend and frontend are duplicated (not imported) because Convex bundles from `convex/` and the app bundles from `src/`:

| Concern | Backend (security boundary) | Frontend (UX) |
|---|---|---|
| Slug / phone / email | [`convex/lib/slug.ts`](../convex/lib/slug.ts) | [`src/lib/slug.ts`](../src/lib/slug.ts) |
| Address | [`convex/lib/address.ts`](../convex/lib/address.ts) | [`src/lib/schemas.ts`](../src/lib/schemas.ts) (Zod) |
| Legal versions | [`convex/lib/legal.ts`](../convex/lib/legal.ts) | [`src/lib/legal.ts`](../src/lib/legal.ts) |
| Customer display name | [`convex/lib/customer.ts`](../convex/lib/customer.ts) | [`src/lib/customer.ts`](../src/lib/customer.ts) |

**Rule:** change one side → change the mirror in the same PR. The backend copy is authoritative; never rely on frontend validation alone.

## Legal consent

Versions are single-sourced in [`convex/lib/legal.ts`](../convex/lib/legal.ts) (mirrored in `src/lib/legal.ts`) as ISO dates:

- `TERMS_VERSION`, `PRIVACY_VERSION`, `AUP_VERSION` (all `2026-05-26` at time of writing)
- `LEGAL_CONTACT_EMAIL` = `hello@kedaipal.com`

Flow:
1. `createRetailer` stamps `{terms,privacy,aup}AcceptedAt` + version + best-effort `acceptanceIp` at onboarding.
2. `recordConsentAcceptance` re-stamps on re-acceptance.
3. The frontend's `consentIsStale` compares stored versions against current to trigger the re-acceptance banner.

**Bumping a version:** edit the string in **both** legal files when a document's content materially changes; the banner then prompts existing retailers to re-accept.
