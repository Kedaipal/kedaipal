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

The same coverage test forbids reading `orderingPausedAt` anywhere but the
resolver's feeders, because a raw check would see the hold and miss the other
two switches.

**Never affected:** orders already placed. Tracking pages, transactional
messages, and the seller's progress, mark-paid and refund controls keep
working whatever the state. Billing is never touched by a pause.

## What each side sees

**Buyers.** A paused store shows the storefront with a banner and every
ordering CTA disabled (`seasonal-break.tsx`, generalised): "On a seasonal
break" for a hold, "Not taking orders right now" for the seller's pause (with
their note) and for Kedaipal's pause (no note). The banner line *is* the
server's refusal sentence (`unavailableMessage`), so a stale tab's error reads
like the page. An **offline** store's storefront, product, category and
checkout pages render `StoreUnavailable`: the store's name, "isn't available
right now", a link to /stores, and `noindex`. The payload carries the name
only (`status: "unavailable"`). Kedaipal's switch is always **neutral** for
buyers, never "suspended" or "unpaid" (the `lib/buyerPayments.ts` rule).

**Seller.** Settings → Store opens with the **Store status** card. It comes
first because it is the most consequential setting there. "Accepting orders"
saves on flip, with an optional buyer note (140 chars), and the helper line
says the counter keeps working and billing continues (pointing at Off-Season
Hold). Under a hold or Kedaipal's switch it is **disabled with its reason**:
our note plus "Message us", or the way to Billing. A dashboard-wide banner
shows while paused: amber with one-tap **Resume orders** for their own pause,
red with **Message us** for ours.

**Admin.** The Manage menu has **Pause ordering**, **Take store offline** and
**Reopen store**, each confirmed with a note to the seller and audited
(`admin.pauseStore`, `admin.takeStoreOffline`, `admin.reopenStore`). The
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
