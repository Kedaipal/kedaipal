# Store availability — Open / Paused / Offline

`z8r3fdudf7`. One answer to "is this store taking orders, and if not, whose
switch says so?", read by every order door and every surface.

## Why

Before this there was no way to switch a store off:

- **Sellers** could only stop orders through **Off-Season Hold**, which is a
  billing status. Trial and comped stores can't enter a hold, so a comped
  partner had no off switch at all, and a paying seller who just wanted a week
  off had to change their billing to do it.
- **Admins** could only **hide a store from /stores**. The storefront stayed
  live and orderable. The live case: Corks Out pulled out of Campfest (14 Oct),
  was hidden from /stores, and `/corks-out` still took orders on 14 products.

## The model

Three authors, one resolver (`convex/lib/storeAvailability.ts`):

| Switch | Who | Stamp | Effect |
|---|---|---|---|
| Seller pause | Seller (Settings → Store) | `storeAvailability.sellerPausedAt` (+ note) | Storefront browse-only; **counter stays open** |
| Off-Season Hold | Seller (Billing) | `retailers.orderingPausedAt` (unchanged) | Browse-only; counter closed |
| Kedaipal pause | Admin (Manage menu) | `storeAvailability.adminMode = "paused"` | Browse-only; counter closed |
| Kedaipal offline | Admin (Manage menu) | `storeAvailability.adminMode = "offline"` | Storefront gone: neutral page, off /stores, sitemap, search |

**Precedence:** admin offline > admin paused > hold > seller paused > open.
The strongest switch speaks; lifting it reveals the next one down. A Reopen
never reopens what the seller shut themselves, and ending a hold never lifts a
seller's pause. Each author has its own stamp, so one can never clear
another's.

**Its own table, not fields on `retailers`** (a deliberate change from the
ticket). A new field on the retailer row poisons the shared dev deployment for
every branch without it the moment one store uses the feature, and a patch to
that row re-runs every open storefront subscription. The cost is one indexed
read per storefront load and order, plus one table read for the directory and
sitemaps. The table only holds stores that ever used a switch.

## The doors

Every function that inserts an order calls a guard, and
`storeAvailabilityCoverage.test.ts` fails if one stops:

| Door | Rule |
|---|---|
| `orders.create` (storefront, event RSVP) | buyer: closed by any switch |
| `bookings.requestBooking` | buyer |
| `counterCheckout.*` (bind, anonymous, create) | **counter**: open under the seller's own pause |
| `orderClaims.sendClaim` / `resend` / `commit` | counter. A claim link is a counter sale finished on the buyer's phone |
| Store-QR poster scan (`startSessionFromStoreQr`) | counter. A closed counter replies with the neutral sentence instead of opening a session that can never ring up |

The counter guard takes a **required `audience`**, because that door is
reached from both sides of the till. The seller ringing up, or sending or
resending a claim link, is refused with **`counterClosedMessage`**: who closed
it, and the one way back ("Message us" for Kedaipal's switch, Billing for a
hold). A buyer committing a claim gets the storefront's sentence. The first
cut gave the seller the buyer's "Browse the menu and check back soon".

The same coverage test forbids reading `orderingPausedAt` anywhere but the
resolver's feeders, because a raw check would see the hold and miss the other
two switches.

**Never affected:** orders already placed. Tracking pages, transactional
messages, and the seller's progress, mark-paid and refund controls keep
working whatever the state. Billing is never touched by a pause. The one
thing an offline store's order page loses is its **way back into the store**
(the store-name link and "Continue shopping", `z8r3fducgw`): there is no
storefront to go back to, so `orders.get` carries `storeOffline` and the page
offers none. A paused store keeps both — its storefront still browses.

## What each side sees

**Buyers.** A paused store shows the storefront with a banner and every
ordering CTA disabled (`seasonal-break.tsx`, generalised): "On a seasonal
break" for a hold, "Not taking orders right now" for the seller's pause (with
their note) and for Kedaipal's pause (no note). The banner line *is* the
server's refusal sentence (`unavailableMessage`), so a stale tab's error reads
like the page. An **offline** store's storefront, product, category and
checkout pages render `StoreUnavailable`: the store's name, "isn't available
right now", and a link to /stores. The payload carries the name only
(`status: "unavailable"`). **`noindex` and the store-named title are in the
server-rendered head:** each route's loader returns
`{ unavailable: true, storeName }`, and its `head()` answers with
`storeUnavailableHead`, which **replaces** the root's "index, follow". The
first cut rendered the robots `<meta>` inside the component. React hoists
that only in the browser, so the SSR HTML a crawler reads said "index,
follow" under a generic title, and the hydrated page carried both tags.
**The public catalogue reads answer empty for an offline store too**
(`products.list`, `products.getPublicBySlug`, `products.popularProducts`,
`categories.listActivePublic`, `categories.getPublicPage`, via
`isStoreOffline`), so "no catalogue" holds for a direct Convex call, not
only for the routes that ask `getRetailerBySlug` first.
`storeAvailabilityCoverage.test.ts` lists them, and a new public catalogue
read belongs on that list. A **pause** keeps the catalogue: buyers can still
browse. `bookings.availability` is left open: it takes a product id the
caller already has and only says which nights are full, and every booking
door refuses. Kedaipal's switch is always **neutral** for buyers, never
"suspended" or "unpaid" (the `lib/buyerPayments.ts` rule).

**Seller.** Settings → Store opens with the **Store status** card. It comes
first because it is the most consequential setting there, full width above
the tab's two columns, and while the store isn't taking orders the settings
rail's Store row reads **Paused** / **Offline** in amber instead of the
store name, so it shows from every other tab. "Accepting orders"
saves on flip, with an optional buyer note (140 chars), and the helper line
says the counter keeps working and billing continues (pointing at Off-Season
Hold). Under a hold or Kedaipal's switch it is **disabled with its reason**:
our note plus "Message us", or the way to Billing. **A lapsed (past due or
comp-ended) store keeps the switch** (Zaki, 15 Oct 2026): its storefront
still takes orders by design, so pausing is the seller's only way to stop
that, and resuming only returns to that default. `setAcceptingOrders` is the
one seller write exempt from the view-only lock (`sellerLockCoverage.test.ts`,
"winding down"), and the card and banner read
`useAreaLock("store_settings", { openWhenLapsed: true })`, so the Store
settings grant still applies to a teammate. A dashboard-wide banner
shows while paused: amber with one-tap **Resume orders** for their own pause,
red with **Message us** for ours. Under a hold or Kedaipal's switch the
**Counter page** says it is closed under its header, greys **New order**, and
disables the checkout's primary button with the same sentence as its helper
line (`useCounterClosedReason`). Open checkouts stay listed and can still be
cancelled. The first cut left the counter looking fully open until the final
tap was refused.

**Admin.** The Manage menu has **Pause ordering**, **Take store offline** and
**Reopen store**, each confirmed with a note to the seller and audited
(`admin.pauseStore`, `admin.takeStoreOffline`, `admin.reopenStore`).
`clearStoreAvailability` returns the store's state **after** lifting the
switch, from the resolver, and the toast (`reopenedToast`) names what still
keeps orders off (a hold, the seller's own pause) from that answer, never from
`subscriptionStatus`. The
seller sheet shows a **Store status** row. The directory's status line names
whose switch it is, and a **Paused / offline** filter chip sits in the front
group.

## Decisions

1. The seller gets **Paused** only, never Offline. Offline is moderation; a
   seller who wants to stop for good deletes the store.
2. The counter stays open under the seller's own pause.
3. No auto-reopen date in v1. The note covers "back on 1 Nov".
4. `store_settings: write` can pause (not owner-only), matching the
   marketplace switch.

## Code

| Piece | Where |
|---|---|
| Rules (pure) | `convex/lib/storeAvailability.ts` |
| Guards, seller switch, seller read | `convex/storeAvailability.ts` |
| Admin switch | `convex/admin.ts` (`setStoreAvailability`, `clearStoreAvailability`) |
| Buyer banner + copy | `src/components/storefront/seasonal-break.tsx` |
| Offline page | `src/components/storefront/store-unavailable.tsx` |
| Seller card / banner | `src/components/settings/store-status-card.tsx`, `src/components/app/store-availability-banner.tsx` |
| Admin | `seller-manage-menu.tsx`, `seller-sheet.tsx`, `src/lib/admin-seller-view.ts` |
