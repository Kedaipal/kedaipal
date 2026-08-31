# Order Inbox

**Status:** shipped (Phase 1 + Phase 2). ClickUp [Tier 1] Order Search & Inbox
View (`86expm4xx`). Turns `/app/orders` from a flat list into a working inbox so
no order sits forgotten. Phase 1 = buckets/search/filters/time-badge/URL state;
**Phase 2 = bulk multi-select + `bulkUpdateStatus`** (now done).

**Plan gating (Jul 2026):** the inbox is a **Pro+** feature per the pricing
table. Starter keeps the plain order list (default fulfilment-date sort),
order detail and single status transitions — the all-tier "Order pipeline" —
while buckets, search, filters, due-chips, bulk actions and CSV export are
rejected server-side (`assertPlanFeature` in `searchOrders`/`bulkUpdateStatus`/
`exportOrders`) and replaced in the UI by an upgrade tease. Admin act-as sees
the full inbox. See [`manual-subscription.md`](./manual-subscription.md)
§Plan-feature gating.

## Decisions (locked with the CTO)

- **Buckets are fulfilment-based**, not a mix of axes: **All / New /
  In progress (confirmed·packed·shipped) / Completed (delivered) / Cancelled**.
## Search covers every column (86eyrtz74)

Free-text search used to read order #, customer name, phone and item names. It
now runs over **every column in `ORDER_COLUMNS`** — address, courier, tracking
number, payment reference, note, pickup outlet, order type, marketing origin,
cancel reason and the rest — via `searchHaystack` in `orderInboxFilter.ts`. One
registry means the thing you can search is exactly the thing the table shows and
the CSV exports; a narrower search shape is how "why can't I find that order by
its tracking number?" happens.

It is the **same predicate for both views**, server-side in `searchOrders`, so
cards and table search identically and the export matches what's on screen.

Two deliberate details:

- **Phone keeps its own rule** — trailing-digit matching, so `123456789` finds
  `+60123456789` however it was stored or typed. Plain substring can't do that.
- **Categories participate**, because they are frozen onto the order at checkout
  (see below). That was the one column a live lookup could never have covered.
  Orders placed *before* the field existed need
  `npx convex run migrations:backfillOrderCategoryNames` — see
  [product-categories.md](./product-categories.md).

The haystack is built lazily (only when there IS a term), since it allocates ~36
strings per order. Expect broader matches than before: a term appearing in a
shared field — a city every order ships to — now legitimately matches all of
them. That breadth is the point.

## Buckets

**Multi-select since 86eyrtz74** (was one value with an "all" sentinel).
"Completed or Cancelled" — everything closed — is a real question the single
value could not ask, and every other enumerable filter on the inbox is already
a multi-select, so a seller who has learnt "tap several chips" expects it here
too. Each chip toggles membership; **"All statuses" is the select-all, not a
member.** Chip counts stay per-bucket. Chip taps `replace` history like the other
multi-selects (a set built one tap at a time must not leave an entry per tap).
The wire keeps accepting the old singular `bucket` (folded in by
`toInboxFilterArgs`, "all" dropped), so deep links (`?bucket=new` from Home /
nav badges) and old bookmarks keep working; `InboxFilterArgs` itself carries
only `buckets`, and its presence-check joins `NARROWING_FILTER_KEYS`, which
retires the gate's `bucket !== "all"` special case. The per-bucket empty-state
copy ("No new orders…") only renders for a single-bucket selection; a multi
set falls back to the generic line.

### Three states, because "All" was a toggle that couldn't toggle (1 Sep)

The chips are a checkbox set with a select-all, and they have **three** states:

| State  | URL                        | Chips lit           |
| ------ | -------------------------- | ------------------- |
| all    | *(neither param)*          | All statuses        |
| some   | `?bucket=new&bucket=…`     | the named buckets   |
| none   | `?nobucket=true`           | nothing             |

**"None" is what makes "All statuses" a real control.** Before this it lit up
and could never be switched off, which is not a toggle — and the state it was
missing is one sellers actually want: **turning every status off is how you ask
for a pinned-only inbox.** Nothing matches the status filter, and a pin outranks
the filter, so the pins are all that survive. That is not a fourth concept bolted
on; it falls out of the two rules already here. Unticking your *last* bucket
lands in "none" too — that is what unticking your last checkbox means everywhere
else, and "All statuses" is one tap back.

`InboxFilterArgs.bucketsNone` carries it, in its own field rather than as an
empty `buckets` array: empty already means *every* bucket, so overloading it
would let an accidentally-empty array silently blank the inbox. The predicate
reads it in one line, deliberately **below** the pin short-circuit. The export
sends it too, so a CSV of a pinned-only inbox holds the pinned orders.

With the pin privilege *also* off it legitimately matches nothing — the one
empty state **"Clear all" cannot fix**, since that deliberately keeps the bucket
selection. So it gets its own copy ("No status selected") and a **Show all
statuses** button, rather than the generic "adjust your filters" line that would
send the seller hunting for the wrong cause.

**The label says "All statuses", not "All"**, because it isn't all: the
booking-period chips beside it are a second axis that keeps narrowing while it
stays lit. A chip claiming to mean "everything" next to an active filter reads
as a lie (owner report, 1 Sep). Bookings *are* included in every status bucket —
an active booking is `in_progress` like any other order — so the fix is naming
the axis, not excluding them.

- **"New" means "the seller hasn't dealt with it yet."** That was originally
  synonymous with `pending`, because an order sat there until the buyer's
  WhatsApp message confirmed it. The confirmation push (86eyf1rck) commits
  storefront orders as `confirmed` at checkout, which would have made
  `counts.new` permanently 0 and silently deleted the whole unseen-order
  signal — the Home tile, the "needs attention" row, the New chip, and the
  amber-at-4h/red-at-24h age escalation that exists precisely because this is
  the "missed an order" window. So New is now **`pending` OR unseen**:

  ```
  isUnseenOrder(o) = o.status === "confirmed"
                  && o.confirmationPushStatus !== undefined  // took the push path
                  && o.seenAt === undefined                  // seller hasn't opened it
  ```

  Gating on `confirmationPushStatus` rather than status alone is what makes
  this backfill-free: it matches exactly the orders that skipped `pending`, so
  the historical `confirmed` backlog can't flood the bucket, and counter orders
  (also born confirmed, but rung up by a seller standing right there) never
  carry the flag. `orders.seenAt` is stamped set-if-unset by `orders.markSeen`
  when the seller opens the order — the moment they've actually seen it. It
  deliberately does **not** bump `updatedAt`, which would corrupt the
  time-in-status badge.
- **The nav badge counts New, not the pipeline** ([`86eyjfazz`](https://app.clickup.com/t/86eyjfazz)) —
  the Orders badge in the sidebar + mobile bottom nav used to render
  `pending + confirmed`, which counts orders the seller has already accepted and
  is actively working, so on a healthy store it only ever climbed. A badge is a
  **notification**: it must mean "N things you haven't looked at" and working
  through them must drive it to zero, or the seller learns to ignore the one
  surface meant to tell them an order landed. It now reads
  `orders.countActionable.newOrders` — the same `pending`-OR-unseen definition
  above — so the **badge, the New chip and the Home "New orders" tile share one
  rule** and can't disagree. It's computed from rows `countActionable` already
  collects (no extra read), and tapping it navigates to `/app/orders?bucket=new`
  so the seller lands on exactly what was counted — but only while the count is
  non-zero, so the tab stays plain navigation the rest of the time.
  `pending`/`confirmed` stay on the payload as raw status counts: the order
  toasts (`useOrderToastNotifications`) announce on their deltas.
- **Payment status is an orthogonal filter + badge, NOT a bucket** — an order can
  be "confirmed" *and* "unpaid", so pulling it into its own bucket would yank it
  out of In-progress while still being worked. Payment is a multi-select filter.
- **Phase it:** Phase 1 was the inbox; Phase 2 added bulk actions.

## Views: Cards and Table (86eyrtz74)

`?view=table` switches the list to a spreadsheet-shaped table. It exists for a
retention reason, not a cosmetic one: Hermoolah reported exporting to Excel
*"just because they are too used to excel"* — the inbox already filtered and
sorted as well as a spreadsheet, it just didn't look like one, and once a seller
is in a spreadsheet the order is a stale copy with no status, bulk actions or
WhatsApp.

- **Two views, not three.** The existing card list *is* the list view; a third
  mode would be a menu with nothing behind it.
- **The table is a GATED inbox surface, not a display mode of the all-tier
  list.** `resolveInboxView` takes the plan gate first: a seller without the
  Order Inbox feature gets cards whatever the URL or their remembered choice
  says. Its header filters write URL params `searchOrders` refuses to honour
  below Pro, and the cards/table toggle lives inside the gated header actions —
  so without this a Pro seller whose plan lapsed kept `view=table`, landed in a
  table whose funnels changed nothing, and had no way back to cards (PR #233
  review). Same posture the route already takes with stale URL filters: ignore
  them rather than half-honour them. The stored preference is **not** cleared by
  the gate — upgrading puts the seller straight back in the table.
- **The chosen view is remembered** per store on this device
  (`useInboxView`, `kp:orders:view:<retailerId>`), the same storage posture as
  the column layout beside it. The layout is how a seller reads their business,
  not a per-visit choice — opening Orders from the nav used to drop a table user
  back into cards every single time.
  `view` is therefore the one search param that does **not** follow the
  "defaults stay out of the URL" convention: **both** values are written
  (`resolveInboxView` = URL → remembered → cards). Absent now means *"the view I
  was last in"*, which is a different thing from "cards" — writing only `table`
  would leave a table-preferring seller unable to send, or pin, a cards link. A
  view named in the URL always wins, so a shared link opens the layout it was
  sent in.
- **Available at EVERY width.** The first build gated the table to `lg` and up;
  the owner reversed that (28 Aug) — *"they might need a quick look while on the
  move"*. Withholding the view was the wrong trade: a horizontally scrolling
  table is a normal mobile pattern, so instead the table **scrolls inside its own
  container, never the page** (`min-w-0` + `overflow-x-auto`, the design system's
  hard rule for wide content) and its row controls **grow to 44px touch targets
  below `lg`** — with the checkbox's *visual* box staying 18px inside that target,
  since growing the box itself would give a phone a giant empty square.
- **Where the controls live** — settled after the first build crowded five of
  them into one row and squeezed the search input down to its own padding:
  - **The view switch is in the PAGE HEADER**, beside Select and Export. Those
    three are one family — things you do *to* the list — while search, sort and
    filters *narrow* it. Splitting the families is what keeps the search row
    from running out of width, and it means the next display preference has an
    obvious home. It is a segmented control, not a dropdown: two options, both
    worth showing, current one readable at a glance.
  - **The column picker rides the chip row**, right-aligned and *outside* the
    scroller, so a control that only exists in table view can't scroll off a
    phone and become undiscoverable. It configures the table, so it sits with
    the table's own controls, and it is shaped like a `FilterChip` (h-10 pill)
    to belong to that row. Its label collapses to just the count below `sm:`.
  - **The search row is only ever Search · Sort · Filters.** Sort goes icon-only
    below `sm:`, where its label and chevron cost ~70px the input needs more.

  Two of the three faults this fixed were bugs rather than taste: the search was
  `flex-1 min-w-0` against four `shrink-0` siblings totalling ~404px on a 390px
  screen (so it collapsed and Filters wrapped alone), and the column picker was
  `h-9` in a row of `h-11` controls — visibly misaligned and under the touch
  floor.
- **No new backend.** `searchOrders` already returned full order docs, so the
  table is purely a render mode over data the client had.
- **Markup is the shadcn `Table` primitives** (`src/components/ui/table.tsx`,
  added in 86eyrtz74) over a real `<table>`; **logic is `@tanstack/react-table`**,
  already a dependency and already the pattern in `customer-list.tsx`. The two
  are complements, not alternatives — shadcn's table is markup with no logic,
  TanStack is logic with no markup, and shadcn's own "data table" is exactly
  this pairing. Column widths come from `<colgroup>` + `table-fixed`.
- **The header is sticky from `lg` up — and it wasn't, before.** `sticky top-0`
  had been on the header since the table shipped and did **nothing**: CSS forces
  `overflow-y` to `auto` as soon as `overflow-x` is, so the scroll wrapper — not
  the page — was the sticky containing block, and with no bounded height it never
  scrolled vertically, so the header rode away with the page. Verified in a
  browser, not assumed. The fix is `lg:max-h-[70dvh]` on the wrapper, which makes
  it a real scroll viewport. **`lg` and up only:** below that, making the header
  stick would mean a nested *vertical* scroll region stacked on the horizontal
  one, which is a bad trade on touch — phones keep one honest page scroll and no
  sticky header. A test pins both halves, because deleting the height looks like
  harmless tidying and would silently kill the sticky again.
- **Headers read as a band, not a caption** — 12px `font-bold` at
  `text-foreground/75` rather than 11px `text-muted-foreground`, on a solid
  `bg-muted` (translucency is not an option once the header actually sticks), at
  `h-11` so the sort control also clears the 44px touch floor.
- **A status pill never wraps.** `StatusBadge` is `inline-block` + `truncate`
  + `max-w-full`: as a plain inline span, a label too long for its container
  ("Ready for Pickup" in a 116px cell, any long custom stage name on a narrow
  card) wrapped mid-phrase and the rounded background broke into two ragged
  fragments. It now stays one rounded box that ellipsises, with the full text on
  hover — and the Status column was widened to 148px so that truncation is the
  exception, not the norm. The fix is on the badge, not the table, because the
  same defect was reachable from every card and the order detail page.
- **Row navigation**: the row carries `onClick`, and the Order ID cell carries a
  real `<Link>`. A `<tr>` cannot be an anchor, so the link is what keeps
  middle-click, cmd-click and keyboard navigation working; the row click is the
  convenience on top. Same shape as `customer-list.tsx`.
- **`value` is the data cell; `display` is the view cell** (86eyrtz74). One
  column definition, two readers with different jobs:
  - **`value(o)` → the CSV.** The STORED value, unchanged: `storefront`,
    `received`, `self_collect`. A CSV is read by other software, and a seller's
    bookkeeping formula matching `="received"` has to keep working. Formatting
    here would have quietly rewritten every export to fix a rendering problem.
  - **`display(o)` → the table, search and sorting.** The wording a person
    reads: **Storefront**, **Paid**, **Self-collect**, and `humanizeEnum` for
    the general case (`payment_window_expired` → *Payment window expired*,
    idempotent so prose passes through). Optional, defaulting to `value`, so a
    column only declares it when it has something to say — there is no second
    list to fall out of step. Read it through **`orderColumnDisplay`**, never
    `column.value`.
  - **Labels are specific, not categorical.** `storefront` is **Storefront**,
    not "Online" — a claim-link order is online too, so "Online" names a
    category all three fit instead of telling the seller which one this is. And
    `collection` (the seller collects from the BUYER, 86eyg0n8e) reads **We
    collect**, because "Collection" sitting beside "Self-collect" in one column
    is two words for opposite trips.
  - **The labels live in the registry, not the filters.** `ORDER_SOURCE_LABELS`
    and `PAYMENT_STATUS_LABELS` are exported from `orderCsv.ts` and imported by
    both the header filters and the Filters panel. The drift Hermoolah hit — the
    filter offering one word while the column printed the raw key — happened
    *because* the label lived in the filter and the value in the column.
    `order-column-filters.test.ts` drives each filter's own options back through
    its column's own `display`, so whichever side changes, they must agree. The
    single deliberate exception is `METHOD_UNSPECIFIED_CELL`: the picker names
    the absence of a method ("Unspecified") because an unlabelled row is
    unpickable, while the cell stays blank because a word there would read as a
    real rail.
  - **Search indexes both**, so a seller typing `storefront` (reading the
    column) and one typing `received` (reading an old export) both get hits.
- **Columns come from `ORDER_COLUMNS`** (`convex/lib/orderCsv.ts`) — the same
  registry the CSV writes, so the table and the export can't disagree, **in
  which columns appear AND in what order**. Visibility, order **and width**
  persist per store in `localStorage` (`useOrderColumns`), deliberately not in
  the URL (36 toggles would bury the shareable parts) and not in Convex (a
  personal display preference shouldn't cost a write or sync to a colleague).
  Widths live under their own storage key: they change on every frame of a drag
  while the key list changes on a toggle, and a separate key means a layout
  written by an older build still loads instead of failing a shape check and
  dropping the seller's arrangement.
- **Drag the HEADERS to reorder** — @dnd-kit horizontal, with the header itself
  as the drag handle. No separate grip: the shared `useSortableSensors` starts a
  pointer drag only after 8px and a touch drag only after a 250ms hold, so a
  plain click still falls through to sorting. Reordering a table by dragging its
  headers is what every spreadsheet user already knows; the first build put a
  reorder list inside the Columns dropdown, which is nowhere anyone looks.
  **Bulk selection is part of the panel, not an extra** (86eyrtz74): with 36
  columns, ticking them one at a time IS the interaction. Three levels of the
  same control — all columns, one group, one column — and the top two are
  **tri-state**, because a parent reading "unchecked" while three of its seven
  children are on tells the seller something false. They are real
  `<input type="checkbox">` with the `indeterminate` DOM property set via ref
  (visually replaced), which a screen reader announces natively as "partially
  checked" — stronger than `role="checkbox"` + `aria-checked="mixed"`, and the
  reason the a11y lint pushed back on the first attempt. Every bulk row carries
  its own `n/total`, so "some" says how many. Clicking a partly-filled parent
  FILLS it rather than clearing — completing the set is the expected reading.
  Clearing everything keeps the **first** column rather than refusing the click,
  with the rule stated in words where the seller is clicking; an empty table is
  a dead end whose only way back is the panel they just emptied.
  Selected rows here are **not** tinted (`tintSelected={false}` on the shared
  `FilterOptionRow`): the panel opens with most columns on, so a tint would
  stripe two-thirds of the list without saying anything — unlike a filter, where
  a selected option is exceptional.
  The Columns panel is otherwise **show/hide only**, and turning a column on appends
  it to the right-hand end, where the seller can see what they added and drag it
  from there. `resolveOrderColumns` honours the caller's order, so the exported
  CSV comes out arranged exactly like the table.
- **Drag a column's right border to resize it**, between `ORDER_COLUMN_MIN_WIDTH`
  and `ORDER_COLUMN_MAX_WIDTH` (80–640px). Both bounds exist to prevent dead
  ends, not to second-guess a layout: below ~80px a header truncates to two
  characters and a sort glyph — a column you can no longer identify, with no
  handle left to drag back — and above 640px one column pushes the rest out of
  the viewport with no visible cue why. **Double-click a handle** to restore that
  column's registry default; **Reset** in the Columns panel restores all three
  dimensions at once (a reset that left widths behind would be a half-undo, and
  there is no other way to clear them wholesale).
  - **The divider IS the handle.** One element rules the header into a grid —
    most of what makes a table read as a spreadsheet — and puts the grab target
    exactly where a spreadsheet user already aims. It sits *outside* the sortable
    button, which is what stops a resize from starting a column drag: dnd-kit's
    listeners are on the button, so they never see that pointer down. Idle it is
    a half-height hairline; hovering the header grows and darkens it (a 1px line
    with no hover step reads as decoration, not a control); resizing turns it
    mint. The **right-most column has no handle** — it has no neighbour to take
    width from.
  - **The handle is a real ARIA window-splitter**, not a decorative sliver: a
    focusable `separator` carrying `aria-valuenow/min/max`, with **← →** to
    nudge (Shift for a bigger step) and **Home** to restore the default. That
    started as a lint error and turned out to be the right design — a drag-only
    handle makes column width unreachable without a mouse, and the keyboard path
    is ~10 lines. It costs one tab stop per column, sitting immediately after
    that column's sort button, which reads as coherent rather than as noise.
  - **Unmount flushes a pending width write**, it does not drop it: the 300ms
    debounce is easily short enough to lose a resize to a click on the nav. The
    flush runs a closure that captured both the widths and the retailer they
    belong to — the cleanup effect has `[]` deps and would otherwise only ever
    see the first `retailerId`, which is `""` while the retailer query is in
    flight (PR #233 review).
  - `columnResizeMode: "onChange"`, so the column follows the pointer. `"onEnd"`
    is cheaper but means dragging a border does nothing visible until you let
    go — the opposite of what a spreadsheet does. The localStorage write is
    debounced (300ms) instead, since the sizing callback fires every frame.
  - The table carries `minWidth: <sum of column widths>` so `table-fixed`
    honours the `<colgroup>` exactly once the columns overflow. As a floor, not a
    fixed width: with only two or three columns shown the table still spans its
    box and the browser stretches proportionally, which beats a strip of dead
    space.
- **Status sorts by LIFECYCLE position**, not by either spelling (`sortKey` →
  `ORDER_STATUS_KEYS.indexOf`). Alphabetical is wrong on a status column
  whichever words you use — a seller clicking Status wants the pipeline grouped
  in order, not "Cancelled, Confirmed, Delivered, Packed". It also sidesteps a
  mismatch a text sort would have: the cell renders the retailer's CUSTOM stage
  name, which `display` can never reach, so sorting on either spelling would
  order rows by words that aren't on screen (PR #235 review).
- **Per-column sorting**, client-side over the window the inbox already holds,
  so it costs no extra reads. Comparison is **typed, not lexical**: columns
  carry an optional `sortKey` (see `orderColumnSortValue`) returning the
  underlying number for money, dates and times — otherwise "125.00" sorts below
  "86.00" and "3:30 PM" below "9:00 AM". Numeric columns open descending
  (clicking Total means "show me the big ones"), text ascending. Empty values
  always sink, whichever direction is active — a dateless order is unscheduled,
  not earliest. The sort lives in the URL (`?tsort=` / `?tdesc=`) because
  "these orders, by total" is worth sharing, unlike a 36-toggle layout.
- **Filter from the column header** (86eyrtz74). A funnel in the header of
  every filterable column opens a multi-select list of that column's values.
  Filterable today: **Status, Categories, Order type, Came from, Payment,
  Payment method** (multi) and **Fulfilment date** (single — the due windows
  overlap, so offering them as a set would let a seller build a combination that
  reads like an intersection and behaves like a union).
  - **`ui/column-filter-menu.tsx` is generic** and knows nothing about orders —
    it takes options, a selection and a handler, so the next table reuses it
    whole. Everything order-specific (which columns, where the options come
    from, how a selection maps to URL state) is `order-column-filters.ts`.
    Adding a filterable column is one entry there.
  - **The rule for what earns a header slot:** the filter is *about that
    column's values* and those values are enumerable. Date RANGES (two bounds,
    no option list), cross-cutting toggles like "needs mockup" that aren't any
    column, and the summary of everything applied stay in the panel.
  - **Select-all per section**, on the same `ui/bulk-select-row.tsx` the column
    picker uses: a tri-state heading that selects the whole dimension, or clears
    it when already full. "Everything except Cancelled" becomes tick-once,
    untick-once instead of ticking five times.
    ⚠️ **A filter is not a column picker.** Selecting EVERY option in a
    dimension narrows nothing — "Unpaid OR Claimed OR Paid" is every order. That
    is a legitimate stop on the way to "all except X", so it is allowed, but the
    section says *"Every option selected — same as no payment filter"* rather
    than leaving the seller wondering why their list didn't move; clicking the
    full heading again is the way back. **There is deliberately no GLOBAL
    select-all** — selecting every option in every dimension is just "no
    filter", which the footer's `Clear all (N)` already expresses. Sections that
    are single-select (the overlapping due-date windows), a range (order date)
    or a lone toggle (needs mockup) keep a plain heading: forcing the pattern
    everywhere is how a good idea becomes clutter.
    Payment method counts **Unspecified** as one of its choices, since it is a
    real answer a seller filters on.
  - **One control, both surfaces.** `ui/filter-option-row.tsx` — a box, a label
    and a count — is rendered by the header menus *and* by the Filters dialog.
    They were two shapes for one idea (chips in the dialog, rows in the header),
    which made the app look like two apps and taught the seller the same filter
    twice. The dialog was rebuilt on it (86eyrtz74): two columns of sectioned
    option rows, counts on **every** option, active selections as removable
    tokens above the fold, and a **sticky apply bar** carrying `Clear all (N)`
    and the live `Show N orders` — previously the apply button could sit below
    the fold on a phone, which is the one control the panel exists to reach.
    Sections are ordered by how often a seller reaches for them (Status first),
    not by what happened to be there. Payment method renders
    `methodChoicesFor(country, selected)`, never the raw country list: a rail
    the country doesn't offer but the seller HAS selected still shows, or it is
    a filter they can neither see nor switch off.
  - **Header filters MIRROR the panel; they do not replace it.** Moving them out
    would strip cards view of its filters entirely and remove the one surface
    that shows every active filter at once. Both write the same URL state
    through the same shared predicate, so a filter set in one is active in the
    other and the CSV export honours whichever was used. The panel gained
    matching **Status** and **Categories** sections for exactly this reason: set
    a status from the header, then hide the Status column or switch to cards,
    and without a token in the panel the filter would be invisible *and*
    unclearable.
  - **Counts beside every option**, tallied over the UNFILTERED window
    (`searchOrders.facets`) — the same rule `availableSources` already followed.
    They answer "is there anything in there?" before the seller commits, and an
    option showing `0` is the answer to "why is my list empty?". The picker
    never shrinks as it is used; one that did would read as orders vanishing.
    An order counts **once per category**, never once per line, so the number
    beside an option is the number of rows it will show.
  - **Two new server dimensions.** `statuses` is exact order status, multi, and
    deliberately a *separate* dimension from `bucket` rather than a replacement:
    a bucket is the coarse stage you navigate by, this is the precise one you
    question ("packed OR shipped — out of my hands but not delivered"), which no
    single bucket expresses. `categories` matches when ANY line carries ANY
    chosen name — a mixed ticket belongs to every category it contains — and is
    only affordable because categories are frozen at checkout.
  - **`source` widened to `sources`** (multi): "online or claim link, but not
    counter" is a real question a single value could not ask. The singular is
    still accepted and folded in by `toInboxFilterArgs`, so bookmarks survive;
    drop it a release on.
  - **The list must not remount when a filter changes.** Every filter, search or
    bucket change rewrites the query ARGS, which makes a new TanStack Query key,
    which means `data` is `undefined` until the new Convex subscription
    resolves — so the whole list unmounted into a skeleton and remounted on
    every single click. The seller saw the page "refresh", lost their scroll
    position, and an open header dropdown was torn down mid-selection, which
    made picking a *second* value impossible. Fixed with
    `placeholderData: keepPreviousData` on the `searchOrders` read: the previous
    page stays mounted and only its contents change. `isPlaceholderData` drives
    an `aria-busy` on the list and an "Updating…" subtitle — deliberately no
    visual dimming of the rows, since flashing them is the thing being removed.
    A hand-rolled `countsRef` used to hold the bucket counts across refetches
    for the same reason; it is gone, cured at the cause rather than patched per
    symptom.
  - **Filter changes `replace` rather than push.** A multi-select is built one
    tick at a time, so pushing left six history entries behind a single act of
    filtering — and with `scrollRestoration: true` a new history entry has no
    cached position, so the list scrolled to the top on every tick while the
    dropdown was still open. The debounced search box has always replaced for
    this reason; the panel and the header filters now match it. **Bucket chips
    still push** — one click there is one deliberate navigation.
  - **A zero-result filter keeps the table.** The empty state renders as a row
    *inside* the table body, so the header — and every filter control on it —
    stays on screen. Swapping the whole table for a standalone empty panel took
    the header filters away at the exact moment the seller needed them: pick a
    combination matching nothing and there was no way to un-pick it from where
    they stood. The row offers "Clear all filters" only when something is
    actually filtered, and it drops filters while keeping the bucket, the search
    term and the view.
  - ⚠️ **The Pro gate is now compiler-enforced.** `searchOrders` decides whether
    a seller is using paid inbox surfaces by asking if any filter is set, and
    that was a hand-maintained list of arg names. Adding three filters without
    touching it made the gate **fail open, silently**. It is now
    `narrowsTheInbox()` over `NARROWING_FILTER_KEYS`, a `Record` keyed off
    `InboxFilterArgs` — add a field to that type and this object stops
    compiling until you classify it. `showPinned` is excluded because it WIDENS
    the result and pinning is all-tier.
- **The Sort popover is hidden in table view** — every header is its own sort
  control there, and two controls fighting over one ordering is worse than
  either. That is also what buys back the width the Columns chip takes. Cards
  view keeps it.
- **Pinned orders stay on top of any sort, and sort WITHIN their own group.**
  Implemented by partitioning `getSortedRowModel()` rather than using the
  table's row pinning: `getTopRows()` returns pinned rows in the order of the
  pinned-id array, so the pinned block would freeze while the rest re-sorted and
  the two halves would disagree about what "sorted by total" means. Splitting
  the already-sorted model keeps the active sort applying inside both halves.
  Pinning stays a partition, never a competing sort key.
- **Export honours the view.** In table view the Export button becomes a
  two-item menu — *Export visible columns (N)* / *Export all columns (36)* —
  rather than a dialog, which would tax a path sellers hit often. In cards view
  there is no column selection to honour, so it stays a one-tap button that
  exports everything.

## Pinned orders (86eyrtz74)

`orders.pinnedAt` — the seller's manual bookmark. Buckets and filters are all
*rule-based*, so before this there was no way to mark "this specific order needs
me" for a reason the system can't infer (a dispute, a promised callback, an
order being compared against).

Three rules, all owner decisions, all counter-intuitive enough to be worth
stating:

1. **Never auto-unpin.** Not on delivered, not on cancelled. A finished order
   can still be worth keeping on top, and the system doesn't get to decide the
   seller is done with it. Pin and unpin are both manual, always.
2. **A pin outranks the filter.** While the **Pinned** chip is on (the default),
   a pinned order stays in the list even when it fails every other filter —
   because that is the case sellers pin *for*: park an order on top, filter to
   something else, compare. Turning the chip off removes the privilege; it does
   **not** hide pins that legitimately match. Implemented as a short-circuit at
   the top of `buildInboxPredicate`, so the export inherits it and the CSV holds
   exactly what was on screen.
3. **Pinned-first is a partition, not a sort option.** `sortInboxOrders` splits
   pinned from the rest and applies the active sort inside each — pinning is
   orthogonal to newest/due and must not become a third option competing with
   them. Under `recent`, most-recently-pinned leads (the pin you just made jumps
   to the top, which is the confirmation it worked); under `due`, the fulfilment
   date wins and pinned-at is only the tiebreaker.

**All tiers.** A one-bit annotation on an order the seller can already see is
not an inbox *search* feature; gating it behind Pro would mean a Starter
watching pinned rows sort to the top of a list they were never allowed to pin
into. Only the soft-lock applies.

**Never bumps `updatedAt`** — bookmarking is not progress on the order, and that
field drives the time-in-status badge (the `markSeen` trap).

**Discoverability + the staleness escape hatch.** The pin **toggle** is on every
table row, the order detail header and the bulk bar, always rendered (never
hover-only). A **card** shows a pin *marker* instead — a filled accent pin beside
the customer name plus an accent-tinted border — because the card is a `<a>` and
a button nested inside an anchor is invalid markup; toggling happens on the row,
the detail page, or via select-mode. This was originally missing entirely
(owner report, 1 Sep): cards are the default view and the only one on a phone, so
pinned orders sorted to the top and then looked identical to everything else —
"why are these first?" had no answer on screen. The border is *tinted*, not
thicker, because a wider edge shifts that card's text against its grid
neighbours and reads as a rendering bug rather than emphasis.

The **Pinned N** chip appears once something is pinned, leads the
chip row — the seller's own urgency outranks the system's buckets — and its
count is tallied over the full window, so it states the real total and doesn't
shrink under a filter. Since pins never auto-clear, that count is the standing
reminder the set exists; clearing several is **Unpin** in the existing bulk
bar, offered only when the selection actually holds a pinned order.

**Known limit:** a pinned order older than the 1,000-row scan window
(`MAX_INBOX_SCAN`) is outside the inbox's reach and won't surface. Acceptable
for v1 — export is the full-history path — but it means the chip's count can
exceed what a seller can see if they pin something and then place 1,000 orders.

## Line-item thumbnails (86eyrtz74)

Order detail renders each line's photo — the **variant's** first image, else the
**product's**, else `AppImage`'s fallback box. Resolved by
`orders.getItemImageUrls`, batched per distinct variant/product id, returning
one entry per line **in line order** (the same product can appear on two lines).

The image is deliberately **not** frozen onto the order the way name and price
are: it is a packing aid, not a financial record, so a replaced photo should
show the new one everywhere. The cost is that a deleted photo leaves a line with
no thumbnail — which is why it must render through `AppImage` and degrade to the
fallback rather than a broken image.

## ⚠️ Two deliberate deviations from the ticket (`86expm4xx`)

The implementation differs from two acceptance criteria **on purpose** — recorded
here so the ticket and code don't read as out of sync:

1. **"Awaiting Payment" is a *filter*, not a bucket.** The ticket lists it as an
   inbox section alongside the fulfilment buckets, but payment status is
   **orthogonal** to fulfilment (a confirmed order can be unpaid). Making it a
   bucket would pull an in-progress order *out* of "In progress" while it's still
   being worked. Instead it's the **Payment** multi-select filter (Unpaid /
   Claimed / Paid) — select Unpaid+Claimed to get the "awaiting payment" view.
2. **"Filter by status (multi-select)" is implemented as single-select buckets.**
   The buckets *are* status groups (In progress = confirmed+packed+shipped), which
   covers the user-story intent ("see new separated from completed"). Arbitrary
   multi-status selection (e.g. pending **and** delivered together) is not
   supported — buckets were the cleaner UX. If true multi-select is ever wanted,
   it's a small add to `searchOrders` (`statuses[]`) + the chip UI.

Everything else maps directly; bulk actions (the remaining AC) shipped in Phase 2.

## Data model

- `orders.statusChangedAt: v.optional(v.number())` — when the canonical `status`
  last changed. Stamped on `create` (= createdAt) and on **every** transition
  (`updateStatus` always; `advanceToStage` only when the canonical status changes
  — a within-anchor stage move keeps the same bucket). Optional → pre-inbox orders
  fall back to `updatedAt` → `createdAt` at read time, so **no backfill**.

## Backend — `searchOrders` (one query, in-memory)

`convex/orders.ts` → `searchOrders({ retailerId, bucket, paymentStatuses?,
paymentMethods?, methodUnspecified?, dateFrom?, dateTo?, fulfilmentWindow?,
mockupPending?, source?, searchText?, limit? })` (owner-only). It scans the retailer's
orders once (`by_retailer`, newest-first, capped at `MAX_INBOX_SCAN = 1000`) and
returns **the filtered page plus the per-bucket counts in a single subscription**:
`{ orders, total, counts, capped }`.

- **`limit` is optional and defaults to the full window.** Omit it (the inbox
  does) and the query returns the entire filtered+sorted set (up to
  `MAX_INBOX_SCAN`); the client paginates by **slicing that window**, so "Load
  more" reveals more rows without changing the subscription args — **no re-scan
  per page**. Callers that only need the counts (the Home "today strip") pass
  `limit: 1` to keep the payload tiny. This replaced the old growing-`limit`
  model, where every "Load more" re-ran the whole scan/filter/sort just to widen
  a server-side slice. Trade-off: a store with a large filtered set ships more
  rows up front (bounded at 1,000); the escape hatch when that bites is indexed
  cursor pagination + the Aggregate component (see below).

- **Sort (`searchOrders` returns newest-created first; the toggle is client-side).**
  The query returns the window in scan order — **newest-created first**, the
  default the seller expects from WhatsApp/Shopee. The inbox then applies the
  chosen sort **on the client** over the already-fetched window via
  `sortInboxOrders` (`convex/lib/orderInboxFilter.ts`), so toggling **Newest ⇄
  Due date is instant — no re-query**:
  - **Newest first** (default) — newest-created on top. Stops a far-future order
    from burying one that just arrived (the old due-date default did exactly that,
    which confused sellers — see the Sort control below).
  - **Due date** — `compareInboxOrder`: fulfilment date ascending (soonest-first,
    the fulfilment queue), dateless orders sink to the bottom. Relies on the
    newest-first input for its within-date tiebreaker.
  Fulfilment urgency is *also* surfaced by the Due chips + due-today banner + Home
  strip, so due-date is a deliberate opt-in, not the default. Export sorts
  independently (still `compareInboxOrder`, a stable bookkeeping order). See
  [`fulfilment-date.md`](./fulfilment-date.md).
- **Counts** are over the full set, independent of the active filters/search, so
  the chips always show true totals.
- **Filtering** (bucket statuses, payment — `undefined` reads as `unpaid` —,
  payment method, date on `createdAt`, a **`fulfilmentWindow`** chip — today /
  tomorrow / this-week on the order's `fulfilmentDate` —, a **`source`** chip —
  online (`storefront`) vs walk-in (`counter`), `undefined` reads as
  `storefront` — and a cross-cutting **`mockupPending`** toggle = mockupStatus
  pending/changes_requested) and
  **search** (order #, customer name partial/CI, phone by trailing digits ≥4,
  **and item name/variant** — cheap since the orders are already in memory) are
  in-memory. `counts` also carries `mockupPending` (the count behind the "Needs
  mockup" chip).
- **Why in-memory, not indexed pagination + Aggregate:** at the Phase-1 target
  (≤500 orders/retailer) a single bounded scan is simpler and correct, and it
  unifies browse + search + counts. `capped` flags when a retailer exceeds the
  scan ceiling (the cue to move to indexed pagination + the Aggregate component).
- "In progress" spans 3 statuses (can't single-index), and the payment `unpaid`
  filter must also match `undefined` — both fall out naturally from the in-memory
  predicate, avoiding `.filter()`/cursor + `eq(undefined)` complexity.

Shared pure logic lives in **`convex/lib/orderBuckets.ts`** (no Convex imports —
imported by both the query and the UI, same as `isMockupGateClosed`):
`BUCKET_STATUSES`, `statusToBucket`, **`orderBucket`**, **`isUnseenOrder`**,
`INBOX_BUCKETS`, and the time-in-status helpers (`statusAgeMs`,
`formatStatusAge`, `statusAgeSeverity`).

`statusToBucket(status)` is the pure status mapping; **`orderBucket(order)`** is
what anything seller-facing must use — it also routes an unseen push-path order
to "New". Both the counts loop in `searchOrders` and the inbox predicate in
`orderInboxFilter.ts` go through `orderBucket`, so a chip count can never
disagree with the list beneath it, and an order is in exactly one bucket.
`statusAgeSeverity` accepts either a bare status (legacy callers) or the order,
and escalates for `pending` **or** unseen.

## Frontend

- **`src/routes/app.orders.index.tsx`** — URL is the source of truth (TanStack
  `validateSearch`: `bucket`, `q`, `pay[]`, `method[]`, `munspec`, `from`, `to`,
  `mockup`, `fwin`, `sort`; all optional, defaults kept out of the URL — `sort`
  only stores the non-default `"due"`). Debounced search drives the query and
  mirrors into `?q`. Bucket chips show counts (New highlighted). A **Sort control**
  (a Popover on the search row: _Newest first_ / _Due date_) flips the list order
  client-side — see the Sort note above for why Newest is the default. Changing
  sort resets pagination to the first page (it's a view change). A **"Due" chip row** (Today / Tomorrow / This week, driving
  `fwin`) sits inline above the advanced filters — fulfilment urgency is a
  primary axis for F&B sellers, not a buried filter. Each order row carries a
  **fulfilment-date badge** (`fulfilment-date-badge.tsx`) that leads with urgency
  (Overdue / Today / Tomorrow coloured) — **suppressed to neutral on terminal
  orders and hidden entirely on counter orders** ([`86ey8r734`](https://app.clickup.com/t/86ey8r734),
  see [`fulfilment-date.md`](./fulfilment-date.md)). Each card's meta line shows
  the **absolute placed-at datetime + relative age** (`formatOrderTimestamp` +
  `formatStatusAge`, e.g. "12 Jul, 3:45 PM (3h ago)") so the seller reads both
  "when" and "how long ago" without opening the detail page.
  Each card shows **what was ordered** ([`86ey9uny8`](https://app.clickup.com/t/86ey9uny8),
  Sue Chef Kitchen feedback — an order list that doesn't show the products fails
  the core job): a tinted block of item rows (`qty× product · variant`, from the
  frozen order-item snapshots — no extra query) with a per-line amount from `sm:`
  up (phones keep the grouped list but drop the price column; the bold total
  stays the money number there). Rows are capped via
  `src/lib/order-card-items.ts` (`summarizeOrderCardItems`): 2 item lines, the
  rest folded into one "+N more items" row carrying the folded lines' aggregated
  amount — folding only kicks in past cap+1, so a 3-item order shows all 3
  instead of a pointless "+1 more". Product names on cards pair with the search
  predicate already matching item name/variant, so seeing "Pavlova" and typing
  it both work. On `lg` the inbox is a 2-col grid; cards take `h-full` and pin
  their status/badge row to the bottom via `mt-auto` so a 1-item card and a
  3-item card in the same row still line up (the grid stretches every cell in a
  row to the tallest — no JS measurement).
  "Load more" grows a client-side `visibleCount` that slices the fetched window
  (no refetch — see the backend note). A **results footer** below the list keeps
  the two invisible behaviours honest: normally `Showing X of Y orders`, and when
  `capped` is true it swaps to _"Showing your 1,000 most recent orders — older
  ones aren't listed here. Export to CSV for your full history."_ (the scan takes
  the newest 1,000 by date **then** filters, so filters/search can't reach past
  the cap — export is the full-history path). Per-bucket empty states ("No new
  orders — you're all caught up 🎉").
- **`order-time-badge.tsx`** — "time in status" pill (e.g. "2h"). Only **pending**
  escalates: amber >4h, red >24h (the missed-order risk window); other statuses
  are neutral.
- **`order-filters.tsx`** — one coherent filter set: an **"Order type"** pair
  (Online / Counter → `source`), a **"Came from"** multi-select (marketing
  origin → `attributionSources`, 86eyq0eq9 — a SEPARATE dimension from Order
  type: that is the checkout surface, this is where the buyer arrived from; its
  chips come from the query's `availableSources` because seller tags are
  free-form, and the whole section hides below two origins), a
  **"Needs mockup"** toggle
  (amber, with count; cross-cutting — ANDs with the bucket; shown only when ≥1
  order needs one or it's on), **payment** multi-select, and a **date range**
  (quick presets Today / 7 days / 30 days / This month + custom inputs). Inline on
  desktop; collapses to a **bottom-sheet** on phones with an active-count badge.
  The mockup toggle + each payment pick + each "Came from" pick increment the
  count; a date range counts as **one**. (The amber "Mockup pending" pill on each row still flags individual
  orders, so visibility isn't lost by folding mockup into the sheet.)

## Tests

- `convex/lib/orderBuckets.test.ts` — bucket mapping + time-in-status (fallback
  chain, format, pending-only escalation).
- `convex/orders.test.ts` → "orders — inbox search" — buckets + counts + text
  search (id/name/phone), payment filter treating `undefined` as unpaid, owner-only.
- `order-time-badge.test.tsx`, `order-filters.test.tsx` — severity tone + filter
  toggling / active count.
- `src/lib/order-card-items.test.ts` — card item summary: line totals, cap,
  fold-only-past-cap+1, folded amount reconstructs the subtotal.
- `convex/orders.test.ts` → "orders — bulk status" — applies to all eligible +
  skips no-ops, skips mockup-gated when bulking to packed, bulk-cancel restores
  stock, foreign-order batch is rejected (owner-only).
- `order-bulk-bar.test.tsx` — count + clear + the "Mark as" action menu.
- `convex/orders.test.ts` → "the nav badge count …" — `countActionable.newOrders`
  tracks the New bucket: counts pending + unseen push orders, drops as each is
  opened, never re-inflates as a seen order advances, and a legacy confirmed
  order is never counted. `bottom-nav.test.tsx` covers the badge value + that it
  lands on `?bucket=new` (and doesn't filter when there's nothing new).

## Phase 2 — bulk actions (shipped)

- **`convex/orders.ts`**: the core of `updateStatus` was extracted into a shared
  `applyStatusTransition(ctx, order, status)` helper (stock-restore-on-cancel +
  aggregates, `statusChangedAt`, `orderEvent`, WhatsApp notify). New
  **`bulkUpdateStatus(orderIds[], status)`** calls that same helper per order, so
  the **mockup gate + stock-restore can't be bypassed**. Per-order it **skips**
  (rather than failing the batch) when the order is already in that status or is
  mockup-gated for `packed`, and returns `{ updated, skipped }`. Owner-checked for
  every order; capped at 100/batch.
- **UI** (`app.orders.index.tsx` + `order-bulk-bar.tsx`): every row has an
  **always-visible checkbox** as its own click target — the card itself still
  links to the order (two distinct CTAs; no "select mode" toggle to fight). Ticking
  one reveals a **Select all / Done** toolbar + a sticky bottom **bulk bar** ("N
  selected" + a **"Mark as…"** menu of resolved status labels) → `bulkUpdateStatus`
  → toast summary ("Updated 8 · skipped 2"). **Destructive actions (Cancel) are
  gated behind a confirm dialog** ("Cancel N orders? Customers will be notified…")
  since bulk-cancel restores stock, reverses aggregates, and sends an unrecallable
  WhatsApp cancellation to up to 100 customers; non-destructive actions apply
  immediately. Selection clears
  when the view (bucket/search/filters) changes. The bar is `fixed` and sits over
  the mobile bottom-nav while selection is active.
- **Bucket counts are retained across refetches** (`countsRef`) so the chips +
  "Needs mockup" toggle don't flicker out each time a filter changes (the query
  reloads). The desktop filter row lays out horizontally (compact toolbar);
  the mobile bottom-sheet keeps the stacked layout.
