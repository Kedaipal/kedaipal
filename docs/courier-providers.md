# Courier provider registry — one author for "which booking providers exist"

> **Status:** shipped with z8r3fdcje2 PR1 (Oct 2026). The registry is
> `convex/lib/courierProviders.ts`; this doc is the "how to add a provider"
> guide the next integration follows. Provider-specific behaviour stays in
> each provider's own doc ([delivery-lalamove.md](./delivery-lalamove.md),
> [delivery-delyva.md](./delivery-delyva.md)).

## Why it exists

Until PR1 the provider union was hand-spelled in ~20 places — five schema
validators, the lib types (`LiveQuoteProvider`, `emailCopy.deliveryProvider`),
`orders.riderOwnsTransition`, the dispatch hub's tab type, the landing
catalogue's `CourierProvider` — so adding a provider meant finding every site
by grep. With EasyParcel as the third provider and more expected (Zaki, 9 Oct
2026: "it's just going to have more and more"), the union now has one author
and everything else derives from it.

## What the registry holds

`convex/lib/courierProviders.ts`:

| Export | What it is | What enforces completeness |
| --- | --- | --- |
| `COURIER_PROVIDER_IDS` | The id list — the single source. | — |
| `CourierProviderId` | The union type, derived from the list. | — |
| `courierProviderValidator` | The one schema validator for every `provider` field (`deliveryJobs`, `deliveryQuotes`, `deliverySnapshot.quoteProvider`, `considered[]`, email args). | `true satisfies MutuallyAssignable<…>` pin — drift from the id list refuses to compile; `courierProviders.test.ts` pins the runtime members too. |
| `COUNTRY_COURIER_BOOKING` | Per-provider, per-country booking gate (the former `COUNTRY_RIDER_BOOKING` / `COUNTRY_DELYVA_BOOKING` tables, one row per provider, with each country's history recorded on the entry). | `Record<CourierProviderId, Record<Country, boolean>>` — a new provider cannot compile without stating every country. |
| `courierBookingAllowed(provider, country)` | The generic gate read. `riderBookingAllowed` / `delyvaBookingAllowed` in `lib/delivery.ts` are thin wrappers kept so no caller churned. | Equivalence pinned in `courierProviders.test.ts`. |

Beside it, `convex/lib/courierBooking.ts` keeps the armed-predicate registry
(`PROVIDER_BOOKING_ARMED`) that `storeBooksCouriers` folds over — same
`Record` discipline, so the storefront's `booksCouriers` bit can never
silently ignore a new provider.

## What the seam deliberately is NOT

A function-path rewrite. `convex/lalamove.ts` and `convex/delyva.ts` keep
their public function paths — deployed clients hold references to them and
**Convex function paths must not move** (the Aug 2026 cleanup rule). The
shared machinery was already provider-neutral before PR1 (`deliveryJobs`
ledger + `lib/deliveryJobs.ts` status rules, `lib/liveQuote.ts` choose-rule,
`convex/liveQuote.ts` checkout orchestrator); the registry adds the missing
single author for identity, gating and arming.

## Adding a provider (the EasyParcel path, PR2 of z8r3fdcje2)

1. Add the id to `COURIER_PROVIDER_IDS` and widen `courierProviderValidator`
   — the `satisfies` pin walks you there. This is the schema widen: every
   `provider` field accepts the new id at once (additive, dev-safe).
2. The `Record` registries now refuse to compile until you state the
   provider's `COUNTRY_COURIER_BOOKING` row and its armed predicate in
   `lib/courierBooking.ts`.
3. Write the provider pair: `convex/lib/<provider>.ts` (pure wire logic —
   bodies, parsers, status normaliser, webhook/poll verification) +
   `convex/<provider>.ts` (Convex functions: connect/settings, prepare/confirm
   /cancel booking, status sync, dispatch-state query), mirroring the Delyva
   structure.
4. Credentials arm on `retailers` (BYO posture), webhook route in
   `convex/http.ts` (or a polling cron where the provider pushes nothing),
   checkout branch in `convex/liveQuote.ts` if it quotes at checkout.
5. Seller surfaces: an Integrations card, a dispatch card + `<provider>Surface`
   in `src/lib/dispatch-surface.ts`, and a tab in the dispatch hub (the hub's
   tab strip takes its providers from the registry id list).
6. Its own `docs/delivery-<provider>.md`, and a row in `docs/README.md`.
