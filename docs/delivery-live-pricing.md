# Live courier price at checkout (z8r3fdbvdy)

**Status: complete, pending a local test round.** Sellers can pick the mode,
stored stores migrate to it, and buyers are priced across every armed
provider.

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

## Settings

**The tile is no longer Lalamove's.** It carries both wordmarks, because the
mode prices across every armed provider and a rider-branded tile says the
wrong thing to a store that ships parcels. It stays the promoted, first tile
for the reason it always was: every tier should SEE that real courier pricing
exists.

Under it, a **"Priced by"** block states who will actually be asked and what
happens when they disagree — two armed providers is not an edge case, it is
the reason the mode exists, and a seller who doesn't know both are quoted
can't explain their own checkout prices to a buyer. With one provider armed it
says how to add the other; with none it says checkout would be refused and
points at Integrations.

**Rider-only controls follow the rider.** The vehicle picker, the pickup-pin
reference and the city-zone coverage note render only when Lalamove is
connected — they are meaningless to a parcel-only store, and they used to
render regardless because the mode was Lalamove's.

**The cold-chain constraint is stated, not discovered.** A store whose Delyva
parcel type is Chilled or Frozen sees an amber note: checkout asks for a
cold-chain price, and if the account has no cold-chain service, no price comes
back and delivery checkout is refused — riders are never substituted. A seller
must never learn that from orders quietly stopping.

**Migration:** `migrations:migrateLalamoveModeToLive` flips stored
`mode: "lalamove"` rows. Safe on every store, because it only bites where the
leak already did — a store with one armed provider has one bidder and prices
identically either way. Idempotent. The old literal stays valid (and shows as
selected) so an unmigrated row is never "nothing picked".

## Checkout

**The store's mode decides which action prices it**, handed to the client on
the reactive `delivery.quote` result as `providerAware` — never inferred.
A `"live"` store goes through `liveQuote.quoteForCheckout`; a not-yet-migrated
`"lalamove"` store keeps the single-provider action. So **a deploy alone never
changes what anyone is charged** — only the migration does, which is the whole
point of doing it as widen → migrate → narrow.

All three buyer surfaces share the hook and therefore agree: the checkout
sheet, the claim-link checkout, and the tracking page's address-edit dialog.
A claim link pricing the same cart differently from the storefront would be
its own bug.

**`no_cold_service` is its own buyer state**, not folded into "too far". The
address is fine, so the copy must not send anyone editing it — it says the
store can't ship chilled or frozen here right now and points at WhatsApp
(and pickup, where the store offers it). Folding it into `out_of_range` would
have had buyers rewriting a perfectly good address forever. All three
surfaces render it; two of them would otherwise have fallen through to a
spinner that never resolves.

**It can never be stored.** A cold-chain block refuses checkout rather than
landing the order fee-pending — a frozen cart must not quietly become "the
seller will confirm the charge later" — so `storablePendingReason()` strips it
at the three order-creating call sites.

**Delyva's inputs ride along**: the written city/state/postcode (it prices on
the postcode, not the map pin) and the cart lines (the server re-reads each
variant's weight itself). Coordinates stay required for both modes, because
the redemption check at order create is coordinate-based and one replay
control covering both providers beats two.
