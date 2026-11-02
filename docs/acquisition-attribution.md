# Acquisition attribution + the CAC ledger

ClickUp [`86eye3eyp`](https://app.clickup.com/t/86eye3eyp). Admin-only: a seller
never sees their own channel.

## The question it answers

**Which way of finding sellers is worth repeating?** Blended CAC (all spend ÷
all new payers) mixes a bazaar walk-in with a talk, a referral and a TikTok
boost, and can't answer it. Two records can:

| Record | What it holds | Who writes it |
|---|---|---|
| `retailers.acquisitionSource` (+ `acquisitionNote`, `acquisitionSetBy`, `acquisitionSetAt`) | Which channel won this store | An admin (authoritative), or the seller at onboarding (a claim) |
| `acquisitionCosts` | What one channel cost Kedaipal in one month: cash (MYR sen) + founder hours + a note | An admin, on `/app/admin/acquisition` |

CAC per channel is **derived at read time** from those two, never stored
(`convex/lib/metrics.ts`), so a policy change — the founder hourly rate —
recomputes every month at once.

## The rules (all in `convex/lib/metrics.ts`)

- **A closed channel list**, `ACQUISITION_CHANNELS`: `walk_in`, `talk_event`,
  `referral`, `product_led`, `inbound_social`, `inbound_search`, `outbound_dm`,
  `founder_network`, `other`. Validated in code, **not** in the schema (both
  fields are `v.string()`), so a channel is added without a migration. Every
  admin write rejects anything else; onboarding drops it instead (a stale tab
  must never fail a signup).
  - `product_led` wasn't in the original ticket. It covers the powered-by
    badge, the `/stores` directory and QR posters, which would otherwise be
    folded into `other` and hide our cheapest channel.
- **Founder time is costed at RM50 an hour** (`FOUNDER_HOURLY_RATE_SEN`).
- **CAC = (cash + hours × RM50) ÷ stores tagged to the channel whose FIRST
  paid invoice landed that month.** A renewal is not a new payer. A channel
  with no new payer shows "—", never RM 0: "no payer yet" is not "free". (A
  channel that DID win a store at no cost does read RM 0 — that one is true.)
- **Only an admin tag counts.** A seller's onboarding answer is stored with
  `acquisitionSetBy: "seller"` and stays out of CAC until an admin confirms
  or changes it. A seller answer can never overwrite an admin tag (it is only
  ever written at `createRetailer`).

### Deliberately NOT here

Gross-margin bands and messages-per-order were in the original ticket. They
were dropped (28 Oct 2026): the "3 utility / 2 service per order" figure went
stale when [`86eyd63r8`](https://app.clickup.com/t/86eyd63r8) cut buyer sends
to one per order, pricing moved to credits, and the source-of-truth split
(decided 27 Jul) keeps `Kedaipal_Tier_Margin_Model.xlsx` as the model and
Convex as the ledger of actuals.

## Not the same as `signupSource`

| | `signupSource` ([analytics.md](./analytics.md)) | `acquisitionSource` |
|---|---|---|
| Captured | Automatically, from a `?src=` link tag | By a person |
| Vocabulary | Free-form, sanitised (`powered-by`, `spotlight-thg`, …) | The closed channel list |
| Absent for | Walk-ins, talks, personal intros — most of the early payers | Nobody, once the backfill is done |

Both stay. The automatic signals feed a **suggestion** (`suggestChannel`): a
`referrals` row or a `referral-*` tag → Referral; `powered-by*`, `directory`,
`qr-poster` → Product-led; `spotlight-*` → Talk or event; `tiktok*`,
`instagram*`, `facebook*` → Social media; `google*` → Search. No tag suggests
nothing — a walk-in and a founder intro look identical in the data, and a
guess would teach the admin to click through.

## Where it shows

**Per store — All sellers.**
- The store drawer's **"How they arrived"** section opens with a **Channel**
  row: the conclusion above the raw signals (signup tag, referral). It has
  three states: tagged (pill, note, "Tagged by Kedaipal · 3 days ago",
  Change), the seller's unconfirmed answer (dashed pill, "Not counted towards
  CAC until you confirm or change it"), and untagged (amber for a payer with
  the suggestion named, neutral for a store that hasn't paid).
- The **Manage** menu's "Acquisition channel" item opens the same dialog, beside
  the ownership item and before the commercial ones. Its icon turns amber for an
  untagged payer.
- The directory pill reads `Talk or event · via spotlight-thg`. An untagged
  payer reads `Untagged`, and a seller's claim reads `Social media?`, both in
  amber.
- **"Untagged payers"** filter chip: every store that has ever paid an
  invoice, churned ones included, with no admin-confirmed channel. It sits in
  the front group of chips (things Kedaipal owes an action) with an amber
  count, and is how the backfill is cleared to zero.

**Across stores — `/app/admin/acquisition`.** In the Admin sidebar right after
Billing: money out beside money in, never inside it. Also a bottom-nav tab on a
phone.
- A month switcher (`?month=2026-09`; you can't step into the future). The
  summary tiles show cash, founder time, total cost and new paying stores with
  blended CAC.
- One editable row per channel, with new payers and CAC.
- An amber notice when stores paid that month with no confirmed channel, which
  links to the filter.
- An empty month offers "Start from <last month>'s figures".
- A sticky save bar that counts unsaved changes and refuses to save while an
  amount isn't a number.
- Blank = no spend. Clearing a row deletes it.

**Onboarding.** "How did you find Kedaipal? (optional)" — chips in the
seller's words, nothing pre-selected (a default would quietly become the top
channel). Tap again to clear. "Another Kedaipal seller" opens the existing
referral field in place, so the two questions about the same thing read as
one. The field also stays open whenever it holds a store, and a referral cookie
pre-picks the chip, because that IS the answer.

## Functions (`convex/metrics.ts`)

| Function | Gate | Does |
|---|---|---|
| `setAcquisitionSource({ retailerId, source, note? })` | `requireAdmin` | Tags (or confirms) a store; always `setBy: "admin"`; re-tagging without a note clears the old one; audited `metrics.setAcquisitionSource` |
| `recordSpend({ periodStart, entries[] })` | `requireAdmin` | Upserts on `(periodStart, channel)` via `by_period_channel`; a blank entry deletes the row; refuses an unknown or duplicate channel, a bad amount, a mid-month key and a future month; one global audit row per save |
| `getMonth({ periodStart })` | `requireAdmin` | Every channel (blank = 0), new payers per channel, CAC, untagged new payers, and the previous month's figures. First payers come from ONE `invoices.by_status = paid` scan (capped at 5,000; the page says so if reached), not a query per store |

`createRetailer` takes an optional `acquisitionSource` (the onboarding answer).

## Operator work

- **Backfill, once:** open All sellers → Untagged payers, and tag each one
  (churned stores too — churn by channel is half the point). Then record spend
  for Jul–Oct 2026 on the Acquisition page.
- No env vars, no migration, no cron. The schema change is a widen: optional
  fields on `retailers`, plus a new table.
