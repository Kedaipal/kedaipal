# Live courier price at checkout (z8r3fdbvdy)

**Status: backend engine landed, not yet reachable by a seller.** The `live`
charge mode exists and works end to end on the server, but no settings switch
offers it and the checkout client still calls the single-provider action. Two
slices remain — see the bottom.

Reference: [`delivery-lalamove.md`](./delivery-lalamove.md) ·
[`delivery-delyva.md`](./delivery-delyva.md) · ticket
[z8r3fdbvdy](https://app.clickup.com/t/z8r3fdbvdy)

## Why it exists

A store can arm more than one booking provider (86eyjpv6z), and the checkout
fee was priced by ONE tool while dispatch could use ANOTHER. That is a
measured leak, not a hypothesis: a Lalamove-priced store collected **RM4.00**,
the vendor then booked Delyva Instant at **RM4.75**, and ate RM0.75 on every
such order.

## The rule

The fee is a PREDICTION of which tool will ship the order. Predictions drift,
so the only real question is **who absorbs the drift** — and our customer is
the vendor.

1. **Both providers quote → charge the HIGHER.** Whichever tool the seller
   picks at dispatch, the collected fee covers it; a seller who books the
   cheaper one keeps the difference, and the dispatch card shows "buyer paid
   X" beside every price so that choice is always informed.
2. **Cold cart → Delyva alone.** A rider carries no temperature guarantee, so
   a cheaper rider quote must not win — and must not stand in when Delyva has
   nothing. We refuse rather than price a frozen cart as an ambient trip.
3. **One provider armed** → that provider. This is what `mode: "lalamove"`
   always was; `live` is its superset.
4. **A quote in a currency the buyer isn't charged in is DISCARDED**, never
   converted. Reachable today: a Malaysian Delyva account attached to a
   Singapore store prices in MYR, and we hold no exchange rate.
5. **Nothing priceable → the most ACTIONABLE reason present.** "Change your
   address" is said only when every provider agrees the address is out of
   range; a seller-side breakage outranks a generic failure because its copy
   points somewhere useful.

Min-pricing was proposed and rejected (4 Sep): it is friendlier to the buyer
and recreates exactly the leak above. The over-collection is small in
practice because **Lalamove answers nothing outside its service area**, so the
both-quote case is the intra-city one, where rider and courier prices sit
close together.

**Delyva's side of the comparison is its CHEAPEST service**, because Delyva
returns a list, not a price, and the dispatch card pre-selects cheapest too —
so checkout and dispatch describe the same choice. A seller who habitually
books a dearer courier still under-collects by the difference; a per-store
"preferred courier" setting is the later tightening, deliberately not v1.

## Where the code lives

| Piece | File | Note |
| --- | --- | --- |
| The rule | `convex/lib/liveQuote.ts` | **Pure.** No network, no database — the part that carries money is testable on its own. All three money guards are mutation-tested. |
| Orchestration | `convex/liveQuote.ts` | Fetches every armed provider in parallel, applies the rule, records ONE row. Its own module because it belongs to neither provider. |
| Lalamove fetch | `convex/lalamove.ts` → `fetchLalamoveQuote()` | Lifted out of `quoteForCheckout` so a price can be fetched **without** minting a redeemable row. |
| Delyva fetch | `convex/delyva.ts` → `fetchDelyvaCheckoutQuote()` | Cheapest service; an empty list is disambiguated by `GET /service` exactly as dispatch does. |

**A losing quote leaves no row behind.** `deliveryQuotes` rows are redeemable
at order create, so only the charged price may have one.

**Item type comes from the STORE default**, exactly as dispatch does. That is
what unblocked this ticket from 86eyrmv1j (per-item temperature flags): a
frozen store quotes frozen, an ambient store quotes parcel, and nothing is
ever silently priced as ambient. When per-item flags land, only
`cartItemType()` changes.

**Cart weight is summed from the VARIANTS**, never accepted from the client —
a tampered weight would otherwise buy a cheaper courier band. No usable weight
(an unweighed product, a custom line) means Delyva simply doesn't bid, and
that is reported as a store-side gap, never as something the buyer can fix.

## Country posture

`live` is **MY-only** for now. Neither provider can quote in Singapore today —
Lalamove is gated to the MY market ([z8r3fdch3r](https://app.clickup.com/t/z8r3fdch3r))
and Delyva SG ships an empty catalogue — so offering the mode there would sell
SG sellers a switch that blocks every checkout. Adding SG to
`COUNTRY_DELIVERY_MODES` is a one-line change the moment either lands.

## Audit trail

The quote row is consumed at create, so the order keeps the evidence:
`deliverySnapshot.quoteProvider`, `.quoteServiceName` and `.quotesConsidered`
(every bid, winner included) answer "why was I charged RM5.70" months later.

## Still to build

1. **Settings** — the charge-mode switch, migrating stored `mode: "lalamove"`
   rows to `live`, and the seller-facing warning when a cold-default store's
   Delyva account has no cold-chain service (its checkout blocks, and the
   seller must not discover that as orders silently stopping).
2. **Checkout** — point the client hook at `liveQuote.quoteForCheckout`, and
   write buyer copy for the new `no_cold_service` status.
