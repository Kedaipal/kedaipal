# Courier wallets

ClickUp [`z8r3fdrgxc`](https://app.clickup.com/t/z8r3fdrgxc) (the data seam) and
[`z8r3fdx34j`](https://app.clickup.com/t/z8r3fdx34j) (the UX), built on the
Lalamove half that shipped with `86eye9xd4` 6A.

Every courier Kedaipal books through is **BYO and prepaid**. The seller's own
wallet at the courier pays each booking: the Lalamove Business wallet, Delyva
credit, the EasyParcel wallet. Kedaipal never holds that money and can never
top it up. Before this, a seller found out a wallet was empty when a booking
failed, with a buyer waiting. Now every surface where money is spent or
checked says what the wallet holds, how fresh that is, and where to top up.

**Naming rule.** Always "*Lalamove wallet*" / "*Courier wallets*". Never
"credits": Kedaipal Credits own that word ([`credits.md`](./credits.md)).
Copy never implies Kedaipal holds or can top up this money.

## How each courier reports

No courier exposes a top-up API, and they disagree about the balance too. The
`model` in `WALLET_PROVIDERS` (`convex/lib/courierWallet.ts`) names which kind
each one is:

| Courier | Model | Where the number comes from |
| --- | --- | --- |
| Lalamove | `push` | `WALLET_BALANCE_CHANGED` webhook on every top-up and deduction. No endpoint to ask. Attributed by the key fingerprint, verified by the store's own secret (`http.ts`, `recordLalamoveWallet`). |
| EasyParcel | `pull` | `GET /wallet` — on connect, on the Integrations Refresh, with every dispatch quote, and from the top-up sheet's "I've topped up — check again". |
| Delyva | `refusal` | No balance endpoint. The insufficient-credit refusal is the only place it appears: `"…Bal: 0, Price: 5.00"` (`parseDelyvaRefusal`). |

Lalamove also records a **refusal** (`ERR_INSUFFICIENT_BALANCE` on a live key)
without a number. The wallet then reads `short`: known to be too low, not by
how much.

## The seam: one table, one writer, one read model

- **Table.** `courierWallets`, one row per (store, provider). Not on
  `retailers`, because a balance moves on every booking and a retailer patch
  re-runs every open storefront tab.
- **Writer.** `recordObservation` (`convex/courierWallets.ts`) is the only way
  a balance or refusal lands. It is **monotonic on observation time**, so a
  late webhook never overwrites a newer pull. The internal mutations `record`
  and `recordDelyvaRefusal` wrap it for actions.
- **Read model.** `readCourierWallets` returns one `CourierWalletView` per
  *connected* account, in registry order. The public query
  `courierWallets.list` serves it, gated on **orders read**: whoever books a
  courier must see whether the wallet can pay (the ticket's decision 4).
- **EasyParcel dual-writes.** Its connection row keeps its own balance
  snapshot, because the account-country check and dispatch read it today.
  `storeBalance` and the connect write both, in one mutation. Dropping the
  connection's copy is a later narrow.
- **…and the read falls back to it.** A store connected before this table
  knew EasyParcel has a balance on its connection and none on the wallet row.
  `withConnectionSnapshot` reads the newer of the two (newest wins, like the
  writer), so such a store shows the number we already hold instead of "—"
  until its next refresh (found in the hands-on test, 30 Oct 2026). No
  backfill needed.

### States (`walletState`)

| State | Meaning | Row says |
| --- | --- | --- |
| `ok` | Balance at or above the low line | the amount, "Updated 3m ago" |
| `low` | Under the line | amber, "Low", Top up |
| `empty` | Zero or below | red, "Empty — the next booking will fail", Top up |
| `short` | A refusal newer than the last balance, with no number | red "Too low", when it was refused, Top up |
| `unreported` | Nothing seen yet (Lalamove until money moves; EasyParcel before its first read) | "Not reported yet" — **never RM 0** |
| `unshared` | A refusal-model courier with nothing seen (Delyva) | "Not shared", Check in Delyva |

Two modifiers sit across every state. A **test account** (Lalamove `pk_test`,
Delyva demo, EasyParcel sandbox) shows a TEST chip, says "play money", and
never asks for a top-up. With nothing seen yet it still names the state
("Not shared", "Not reported yet"), never a bare "—". A balance **older than 24 hours** greys out and says
"May be out of date", because bookings made outside Kedaipal spend the same
wallet.

### The low line

Default **RM 30 / S$ 15** per wallet currency (`defaultLowAlertMinor`, about
three trips). Not a converted amount: an S$ wallet gets an S$ line. The seller
changes it per wallet with the "Alert at RM 30" control on the row
(`setLowAlert`, integrations write, refused on a lapsed store). Bounds are
1–1,000 in the wallet's currency. `null` returns to the default.

### Block or warn (`walletVerdict`)

Only a **fresh pulled** balance (EasyParcel, read in the last 5 minutes) that
can't pay **disables Book**, with the reason as Book's description. A pushed
(Lalamove) or refusal-seen (Delyva) number may be stale, so a short one only
**warns**: amber, how short, "*Lalamove has the final say*", Book stays live.

**A test wallet is judged the same way.** A sandbox refuses a booking its play
money can't cover just as a live account does, so a fresh short sandbox read
disables Book too. Only the words change: "*Your EasyParcel test wallet has
RM 19.80 … Add test credit in your EasyParcel sandbox first*", never "Top up".
(The first build exempted test wallets; the hands-on test caught it as a
regression of the old EasyParcel card, which blocked on any short quote.)
On a sandbox key the warn also drops Lalamove's "top up the Business account"
note: there's no real wallet behind play money, and the dialog's own banner
already says so.

**Never across currencies.** `walletVerdict` takes the quote's currency and
says nothing (`unknown`) when the balance is in another one, so a line can
never call RM 3.00 "HK$1.75 short". A provider refusal (`short`) still warns,
since it is the provider's own verdict. Found on the Delyva demo, which quotes
in HKD (hands-on test, 31 Oct 2026); every dispatch card passes its quote's
currency, and the argument is required so a new caller can't forget it.

### The low email

The owner gets **one email per crossing** into `low`, `empty` or `short`
(`lowWalletNotice`), only for an **armed, live** wallet. `lowNotifiedAt` stamps
the send and clears when the wallet is healthy again, so the next crossing is
news. Copy is in `convex/lib/courierWalletEmailCopy.ts` (en/ms/zh). The send
re-reads the wallet first, so a top-up that lands in between cancels it.

### Lifecycle

- **Lalamove key** saved: the row is created with the key's fingerprint
  (`syncLalamoveWallet`). A different key is a different account and starts
  `unreported`. Clearing the key deletes the row. The seller's alert line
  survives a key rotation.
- **Delyva**: a connect to a different customer id, and every disconnect,
  clear the row (`clearCourierWallet`).
- **EasyParcel**: every (re)connect clears it and records the balance that
  sign-in just read; disconnect clears it.
- **Country switch**: `resetWalletsForCountrySwitch` drops every balance from
  the old country's accounts. Lalamove keeps its fingerprint so its next event
  attributes. A custom alert line goes too, since it was in the old currency.

### A trap found in passing

Lalamove's webhook envelope `timestamp` arrives in **seconds**. The 6A code
stored it raw as `balanceAt`, which reads as 1970 to "updated … ago" and loses
every newer-wins comparison against a millisecond observation. It now goes
through `parseLalamoveEventTime`, like every order event.

## Surfaces — one row everywhere

All of them draw `CourierWalletRow` (`src/components/deliveries/`); its words
come from `presentWallet` (`src/lib/courier-wallets.ts`). One idea, one control.

| Where | What |
| --- | --- |
| **Order page, dispatch card** | `DispatchWalletLine` above Book, on all three couriers. Quiet when it covers; amber warn or red block per `walletVerdict`. Lalamove adds a "Good to know" list (city zone only, free cancel until accepted, unassigned bookings expire). Delyva adds per-courier margin ("+RM 0.80 kept" / "RM 3.40 from your margin") and "Only couriers switched on in your Delyva account show here (N on)". |
| **Deliveries page** | "Courier wallets" section at the **top**, always while a courier is connected. Every row carries its alert control. |
| **Home** | The **Balances** card: Kedaipal credits and the courier wallets, each under its own label. Placed by the more urgent half (`balancesPlacement`): credits out → top of the page; credits low or a booking courier needing a top-up → under the today strip; otherwise in "Your store". **The half that moved the card leads it** (`balancesWalletsFirst`): when credits are fine and a wallet lifted the card, the wallets come first; otherwise credits do. |
| **Settings → Integrations** | Each courier card's Wallet block — Top up shown even when healthy, Refresh for EasyParcel. |
| **Email** | The once-per-crossing low notice above. |

Courier wallets are **never in the profile menu** (Zaki, 29 Oct 2026): that
menu carries Kedaipal credits only.

### The top-up hand-off (`CourierTopUpSheet`)

No provider has a top-up API, so Top up is always a guided trip out: what the
wallet holds now, three steps at the courier, the courier's own guide when it
publishes one, and **Open <Courier>**. Lalamove's steps name the Business
account (the personal app is a different wallet). Only EasyParcel gets
"I've topped up — check again", because it is the one wallet we can ask;
Lalamove pushes on its own and Delyva never shares.

Three more pieces from Arif's 24 Oct scope comment (built 31 Oct):

- **Suggested top-up.** "RM 50 · ~4 trips", "~1 week", "~2 weeks" from the
  store's OWN bookings with that courier over the last 30 days
  (`courierWallets.topUpSuggestion`, `topUpSuggestions`): the average charged
  booking × trips, rounded up to a whole 5. Hidden below 5 bookings, for a test
  wallet, and when the wallet isn't in the store's currency. A guide, never a
  charge: the seller types the amount at the courier.
- **Never run dry.** EasyParcel offers card auto top-up on its own side, so
  its sheet links straight to the account's Auto Topup page, per country
  (`autoTopUpUrl`). Lalamove and Delyva have none.
- **The trip out is remembered.** "Open <Courier>" marks that wallet as
  waiting (`src/lib/top-up-awaiting.ts`), and every surface showing it says
  "Waiting for Lalamove to report your top-up — this updates by itself" until
  a NEWER balance lands; it's derived, so a landed top-up ends it, and it
  lapses after 30 minutes. For EasyParcel, coming back to the tab re-reads the
  balance by itself (once a minute at most, across every open surface) and
  says whether the top-up has landed yet. Delyva never reports, so it never
  waits.

Destinations (`WALLET_PROVIDERS`, checked 29–30 Oct 2026 — no provider
publishes a deep top-up URL, so these are each provider's web app plus its own
article):

| Courier | Opens | Guide |
| --- | --- | --- |
| Lalamove | `web.lalamove.com` | MY / SG blog guides |
| Delyva (MY) | `my.delyva.app` | none published |
| EasyParcel | `app.easyparcel.com/sg/en/` (SG) · `/my/en/` (MY) — the bare root redirects every account to the Malaysian site | SG help-centre article; auto top-up `…/<country>/en/account/auto-topup/` (checked 31 Oct) |

## Deliberately not built

- **Instant vs parcel grouping on the Delyva list.** It needs a service-code
  mapping verified on a real account with Grab Express and pandago switched
  on. Unverified, the ticket's own kill clause applies: one list, cheapest
  first.
- **A Delyva balance endpoint.** Asked of Delyva as the ticket's T0; until
  they answer, Delyva ships the honest "Not shared" row.
- **A fleet-wide pull cron.** No polling; EasyParcel is read when the seller
  is looking or booking.

## Operator notes

- **No new backfill.** Confirm `courierWallets:backfillFingerprints` has run
  on each deployment (it shipped with 6A). Stores whose keys predate the table
  never show a Lalamove balance until it has.
- **Schema**: widen only (`provider` to all three couriers, `keyFingerprint`
  optional, new optional fields). No migration.
- **Env vars**: none.
