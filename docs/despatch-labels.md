# Despatch Labels (shipping labels / AWB printing)

**Status: implemented.** ClickUp [`86eyp63mp`](https://app.clickup.com/t/86eyp63mp).

The address label a seller sticks on a parcel. Kedaipal's **third** PDF document,
built on the same pdf-lib pipeline as the order receipt and the subscription
invoice ([`invoices-receipts.md`](./invoices-receipts.md)), and the only one that
gets printed in stacks.

> **Why its own doc rather than a section in [`fulfilment.md`](./fulfilment.md):**
> that page (900+ lines) is about how an order *travels* — delivery modes,
> charges, pickup points, courier tracking. This is a *document* with its own
> template config, two paper sizes, two entry points, skip rules and a pair of
> hand-rolled encoders. It cross-links from both fulfilment (the manual-courier
> section that feeds it) and invoices-receipts (the pipeline it shares).

---

## What it is — and what it is not

**It is Kedaipal's own despatch label.** It carries the courier name and
consignment number the seller recorded themselves through the manual-courier
flow ([`86eyehvk4`](./fulfilment.md#manual-courier--tracking-number-on-shipped-2026-07-29-clickup-86eyehvk4)),
plus the addresses, the amount to collect and a QR to the seller's storefront
(see "Why the QR is the storefront" below).

**It is not a courier-issued Air Waybill.** A courier's official consignment note
is minted by *their* booking API and carries *their* barcode symbology, routing
codes and sortation marks. That needs the deferred Delyva/EasyParcel work, and
is explicitly out of scope here. The distinction is stated in the settings card,
in the schema comment, and at the top of every module — because a seller who
believes this replaces the courier's own AWB will have a bad morning.

The ticket's three open questions were decided before the build:

1. **We generate our own label**, not a courier-official consignment note.
2. **Default paper is `a4-4up`** — every seller already owns an A4 printer;
   thermal is the upgrade path, not the entry ticket. Both sizes really work.
3. **The payment strip is cause-true.** A genuinely unpaid order prints the
   amount to collect, big. A settled order prints `PAID - NOTHING TO COLLECT`.
   Printing a COD figure on an already-paid order is how a seller gets paid
   twice, so it can't happen by construction (see `payment` in the view-model).

---

## Two entry points

| | Where | Who | Plan |
|---|---|---|---|
| **One label** | Order detail — a `Print label` button *before* `Download receipt` (desktop header actions; mobile "More actions" panel) | Owner or admin act-as, by `shortId` | **All tier** |
| **A selection** | Order inbox → select mode → the printer button on the bulk bar (carries the live count) → the print dialog | Owner or admin act-as | **Pro** (`orderInbox`) |
| **Everything ready** | Order inbox → the **Ready to ship** strip → the print-queue modal (no prior selection) | Owner or admin act-as | **Pro** (`orderInbox`) |

**Why single is all-tier and batch is Pro.** A seller shipping a parcel must
always be able to put an address on it — that is correctness, not an upsell (the
flat-delivery-fee posture). Bulk printing, on the other hand, lives *in* the
inbox's bulk bar, which is already the Pro "Order Inbox" surface the pricing
table sells; it rides the exact gate `orders.exportOrders` uses, admin act-as
bypassing both. No new `PLAN_FEATURES` entry, so no pricing-table row moved.

The label button is *hidden* on orders that can't carry one (cancelled, or no
delivery address) rather than disabled — its absence on a pickup order explains
itself, and the batch flow is where skipped orders get counted and named.

### "Ready to ship" — the one-click despatch run

Packed **and** paid **and** going out by parcel:

```ts
status === "packed" && paymentStatus === "received" &&
deliveryMethod === "delivery" && deliveryDirection !== "collection" &&
deliveryAddress !== undefined            // convex/lib/pdf/awb.ts
```

- `packed`, not `confirmed` — packing is the step that produces a physical
  parcel. Not `shipped` — those have already gone.
- **Payment received** keeps unpaid orders out of a one-click bulk print; a
  seller sends those COD deliberately, from a selection.
- **Collection orders are excluded** ([`86eyg0n8e`](./delivery-lalamove.md)):
  their rider travels buyer → seller, so "packed" there means work in progress,
  not a parcel waiting on a courier. An explicit selection still prints one, with
  the parties swapped (below).

**The strip opens a queue modal, not a blind print.** The owner's own test found
the gap: he printed 5 labels, 2 more orders came in paid+packed, and the strip's
count became 7 with no way to print only the new ones. Tapping the strip now
opens the print dialog in **queue mode**: every ready order listed with a
checkbox (shortId, buyer, total), select/deselect all, and a printed-state
memory —

- **`orders.labelPrintedAt`** (optional epoch-ms, no backfill) is stamped by
  BOTH generate actions after a successful PDF build — never on skipped orders,
  re-stamped on re-print (it records a fact, not a one-shot). "Printed" means
  "a label PDF containing this order was generated" — we can't see the physical
  printer, and the modal's chip wording stays honest about that.
- **Unprinted rows open CHECKED; previously-printed rows stay listed but
  UNCHECKED**, wearing a "Printed · 2h ago" chip — so the 5+2 case opens with
  exactly the 2 new orders selected, and a reprint is still one tap on its row.
  The chips update live after a print (the queue query is reactive; the stamp
  mutation makes that free). The default-check rule is a pure helper
  (`defaultCheckedQueueIds`, `src/lib/awb-labels.ts`), unit-tested.

**Printing never advances an order.** A label in the printer tray is not a parcel
in a courier's hands, so nothing is stamped `shipped` — the seller does that from
the bulk bar when they actually hand the parcels over, and the success toast says
so. Pinned by a test.

**Where the control lives, and why.** In the order inbox, in the same slot as the
due-today banner — the inbox's established home for "there is work waiting, here
is the one tap that does it" — and directly *below* it, because a deadline
outranks a task you can finish whenever you like. Not in the bulk bar: that bar
only exists inside select mode, and the whole point is that this needs no
selection.

It renders **including at zero**, where the button is disabled with the reason
("Packed and paid orders show up here for one-tap label printing"). The count is
the discoverability affordance — it teaches the feature exists *and* says how
much work is waiting, and a seller can never tap into an empty PDF. A
**pickup-only store never sees it at all** (`offerDelivery` false: no parcels, no
despatch queue).

The count comes from `searchOrders`' existing counts seam (`counts.readyToShip`),
computed over the full scan like `dueToday`/`unpaid` — so it is the store's real
backlog and doesn't move when the seller filters the inbox. A test asserts the
number the strip shows equals the number that actually prints.

---

## Skip rules — nothing is ever dropped silently

`labelSkipReason(order)` returns `null` or one of:

| Reason | Meaning |
|---|---|
| `cancelled` | Checked first, so a cancelled pickup order reports the more informative reason. |
| `no_address` | No `deliveryAddress` — self-collect, and most counter sales. |
| `not_found` | The id isn't this retailer's (a tampered list) or the order is gone. |

The real rule is **"is there somewhere to send it"**, not `deliveryMethod` or
`source`: a counter order that *does* carry a delivery address prints fine, which
is right — it's a parcel either way.

Every batch returns `skipped` per reason, and both surfaces name the cause in
words (`src/lib/awb-labels.ts` `describeAwbSkips` — "Skipped 3 for pickup (no
delivery address), 1 cancelled"). Never a bare "skipped 4".

### The batch ceiling (`AWB_BATCH_MAX = 100`)

25 A4 sheets — a realistic single print run, and the same batch ceiling
`bulkDeleteOrders` uses. The two callers handle it **differently on purpose**:

- **A selection over the cap is refused** (server throws; the dialog disables
  first, with the count). Silently dropping 40 of the orders a seller
  deliberately ticked is the worst possible outcome.
- **The ready queue prints its first 100 and reports `remaining`** in a warning
  toast. "Everything that's ready" has no subset for the seller to narrow to, so
  a refusal would just block the despatch run.

---

## The label

```
┌──────────────────────────────────────────┐
│ [seller logo]                    ┌─────┐ │
│ STORE NAME                       │ QR  │ │  → /<slug>?src=awb
│ ORD-8FK2                         └─────┘ │
│ ──────────────────────────────────────── │
│ FROM      Store · +60 12-345 6789        │
│           business address (1 line)      │
│ ──────────────────────────────────────── │
│ DELIVER TO                               │  ← tinted, the block a
│ NUR AISYAH BINTI RAHMAN                  │    courier must be able
│ +60 11-5939 9791                         │    to read
│ B-12-3, Residensi Suria                  │
│ 47100 Puchong                            │
│ Selangor                                 │
│ Gate code 1234, call on arrival          │
│ ▓▓▓▓  COLLECT RM 128.00  ▓▓▓▓            │  ← or PAID - NOTHING TO COLLECT
│ J&T Express                              │
│ ‖‖‖‖‖‖‖‖‖‖‖‖‖‖‖‖‖‖‖  Code 128            │
│ 6 3 0 1 2 3 4 5 6 7 8 9                  │
│ Deliver on Fri, 21 Aug · 1.20 kg · 3 items│
│ Note: please deliver after 5pm           │
│ 2 x Wagyu Ribeye A5 (500g)               │  ← optional, off by default
│ Returns: 012-345 6789 · Thank you!       │
└──────────────────────────────────────────┘
```

**A label is a fixed-size physical object, so the layout can never overflow.**
The header is fixed; the bottom stack (payment strip → courier + barcode → meta
line → note → contents → footer) is **measured before anything is drawn**; and
the recipient block gets exactly what is left, truncating lines rather than
spilling. That's the design system's "uniform cards" rule applied to paper, and
it's covered by a test that throws 200-character names, 12 address lines and 40
items at one A6 page and asserts the document is still one page.

**Everything degrades on its own** — no logo, no courier, no tracking number, no
weight, no date, no note. Each simply doesn't print, because sellers print
labels *before* the courier handover at least as often as after.

### Why the QR is the storefront, not the tracking page

The first cut encoded the buyer's `/track/<token>` URL — and that was a privacy
bug, caught in owner review before launch. The tracking token is the buyer's
**capability**, not just a link: whoever scans the outside of the parcel (courier
staff, a sorting hub, a neighbour at the door) gets the live order page — items,
prices, payment state — *and* its token-gated mutations: the address edit, the
phone repair, the payment claim. The buyer gains nothing in exchange, because
their tracking link already reaches them privately in WhatsApp at confirm time.

So the QR encodes **`<APP_URL>/<slug>?src=awb`** instead (the reserved `?src=`
attribution param): the recipient scans the box → lands on the shop → reorders.
That makes every parcel the same growth surface as the store QR poster, at zero
privacy cost — everything on the storefront is public by definition.

This is deliberately **not a toggle**. A "put the tracking link back" option
would be a footgun with no story for who it serves; if a future ticket wants a
scannable per-parcel link, it needs a *new, read-only, capability-free* surface
first. A test pins that no QR payload ever contains `/track/` again
(`convex/awb.test.ts` — "carries the storefront URL, never the buyer's /track
capability").

### Country correctness (SG-lite)

The recipient address renders through `displayAddressState`, so an SG address —
which stores the literal `"Singapore"` in **both** `city` and `state` — prints
`560123 Singapore`, never `560123 Singapore, Singapore`. That helper **moved**
in this ticket from `src/lib/address-display.ts` into `convex/lib/address.ts`
(beside `SG_STATE_LABEL`, the literal it exists to dedupe), with the old path
kept as a re-export — the `src/lib/phone.ts` precedent — so the client renderers
and the label share **one author** of the rule. Money uses the PDF pipeline's
`formatMoney(minorUnits, currency)`, which already maps `SGD → S$`; nothing on
the label hardcodes RM.

### Collection orders

A collection trip runs buyer → seller, so a label for one **swaps the two
parties and renames the headings** — `COLLECT FROM` (buyer) / `RETURN TO`
(store) — rather than printing "deliver to" for a journey going the other way.
One layout, one mapper branch. They stay out of the ready-to-ship queue but can
be printed from a selection.

### Weight

Resolved through the *same* `summarizeCartWeight` the weight/zone delivery
pricing uses, so its "never silently underweigh" rule applies here too: one
custom line or one variant with no `parcelWeightG` and the whole cart is
unweighable — the label simply prints no weight instead of a number nobody can
stand behind. Under a kilo reads in grams (`850 g`); above, two decimals of a
kilo (`1.20 kg`).

### Non-Latin-1 text — known limitation

pdf-lib's standard fonts are WinAnsi (Latin-1) only. The shared `sanitize()`
normalises typographic glyphs and then **drops** anything outside Latin-1, so a
Chinese store or buyer name degrades to the encodable characters rather than
crashing generation — the exact behaviour the order receipt has always had
([`i18n.md`](./i18n.md)). Two guards specific to the label: a recipient name
that sanitises away entirely falls through to the phone number (a courier can
call it) and then to "Customer", so the block never has a blank line where the
name should be.

**The real fix is a v2 item:** embedding a CJK font via `fontkit`, which is a
bundle-size and licensing decision, not a code change — and it would fix the
receipt and invoice at the same time.

---

## Template config — `retailers.awbConfig`

Settings → **Fulfilment** → **Despatch labels**, directly under the Delivery
card and above Pickup. That's placement by meaning: once a seller has decided
how orders travel, this is the paper that goes on the parcel — and pickup
orders, which never get one, are the section below.

```ts
{
  paperSize?: "a6" | "a4-4up",
  showLogo?, showItems?, showCod?, showWeight?, showNote?: boolean,
  footerText?: string,        // ≤ 120 chars
}
```

`undefined` = **every default** — every pre-existing store, zero migration.
**Every field is optional** so a future toggle is a widen rather than a
migration, and `sanitizeAwbConfig` **drops any field equal to its default** (an
all-default save normalises the whole object back to unset), so "the defaults"
has exactly one spelling — the `openingHours` posture.

| Setting | Default | Why that default |
|---|---|---|
| `paperSize` | `a4-4up` | Every seller owns an A4 printer. Thermal is the upgrade. |
| `showLogo` | on | The seller's brand on their own parcel. Skipped silently when the store has no logo, or one pdf-lib can't embed (SVG/WebP — format sniffed from magic bytes, a corrupt file never takes the print job down). |
| `showCod` | on | An unpaid parcel that doesn't shout the amount is how a seller gets short-paid. Cause-true, so a settled order prints PAID instead. |
| `showWeight` | on | The first thing a counter clerk asks for. |
| `showNote` | on | Where "call before delivery" actually lives. |
| `showItems` | **off** | A packing list on the *outside* of a parcel tells everyone who handles it what's inside, and it eats a fixed-height label. Sellers who pack from the label turn it on; the card says both halves of that. Capped at 3 lines + "+ N more". |

The **address's own notes always print** regardless of `showNote` — a gate code
is addressing information, not an order note.

`showCod` governs the payment strip as a whole (COD *or* PAID), because the
question a seller is answering is "do I want payment status on my parcels".

---

## Batch sorting

Four sorts, all **total** (ties fall through to fulfilment date, then order
number), so a re-print comes out identically:

| Sort | Order |
|---|---|
| **Delivery date** (default) | Soonest first, dateless last — the inbox's own default, so the printed stack matches the list the seller just ticked. |
| Order status | The pipeline order they work through. |
| Courier | Alphabetical, "no courier yet" last — groups each courier's handover. |
| Delivery area | State → town → postcode. |

**Area needs no country branch:** an SG store's state and city are both
`"Singapore"`, so it degrades to postcode order — which in Singapore *is*
geographic (the first two digits are the postal sector).

The sort is offered in the selection dialog. The one-click ready run uses the
default deliberately — one click means one click; a seller who wants a
courier-grouped run can filter the inbox to packed + paid, select all, and use
the dialog.

---

## Code map

| File | What |
|---|---|
| `convex/lib/pdf/qr.ts` | QR encoder — byte mode, EC level M, versions 1–10. |
| `convex/lib/pdf/barcode.ts` | Code 128-B encoder + the 107-symbol pattern table. |
| `convex/lib/pdf/awb.ts` | Pure view-model: eligibility, party mapping, address lines, weight, payment strip, sort keys, `AWB_BATCH_MAX`. |
| `convex/lib/awbConfig.ts` | The store template: defaults, `resolveAwbConfig`, `sanitizeAwbConfig`. Shared client + server. |
| `convex/lib/pdf/render.ts` | `buildAwbPdf` — the drawing, beside the receipt + invoice builders. |
| `convex/awb.ts` | `generateAwbPdf` (single), `generateAwbBatchPdf` (batch), the paged input queries. |
| `src/components/order/print-label-button.tsx` | Single-order print + `canPrintLabel`. |
| `src/components/dashboard/print-labels-dialog.tsx` | Selection print: sort, count, disabled-with-reason. |
| `src/components/dashboard/ready-to-ship-strip.tsx` | The one-click despatch run. |
| `src/components/settings/despatch-label-card.tsx` | The template editor. |
| `src/lib/awb-labels.ts` | Seller-facing copy for skips + sorts. |

### The encoders — why they're in-repo

Both run inside a **Convex action**, so no native or binary dependency is an
option. The app's only QR today is `react-qr-code`, a React component whose
encoder (`qr.js`) is a *transitive* dep and therefore not importable from our own
code; adding a decade-unmaintained package as a direct dependency to draw a
33×33 grid is a worse trade than ~300 lines of pure, typed, tested arithmetic.
**No dependency was added.**

They are verified rather than trusted:

- **QR** — `qr.test.ts` decodes every symbol back with an independent decoder
  (re-deriving the reserved map from geometry, reading the mask out of the format
  bits, un-masking, walking the zig-zag, de-interleaving), proves the
  Reed-Solomon syndromes are all zero by Horner evaluation, and checks the BCH
  format/version words divide by their generator polynomials. During development
  the output was also diffed module-for-module against `qr.js` across versions
  1/3/4/5/7/10: **the data layers are byte-identical for every ASCII payload**;
  only the mask-selection heuristic differs (a print-quality tie-break, not
  correctness). Non-ASCII deliberately diverges — ours emits real UTF-8 where
  qr.js truncates UTF-16 code units to 8 bits.
- **Code 128** — the pattern table is checked against the format's own
  structural rules (six elements of width 1–4 summing to 11, with an **even**
  total bar width — the parity rule — and all 107 patterns distinct), which is
  what makes a transcription error loud; and the encoder is checked by decoding
  its own runs back through the table, re-deriving the modulo-103 checksum
  independently.

Deliberate limits: QR is level M only (~15% recovery, the right trade for a
laser-printed label that gets smudged and taped over) and version ≤ 10 (213
bytes; a `kedaipal.com/<slug>?src=awb` URL is ~40 and lands in version 3–4) — a
longer payload
**throws** rather than silently encoding the wrong URL, and the caller simply
omits the QR. Code 128 is **code set B only** (set C would halve an all-numeric
number's width, but a 12-digit consignment number is already ~26 mm on a 105 mm
label) and refuses anything over **24 characters**, where the bars get too thin
to scan at the label's fixed width — the number then prints as plain text, which
beats unreadable bars.

### 4-up imposition without `embedPages`

The ticket suggested pdf-lib's `embedPages`. The build draws each label straight
into its A4 quadrant instead: one document, one font embed, one logo embed, no
nested XObjects — a smaller file and **one** layout path rather than two. The
label renderer takes a `{x, y, w, h}` box, so A6 pages and A4 quadrants are the
same code. A 100-label batch is ~370 KB (QR and barcode geometry is emitted as
**merged horizontal runs**, one rectangle per run of adjacent dark modules
instead of one per module); a test pins it under 2 MB so a print job can always
be handed back from an action.

---

## Tests

| File | Covers |
|---|---|
| `convex/lib/pdf/qr.test.ts` (25) | GF(256) field, RS syndromes, capacity table vs the module formula, alignment positions, BCH format/version words, full decode round-trip, version selection, over-capacity throw. |
| `convex/lib/pdf/barcode.test.ts` (16) | Pattern-table invariants, normalisation, decode round-trip incl. checksum, the too-long/unencodable `null` path. |
| `convex/lib/pdf/awb.test.ts` (39) | Skip rules, ready-to-ship rule, MY + SG address lines, weight formatting, party swap on collection, all four payment states, every config toggle, the unnamed-buyer fallback, all four sorts + totality, the storefront QR payload. |
| `convex/lib/awbConfig.test.ts` (13) | Defaults, default-drop normalisation, sanitize stability, footer cap, unknown paper size. |
| `convex/awb.test.ts` (31) | Auth (owner / stranger / unauthenticated / admin act-as), the all-tier single vs Pro-gated batch, skip counts by reason, cross-store id rejection, both ceilings, the ready queue matching the inbox count, **that printing doesn't advance status**, the `labelPrintedAt` stamp (single + batch, skipped orders never stamped, failed prints stamp nothing), and **the QR pin — no payload ever contains `/track/`**. |
| `convex/lib/pdf/render.test.ts` (17) | Page sizes for both papers, 4-up sheet count, everything-stripped, no-courier, over-long tracking number, absurd-text overflow, non-Latin-1, empty batch, unembeddable logo, 100-label file size. |
| `src/components/settings/despatch-label-card.test.tsx` (9) | Patch payloads, disabled-until-dirty, footer cap, discard, and the "not a courier's consignment note" copy. |
| `src/lib/awb-labels.test.ts` (12) | Skip copy naming causes, stable reason order, sort options, and the queue modal's default-check rule (unprinted checked, printed listed-unchecked). |

---

## Deferred (v2)

- **A courier-official AWB** — needs courier API booking (Delyva / EasyParcel,
  [`86eyehvnj`](./fulfilment.md)). Only then can a label carry the courier's own
  barcode symbology and routing codes.
- **A WYSIWYG template editor** — drag blocks, live preview, custom sizes. The
  current card is a fixed template with toggles, which is the right amount of
  configuration until a seller asks for more.
- **A CJK-capable font** (`fontkit` + an embedded font) — fixes the label, the
  receipt and the invoice together. See the limitation above.
- **Code 128 set C** — halves the width of all-numeric consignment numbers. Only
  worth it if a seller hits the 24-character limit.
- **Sort choice on the one-click run** — deliberately omitted so one click stays
  one click.
- **Printing straight to a thermal printer** — browsers can't; the A6 PDF is the
  supported path.
