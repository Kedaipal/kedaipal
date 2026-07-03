# App UI/UX Redesign (direction 1a)

ClickUp [`86ey52f55`](https://app.clickup.com/t/86ey52f55) · Source plan: the "Kedaipal App Redesign" Claude Design doc (direction **1a** implemented; **1b** — the day-planner orders inbox — is a documented alternative, not built).

A mobile-first visual + interaction pass over every `/app` screen. Pulls the landing page's character into the dashboard (Red Hat Display headings, mint highlight swipes, dashed ticket borders) so the app and site feel like one product. **No backend behaviour changed** except one additive counts extension (below).

## The four global moves

1. **One control surface per page.** The orders inbox's four stacked control rows (stat cards, search, bucket chips, due chips) collapse into a search row + one chip row; every secondary axis moved into the filter sheet or a contextual banner.
2. **Badge diet — cards carry max 2 badges.** Name and money get the visual hierarchy; each order row shows its status badge plus at most ONE contextual badge, picked by `OrderContextBadge` (priority: mockup pending → fulfilment date → escalated time-in-status). Delivery method demoted to a quiet icon (`DeliveryMethodIcon`). Both in [`order-badges.tsx`](../src/components/dashboard/order-badges.tsx).
3. **One shared FilterChip.** The same chip was hand-rolled in 4 files with 3 different active styles. Now one primitive ([`filter-chip.tsx`](../src/components/ui/filter-chip.tsx)): `rounded-full`, h-10, `tone="primary"` (navy solid — exclusive view selection: buckets, sort, product status) or `tone="accent"` (soft mint — applied value filters), optional count pill (`countTone="attention"` for the amber New count). `FilterChipRow` is the edge-bleeding scroll row.
4. **Every screen leads with its verb.** Home → share your link / clear what needs attention; Orders → clear the New bucket; Order detail → advance the status (stepper + one big button on top).

New token: **`--accent-emphasis`** (readable mint for text/icons on mint-tinted surfaces — raw `--accent` fails contrast as a text colour on light backgrounds; brighter mint in dark). Exposed as `text-accent-emphasis` etc.

## Screen by screen

### Home (`app.index.tsx`)
- **Today strip replaces the 4-stat grid** — three tappable counts (Due today / New orders / Unpaid) that deep-link into the pre-filtered inbox (`?fwin=today`, `?bucket=new`, `?pay=unpaid&pay=claimed`). Due-today gets the navy hero cell (F&B's #1 morning question).
- **"Needs attention" list** — actionable rows (new-to-confirm, due today, unpaid with RM outstanding), each with a destination; rows only render when the count > 0, whole section hides when caught up.
- **Share card** keeps the landing page's dashed ticket border; QR opens the existing dialog; Copy/Preview stamp `linkSharedAt` as before.
- Mobile greeting header ("Good morning, {store}" + date + logo/initial avatar → settings).
- New-user states (welcome banner, how-it-works, setup checklist, first-order celebration, white-glove card) unchanged.
- The duplicate local `StatusBadge` was deleted; recent orders use the shared one.

### Orders inbox (`app.orders.index.tsx`)
- **4 control rows → 2**: stat cards deleted (counts live in the bucket chips); the filter trigger joins the search row as a 44px navy icon button with an active-count dot.
- **Due-today banner** (navy, contextual): only appears when `counts.dueToday > 0` and the seller isn't already filtered to today; tapping applies `fwin=today`.
- **Card hierarchy inverted**: customer name + total first; order #, item count, age in the meta line; status + one contextual badge (see badge diet); delivery method icon on the right edge.
- **Select mode**: checkboxes hidden by default — enter via the header Select button (visible affordance) or a **long-press** on any card (450 ms, with haptic tick). The floating navy bulk bar leads with the single most likely transition (Confirm in New, Pack elsewhere); the rest + destructive Cancel live in the overflow. `OrderBulkBar` now takes `primary` + `actions`.
- Applied filters render as **individually removable mint tokens** below the chip row + "Clear all".

### Filter sheet (`order-filters.tsx`)
- One sheet owns every secondary axis: **Due date** (Today/Tomorrow/This week — moved off the page; `fwin` is now part of `OrderFilterValue`), payment status, payment method, order date, mockup toggle (restyled as a switch row).
- **Order date**: presets (7 days / 30 days / This month) first; the two raw date inputs collapse behind a calendar icon toggle.
- **Live result count on the apply button** ("Show 9 orders") — filters apply live to the URL, so the count is exact before the seller commits back to the list.

### Order detail (`app.orders.$shortId.tsx`)
- **Next action always on top**: `OrderProgressStepper` (mint check dots → outlined next stage → grey future, resolved stage labels) + one big navy button ("Confirm Order" / "Mark as {stage}"), mockup-gate aware.
- **Payment is a state card**: amber "Payment claimed" card with amount in the header, receipt inline, one mint confirm button (was blue); unpaid + received states as before (received stays the quiet green row).
- **Customer card shows CRM context** (order count · lifetime spend via `customers.get`) with WhatsApp as the hero contact action + a call button; the avatar row deep-links to the profile.
- **Rare actions collapse**: receipt download (mobile) + Cancel Order behind one "More actions" disclosure at the bottom.

### Products (`app.products.index.tsx`, `$productId`, `product-form.tsx`, `variant-editor.tsx`)
- List: **stock state as a colour word** ("In stock" mint / "{n} left" amber / "Sold out" red — the number a home seller protects); Import/Export collapses to one icon button; status chips → FilterChip; archived rows dim, drop the chevron for an eye-off glyph.
- Edit: **sticky save bar** with archive/restore as a quiet icon beside Save (`stickyAction` slot on `ProductForm`); **"Live" indicator** in the mobile header mirrors the active state; **stock stepper** (±1, 44px targets) in single-variant mode and the mobile variant cards (desktop grid keeps the compact input).

### Customers (`app.customers.index.tsx`, `customer-card.tsx`, `customer-detail.tsx`)
- List: **LTV in mint on the right edge**; deterministic tinted initial avatars (name-hash → 5 tints); sort chips → FilterChip.
- Detail: centred **profile header** with WhatsApp hero action + call button; "customer since" moved into the header line; **stat trio** (Orders / Total spent (mint) / Avg order); **private notes as a dashed-amber sticky note**; order history rows lead with the first item name.

### Settings (`app.settings.tsx`)
- **Mobile: 7 tabs → grouped list index** (groups: *Store* = store profile, billing; *Selling* = WhatsApp, payments, fulfilment, order status, integrations). Status at a glance: WhatsApp shows a mint **Connected** pill when a number is set; Billing's subtitle shows the live tier-pill label. A navy **store identity card** (logo/initial, name, URL, `TierPill`) tops the index.
- `?tab=` is now **optional**: no tab = the index on mobile (desktop falls back to Store). All existing deep links (`?tab=billing` from banners, checklist, tier pill) keep working — on mobile they open that section with a back-to-index header. The bottom-nav Settings tab drops its `tab=store` param so it lands on the index.
- **Desktop keeps the flat tab grid** (all destinations visible at once).

### Chrome
- **Bottom nav**: the active tab gets a mint pill behind the icon (text-colour-only active state was easy to miss on a 6-tab bar) + bold label.

## Backend delta (additive only)

`orders.searchOrders` counts gained three fields, computed in the same single scan: `dueToday` (open orders whose fulfilment date is today MYT), `unpaid` (open orders not `received` — includes `claimed`), `unpaidAmount` (sum of their totals). Powers the inbox banner and the Home today strip/attention list — Home now subscribes to the same counts seam instead of `countActionable`. Covered in `convex/orders.test.ts`.

## Deliberate deviations from the design doc

- **Mockup hexes → house tokens**: navy = `foreground` on inverted surfaces (not `primary`, which becomes mint in dark mode — see the bulk bar comment), mint = `accent`/`accent-emphasis`. Primary buttons stay the house mint except where the doc's hierarchy needs navy (advance CTA, due banner, bulk bar shell).
- Bucket label stays "Completed" (shared `INBOX_BUCKETS` vocabulary) vs the doc's "Done".
- Material Symbols in the mockups map to the existing lucide set.
- 1b (day-planner inbox) not built; its `countByFulfilmentDay` idea is unneeded for 1a.
