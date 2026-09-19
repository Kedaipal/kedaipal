# Fulfilment date & time at checkout ("bila nak?")

The buyer picks **one date** at checkout — *"When do you need this?"* — for both
delivery and self-collect orders. It removes the seller's #1 follow-up question
(*"bila nak?"*) for date-anchored F&B businesses: cake decorators (delivery on a
specific day), kuih batch pre-orders, frozen cook-and-collect cycles.

ClickUp: [`86expm524`](https://app.clickup.com/t/86expm524) — the **lean** Date
Picker (single native date input). The advanced version (per-product lead time,
blackout dates, time-of-day, cutoffs) was deferred, and has since shipped in
parts, each an update section below: a delivery **time** (Aug), **store opening
hours** (Aug) and **split days** (Sep), a **per-product notice** in days, and a
**per-product prep time** in minutes with a **pickup time** for self-collect
(Sep, `z8r3fdff97`). Blackout dates and order cutoffs are still deferred.

The levers, from coarsest to finest: the store's notice (days) → a product's
notice (days) → a product's prep time (minutes, today only) → the store's
opening hours (which days and windows exist at all).

## Scope decision — both methods, not pickup-only

The date applies to **delivery and self-collect equally**. The headline ICP case
(cake decorators) is a *delivery* one — a cake delivered on the wrong day is as
useless as one collected late — so restricting to self-collect would miss the
biggest use case. Label adapts to the chosen method ("When do you need it
delivered?" / "When will you collect?").

## Storage & timezone

`orders.fulfilmentDate?: number` — the epoch-ms of the chosen calendar day's
**midnight in Malaysia time (UTC+8, no DST)**. All retailers are MY, so a fixed
+08:00 offset is drift-free without a tz database and round-trips cleanly with
the native `<input type="date">` "YYYY-MM-DD" value.

All date logic lives in one shared, Convex-free module imported by both backend
and frontend (like `paymentMethod.ts`): [`convex/lib/fulfilmentDate.ts`](../convex/lib/fulfilmentDate.ts).
Key exports: `mytMidnightFromYmd` / `ymdFromEpoch` (round-trip),
`todayMytMidnight`, `fulfilmentDateBounds`, `assertValidFulfilmentDate`,
`formatFulfilmentDate`, `relativeFulfilmentLabel`, `matchesFulfilmentWindow`.

## Validation

A submitted date must be a whole MYT day within
**`[today + minNotice, today + 30]`**:

- **Min** = `today + retailers.minFulfilmentNoticeDays` (the retailer setting,
  default **0 = same-day allowed**; a seller who needs lead time raises it).
- **Max** = today + 30 days (hardcoded for v1).
- **Counter Checkout bypasses the notice** — the seller is keying the order in
  person, so it always validates against a 0-day notice (today is always valid),
  regardless of the storefront setting.

The mutation arg `fulfilmentDate` is **optional at the protocol level** (so the
~90 existing `orders.create` test/call sites and the link-in-bio path don't all
need it, and a dateless order is valid) but **required in the storefront UI**.
The server re-validates the range whenever a value is present
(`orders.create`, `counterCheckout.createOrderFromSession`). Validation throws a
plain `Error` from the lib; the mutations wrap it in `ConvexError` (same pattern
as `assertValidAddress`).

## Where it surfaces (end-to-end)

| Surface | What shows |
| --- | --- |
| Storefront checkout (`checkout-form.tsx`) | Required native date picker below the address/pickup block, above the optional note. Bounds from the retailer's notice setting. |
| Counter Checkout (`app.checkout.tsx`) | "Collection date" input **defaulted to today** (the walk-in case); seller adjusts for pre-orders. The order is always created `confirmed`; when it was **paid in person**, the success screen offers an **optional "Mark as completed"** button (one tap → `delivered` via `orders.updateStatus`) so the seller can close out a hand-over sale without clicking through the status pipeline — a choice, not automatic (a paid deposit on an unready item stays confirmed). |
| Buyer's WhatsApp order message | `🗓️ Collect/Deliver on: Sat, 28 Jun 2026` line, so the seller sees it in-chat immediately. |
| New-order / order-confirmed email | "📅 Needed by: …" line (en + ms). |
| Order inbox (`searchOrders`) | **Default sort = fulfilment date ascending** (soonest first; dateless orders sink to the bottom, then newest-created). **Due: Today / Tomorrow / This week** chip filters. Per-card urgency badge. |
| Order detail | Fulfilment section shows "Collect/Deliver on" + urgency badge. |
| Buyer tracking page (`/track/<token>`) | "Collect/Delivery on …" reassurance line. |

The inbox chips and the per-order badge lead with **urgency** —
`relativeFulfilmentLabel` colours Overdue (red) / Today (orange) / Tomorrow
(amber); further-out dates show the plain date. The "Due" chips sit **inline
above** the advanced filter sheet, not buried inside it, because "what's due
today?" is a primary axis for an F&B seller, not a secondary filter.

### Urgency is gated by status + source ([`86ey8r734`](https://app.clickup.com/t/86ey8r734))

Two rules keep "red = act now" honest — a delivered order screaming "Overdue"
made the inbox useless at counter-heavy stores (every completed counter sale
went red the morning after, since counter defaults `fulfilmentDate = today`):

1. **Terminal orders never show urgency.** `delivered`/`cancelled` orders render
   the date in **neutral** chrome with no "Overdue/Today/Tomorrow" prefix
   (`FulfilmentDateBadge muted`). The gate lives at the badge **call sites**
   (`OrderContextBadge`, order-detail header) — `relativeFulfilmentLabel` stays a
   pure date→label function, status-unaware.
2. **Counter orders show no date badge at all.** A counter order's date is
   defaulted-to-today, not buyer-chosen, so it carries no "promised by" signal —
   `OrderContextBadge` and the detail header hide it entirely for
   `source === "counter"`. They are also excluded from the `dueToday` count in
   `searchOrders` (which the Home "due today" strip reads), so completed walk-in
   sales never inflate the nudge. See `docs/counter-checkout.md` for `orders.source`.

## Retailer setting

`retailers.minFulfilmentNoticeDays?: number` — Settings → **Fulfilment** tab,
top card ("Order date notice"). A checkout-wide timing rule that governs both
delivery and pickup, so it lives above the per-method toggles, not in a separate
"Checkout" tab. Clamped to `[0, 30]`; `updateSettings` rejects out-of-range
values. Undefined reads as the default (**0**, same-day allowed).

## Deliberate non-goals (this PR)

- The templated WhatsApp **confirm reply** to the buyer does not echo the date —
  the buyer's own order message already carries it in the same chat thread, and
  threading it through the localized template var system is out of lean scope.
- No per-product lead time, blackout dates, time-of-day, or cutoffs — these are
  the deferred "Date Picker — Advanced" task, to be informed by real usage.
  *(Since shipped: time-of-day and per-product notice + prep time — see the
  updates below. Blackout dates and cutoffs remain deferred.)*

## Unblocks

The **Pickup Reminder** portion of Automated Reminders (Sprint 4) — a reminder
can't fire without a committed date.

## Update (2026-07-22, Lalamove round): date defaults to the earliest allowed day

The storefront date field now DEFAULTS to the earliest selectable day
(today + the store's notice window) instead of starting empty — most orders
are "as soon as possible", so the common case is zero taps; pre-order
buyers simply pick a later date. Counter checkout already defaulted to
today; the server window validation is unchanged.

## Update (2026-07-23): per-product notice override (minNoticeDays)

`products.minNoticeDays` (0–30, 0 normalizes to unset) — made-to-order items
declare their own lead time. The EFFECTIVE window everywhere is
max(store-level `minFulfilmentNoticeDays`, strictest cart item): the
storefront date picker floors to it (with copy naming the item constraint),
`orders.create` re-validates server-side after resolving items, and the
default date (earliest allowed day) rises with it. Custom/quote carts label
the field "Requested date — the seller confirms the final date after the
design is agreed". Editor surface: product form → "Minimum notice" card.
Counter checkout still ignores notice entirely (seller in person).

## Fulfilment TIME (4 Aug 2026, 86eyg0n8e follow-up)

Delivery orders (both directions — rider to the buyer, or collecting from
them) now capture **what time** as well as the day: a rider arriving at
someone's door shouldn't be an all-day window. Zaki's call: datetime for
both delivery types; pickup/self-collect stays date-only, since a pickup
point's hours are governed by its own schedule note. *(Self-collect gained a
time — when the store keeps hours or the cart needs prep — in `z8r3fdff97`;
see the prep-time update below.)*

- **Storage: a separate field, deliberately.** `orders.fulfilmentTimeMinutes`
  (minutes since MYT midnight, 0..1439). `fulfilmentDate` keeps its
  whole-midnight invariant — the validator rejects non-midnights, and the
  inbox sort, due-today counts, urgency badges and window chips all compare
  midnights — so the time composes with the day (`composeFulfilmentMoment`)
  and can never drift from it. Legacy, counter and self-collect orders have
  no time *(self-collect may since `z8r3fdff97`)*, and every consumer treats
  "no time" as the old date-only behaviour.
- **Checkout: required but prefilled** (zero extra taps): today → **as soon
  as possible**, i.e. the floor itself (8:09 AM → 8:25 AM); a future day →
  10:00 AM (`defaultFulfilmentTimeMinutes`). An hour-out default was tried
  first and read as an invented wait (Zaki: *"8:09 → 9:30, that's like
  1.5hrs"*) — most buyers mean "I'm ready, send someone", and anyone who
  needs later just changes it. It also lands the common case on the nicer
  dispatch behaviour: by the time the seller books, that moment is past, so
  `resolveScheduleAt` turns it into an IMMEDIATE booking rather than a
  scheduled pickup. Native `<input type="time">` (TimeField, DateField's
  sibling), 5-minute steps.
- **The earliest selectable time is `now + EARLIEST_FULFILMENT_LEAD_MINUTES`
  (15), rounded to 5** — and that number is OURS, not Lalamove's. Measured
  on the MY sandbox 4 Aug 2026 (`lalamove:devProbeScheduleAt`): their only
  rule is *"Date cannot be a past date or more than 30 days in advance"* —
  `scheduleAt` at **+1 min quotes fine**, +0 and earlier are refused with
  `ERR_INVALID_FIELD`, **+30 days works and +31 fails**, and **overnight
  slots (02:00, 03:00) quote normally**, so there are no operating hours to
  model. 15 minutes is a buffer so a submit can't race the clock into their
  past-date refusal, plus a plausibility floor for a rider actually
  arriving. The same constant drives the dispatch schedule-vs-now decision
  (`MIN_SCHEDULE_LEAD_MS`), pinned by a test, so a buyer can never pick a
  time we'd then refuse to schedule.
- **The prefill can't fall under the floor.** Two guarantees, because the
  first shipped without the second and Zaki hit it: (a)
  `defaultFulfilmentTimeMinutes` is *derived from* the floor — pinned by a
  minute-by-minute sweep of the whole day — and (b) the floor MOVES with the
  wall clock, so the checkout re-runs the repair every 30s and whenever the
  tab regains focus, bumping only a value that has already become
  impossible. Without (b) a buyer who lingered ~45 minutes was blocked at
  submit by the browser's own native `min` message, not ours. The submit
  check now judges against the floor too and says the earliest time in our
  words — or, in the last minutes of a day where no slot is left at all,
  sends them to tomorrow.
- **Validation is deliberately lenient server-side** (range-only): whether
  the moment is still ahead is judged at checkout submit client-side and
  again at dispatch, where a past moment simply books "now" — a strict
  server check would let clock skew or a long-idle form reject a legitimate
  checkout.
- **The time rides every surface the date already had**: wa.me message
  ("🗓️ Deliver on: Tue, 4 Aug 2026 · 3:30 PM"), tracking page, seller order
  page (beside the day badge — the badge itself stays day-granular), the
  new-order email. One formatter (`formatFulfilmentDateTime`) so it can't
  appear in two spellings. The inbox deliberately stays day-granular.
- **Lalamove**: the checkout quote prices the exact moment and dispatch
  defaults to it — see docs/delivery-lalamove.md ("priced for THEIR
  moment" + the scheduled-booking paragraph). The shared rule is
  `resolveScheduleAt`: ≥30 min ahead and within ~30 days schedules,
  anything else books now.

## Update (2026-08-19, 86eyp5rav): store opening hours

A buyer scheduled a **3:00 AM delivery** two days out — nothing told checkout
when the store can actually operate. Stores now carry an optional weekly
schedule, and the fulfilment moment must fall inside it.

- **Storage:** `retailers.openingHours` — 7 entries indexed by weekday
  (**0 = Sunday**, the `getUTCDay` index `formatFulfilmentDate` already reads
  off a MYT-shifted date, so the two can never disagree about which weekday a
  date is). Per day `{ open, close, closed? }` in minutes since MYT midnight,
  `0 ≤ open < close ≤ 1439` — **23:59 is the ceiling** because a native
  `<input type="time">` cannot express "24:00" and fulfilment times are
  already `< 1440`, so "open 24 hours" is `{0, 1439}` and there is no
  midnight special case anywhere. Boundaries are **inclusive** (delivering AT
  closing time is fine — the freeAbove posture). A closed day keeps its
  open/close values so re-opening it in settings restores them.
  **Undefined = open 24/7** (every pre-existing store, zero migration); an
  explicitly-saved all-24h week **normalizes back to unset** (one spelling,
  the minOrderValue posture); an **all-closed week is rejected** (the
  working-method-invariant posture — the store could never take an order).
  All-tier, public-safe (both retailer reads carry it).
- **One pure module, one author:** `convex/lib/openingHours.ts` —
  `sanitizeOpeningHours` (updateSettings), `assertWithinOpeningHours`
  (`orders.create` AND the checkout submit mirror, so the words match),
  `selectableTimeWindow` (the lead floor raised to opening, capped by
  closing — with hours unset it degrades to exactly the pre-hours floor
  behaviour), `defaultTimeWithinHours` (the 10:00-AM/floor prefill clamped
  into the window), `openNowStatus` (storefront header line),
  `openingHoursSpecification` (Store JSON-LD).
- **What it constrains — and what it deliberately doesn't.** Only the
  buyer's fulfilment date/time at storefront checkout: browsing and placing
  orders stay 24/7 (the whole point of an async order hub), **counter
  checkout is exempt** (seller standing there — the min-notice posture,
  pinned by test), and **pickup orders validate day-level only** (they have
  no time field; the pickup point's own `scheduleNote` keeps carrying the
  point-level detail). A closed day rejects for BOTH methods. *(Since
  `z8r3fdff97` a TIMED pickup is checked against the windows and the break
  like a delivery; a timeless one — a drop-off meet-up, or a store using
  neither hours nor prep — still validates day-level.)*
- **Checkout UX:** day chips **skip closed days and scan forward** (three
  real choices still show; for delivery, a today whose window has passed is
  skipped too), the default date is the first day the store can actually
  fulfil, the time input carries the window as native `min`/`max` **plus the
  hours named in its helper text** (the rule is never silent), the 30s
  repair pulls an invalidated slot into the window, and a closed day picked
  via the native date input (which can't skip weekdays) gets an immediate
  inline explanation naming the weekday. Server re-validates everything.
- **Storefront display:** stores WITH configured hours get a live
  "Open now · closes 9:00 PM" / "Closed · opens 9:00 AM tomorrow" line in
  the shared `StorefrontHeader` (all four buyer pages), tapping open the
  weekly schedule in a dialog; the 24/7 default renders nothing (no clutter
  where the rule doesn't bind). SSR-safe via `suppressHydrationWarning` on
  the clock-dependent text + a minute tick. The store home's JSON-LD gains
  `openingHoursSpecification` (open days only — the default claims nothing
  rather than asserting "always open").
- **Settings → Fulfilment**, first card (hours are the most fundamental
  timing rule, above notice): summary view ("Open 24 hours, every day" when
  unset) → an editor that leads with a **mode choice** (Zaki's round-2
  feedback — setting 7 rows one by one was the entry fee, and the browser's
  native time dropdown was ugly): **"Same every day"** (the default — ONE
  time range + tap-to-toggle weekday chips for rest days; editing the range
  writes every row, closed days included, so re-opening a chip inherits it;
  switching to this mode visibly unifies onto the first open day's range)
  vs **"Different per day"** (the 7-row editor, Monday-first display over
  the Sunday-indexed array). Mode is derived on entry: open days sharing one
  range read as "same". Both modes pick times through the new **themed
  `ui/time-picker.tsx`** — a field-styled trigger opening a single
  scrollable 30-min-step list (Google-Calendar pattern, 11:59 PM appended as
  the terminal option), replacing the unstyled native dropdown on dashboard
  surfaces; the buyer checkout's TimeField deliberately STAYS native (on
  phones it opens the OS wheel, which no custom popover beats — the ugliness
  was a desktop-dashboard problem). Disabled-with-reason Save on an
  all-closed draft, quiet "Reset to open 24/7" (`openingHours: null`).
- **NO hidden ±1h buffer** (the "first slot an hour after open" idea was
  considered and rejected): a hidden offset makes the displayed hours lie
  ("you open at 9 — why can't I pick 9?"), and prep headroom already has
  explicit levers — min notice, the 15-min lead floor, or simply tighter
  hours. An explicit "prep buffer" setting is a clean follow-up if a real
  seller asks. *(A real seller asked: shipped per PRODUCT, not per store, in
  `z8r3fdff97` — see below.)*
- **v1 limits** (each a follow-up if a real seller asks): one range per day
  (**lifted 16 Sep 2026 — see below**), no overnight wrap (a mamak open
  6 PM – 2 AM), no holiday/exception dates. Known corner: a long notice
  (e.g. 27 days) combined with closed days can leave a mostly-closed
  selectable window — chips go sparse and submit explains; the server gate
  keeps it correct.

## Update (2026-09-16, z8r3fdff8r): split days — two windows

The first v1 limit to be asked for by a real seller. Huff & Puff runs a
breakfast window (7:30–10:00) then the regular cafe window (12:00–18:00);
with one range per day she either set 7:30–close (and buyers booked 11:00,
when nobody is there) or dropped breakfast.

- **Storage:** an optional `open2`/`close2` pair beside the first window,
  `close < open2 < close2 ≤ 1439`. An **optional widening** — every existing
  row is byte-identical and there is no migration. The pair is set **together
  or not at all**: a half pair is DROPPED by the sanitizer rather than
  guessed at, so "no second window" keeps one spelling. A second window
  beside an **all-day** first one is refused (there is no day left to open).
- **`dayWindows(day)` is THE accessor.** Nothing outside
  `convex/lib/openingHours.ts` reads `open2`/`close2`: the gate, checkout,
  the header, the settings editor and the JSON-LD all iterate the list it
  returns. That is the whole extensibility story — a third window later is a
  schema widen plus one line in `dayWindows`, not a branch in eight
  functions.
- **`dayHoursError(day)` is THE rule-set**, returning the seller-facing
  sentence or null. `sanitizeOpeningHours` throws it (prefixed with the
  weekday) and the settings editor renders it inline per keystroke — same
  function, so the client can never disagree with the server about what is
  allowed *or say it in different words*.
- **The break is named, not implied.** `dayGaps` / `gapForTime` turn a
  refused moment into "closed 10:00 AM – 12:00 PM — pick a time in an open
  window" rather than restating the hours and leaving the buyer to work out
  why 11:00 bounced. Both window bounds are open moments, so the gap reads
  exclusive at both ends — exactly how a human reads "closed 10–12".
- **A single-range time input can't fence a break**, so the native
  `min`/`max` carries the **hull** (`selectableTimeWindow`, unchanged
  signature — ~14 call sites untouched) and the gap is caught by
  `isTimeSelectable`: at submit, in the 30s repair, and — new — in an
  **inline notice the moment the field holds a gap time**, on both the
  storefront and claim checkouts. The repair now jumps a stale prefill
  FORWARD to the next open window instead of into the break.
- **`defaultTimeWithinHours` picks the first window that can still host the
  plain default**: a future day's 10:00 lands in window 1 while it lasts,
  window 2 once window 1 closes; today, the lead floor drops a window it has
  already swallowed. It can never prefill into a break (test-pinned by
  construction, not by example).
- **`openNowStatus` gained `until`** — the close of the window the store is
  in RIGHT NOW, because on a split day "closes 6:00 PM" while breakfast is
  about to end is a lie. Mid-break, `nextOpen` reports **daysAhead 0**: the
  header says "opens 12:00 PM today", not "tomorrow".
- **JSON-LD emits one row per window**, which is schema.org's own way to
  express a lunch break.
- **Settings editor:** both modes gained it. "Same every day" takes ONE
  "+ Add a second window" for the whole week (seven days, one click — the
  bulk-affordance rule); "Different per day" gets a per-row control. A new
  window is suggested as `close + 2h` for 6h (a 10:00 breakfast close lands
  on 12:00–18:00, the shape that asked for this). Where a day can't take one
  — all-day, or a first window running to 23:59 — the control is **disabled
  with its reason on screen**. A valid split shows the break back in the
  seller's own numbers ("Closed 10:00 AM – 12:00 PM"), full sentence in
  same-every-day, compact in the 7-row grid where it would otherwise repeat
  seven times.
- **Removing the second window restores single-window behaviour byte for
  byte** (test-pinned on the saved payload's key order), and an all-24h week
  still normalises to unset.
- **Still v1 limits:** at most two windows per day, no overnight wrap, no
  holiday/exception dates.
- **Hands-on test round (17 Sep, driven in a real browser):** the logic held
  everywhere, and nine UX gaps surfaced. The fixes that changed behaviour:
  - **The repair is ownership-aware.** `src/lib/fulfilment-time-issue.ts`
    (`planTimeRepair`) tracks the value the SYSTEM last wrote. A buyer-typed
    time is **never rewritten**. Before this, a typed 6:00 PM in a break became
    5:20 PM within 30s, silently and earlier than asked. The inline notice
    (now covering too early, too late and in the break) explains, and submit
    refuses in the same words. A stale system prefill moves **forward**
    (`nextSelectableTime`), falls back to an earlier slot only when nothing
    later is left, and **announces the move** ("We moved your time to 7:00 PM
    — … is closed 5:00 PM – 7:00 PM"). On a day with no slot left it is
    cleared rather than kept as a false promise beside "closed for today". It
    refills itself once the buyer picks another day. The move also works live
    when a seller edits hours mid-checkout.
  - **One ladder, both checkouts.** `fulfilmentTimeIssue` + `timeIssueCopy`
    replaced the submit `if` ladder that storefront and claim checkout had
    copy-pasted. Copy is built from parts, so a time or range renders as one
    unbreakable unit (`src/components/hours/hours-text.tsx`). A half-width
    hint on a phone used to wrap "4:30 PM –⏎5:30 PM". Server strings keep
    plain spaces, because they also feed WhatsApp and PDFs.
  - **Pickup gets the hours on its DATE.** Self-collect has no time field, and
    the in-person collector is the buyer who walks into a lunch break. Not
    shown for drop-off, where the point's schedule note governs. *(Superseded
    by `z8r3fdff97`: pickup now asks for a time whenever the store keeps hours,
    so the hours ride on the time field like delivery, and the date hint —
    which could no longer render — was removed.)*
  - **Editor errors point at the right control.** `dayHoursIssue` returns
    `{ message, window }`, so only the offending window turns red and the
    sentence sits under it (per row in the 7-row grid, plus "Fix the hours for
    Monday to save." at the foot). The 11:59 PM cap only speaks when it's the
    actual problem, and the plain message is back to "opening time must be
    before closing time".
  - **Grid and targets.** Switching to "Same every day" **says** when it
    replaced different per-day hours. The settings summary stacks windows like
    the storefront dialog, using one component for both. (The reserved remove
    column and the 44px × from this round were replaced in the next one; see
    below.)
- **Second test round (17 Sep evening), nine more fixes:**
  - **Add and remove are ONE control under a day's windows** (`SecondWindowButton`),
    in both editor modes. The × beside the pickers, plus a column reserved on
    every row to keep them aligned, cost each picker 25px. On a 360px Android,
    every time read "6:30 …", hiding the AM/PM a split schedule turns on. Both
    windows now run full width, and both buttons are 44px targets pulled back
    to text height.
  - **Errors sit under the window they're about,** in both modes. A
    first-window error printed after both rows read as a complaint about the
    second window. On a split day the first window's sentences also name it
    ("the first window's opening time must be before its closing time").
    Unsplit days keep the old wording.
  - **Switching back restores the per-day hours.** "Same every day" keeps the
    week it replaced, and switching back to "Different per day" puts every day's
    own hours back. The note used to say "Cancel to keep your different hours
    per day". Cancel restores the SAVED week, so per-day hours typed in the
    same session were lost while the note promised to keep them. Re-tapping
    the active mode no longer re-runs the unify, which had dropped the note and
    the kept hours.
  - **"Reset to open 24/7" is a draft action.** It used to save on the spot,
    one tap beside Cancel, wiping up to fourteen windows with no confirm or
    undo. Now the pickers show 24/7, Save commits it (the server stores an
    all-day week as unset, same as the old instant clear), and Cancel takes it
    back. It hides once the draft already is 24/7.
  - **A move gives its true reason.** `TimeMove.reason` is `break` | `passed` |
    `before_open` | `after_close`. Changing the date used to say "7:30 PM is no
    longer available" when the new day just closes at 6:00 PM. Now: "7:30 PM
    is after … closes that day", or "10:00 AM is before … opens that day".
    "Passed" is judged against the floor WITH the cart's prep, so a time the
    prep window overtook reads as passed, not "before opening" (T2 adds its
    prep wording on top).
  - **A refusal stands only while its inputs do.** A submit refusal about the
    day or time is stored with `fulfilmentInputsKey(values)` (method, pickup
    point, date, time) and shown only while those are unchanged. Before, it
    stayed after the buyer fixed the time, contradicting the field until the
    next press.
  - **The storefront shows the refusal beside the CTA,** in the reason slot
    above the button, on both the desktop summary and the mobile bar. The claim
    page already put it there. The refusal is held as `CopyPart[]` wherever it
    has parts and rendered with `CopyText`, so a time range stays whole in the
    mobile bar — the narrowest place any of this copy renders. The inline date and time notices carry
    `data-form-error`, so the submit focus helper scrolls to the field being
    refused. Note for anyone re-testing: that helper runs on
    `requestAnimationFrame`, which a hidden or covered browser window never
    fires. An "off-screen refusal" seen in a background tab is partly the tab.
  - **The pickup unit helper no longer claims WhatsApp.** See
    [`fulfilment.md`](./fulfilment.md#unit--floor--building-line-2026-09-16-clickup-z8r3fdff8r).
- **Prep-floor seam for T2 (`z8r3fdff97`).** Every selectable-time helper —
  `selectableTimeWindows`, `selectableTimeWindow`, `isTimeSelectable`,
  `defaultTimeWithinHours` — takes an optional trailing **`prepMinutes`** and
  hands it to `minSelectableTimeMinutes(dateEpoch, now, prepMinutes = 0)`,
  which floors today at `now + max(15, prepMinutes)` rounded up to 5. It is
  **threaded, not applied by the caller**: a second floor further down the
  chain would be a second source of truth for "the earliest moment a buyer
  may pick", and the two would drift. Defaults to 0 everywhere, so every
  pre-existing caller is byte-identical (test-pinned by equality against the
  no-arg call). A **future day returns 0** — prep is absorbed overnight, the
  min-notice posture; that is a semantic call living inside
  `minSelectableTimeMinutes`, so changing it later moves no caller. On a
  split day a long prep can swallow the first window whole, and the prefill
  follows into the second rather than into the break. **Consumed by
  `z8r3fdff97`** — the next section.

## Update (2026-09-17, z8r3fdff97): prep time per product, and a pickup time when it matters

Huff & Puff's ice-cream puffs take about two hours to make. Neither lever
above could say so: notice 0 lets a buyer collect in 15 minutes, notice 1
removes same-day entirely. And the collection instruction ("side counter —
bring an ice bag") lived in the product description, which never rides the
order. Three per-product additions:

- **Prep time** — `products.prepMinutes`, whole minutes in
  `[0, MAX_PREP_MINUTES = 1440]`; `0` / blank → unset, the one spelling for
  "no rule". The hours-scale sibling of `minNoticeDays`: **notice moves the
  day, prep moves the clock.**
- **A pickup time** — self-collect orders keep `fulfilmentTimeMinutes`
  (they were date-only since Aug, above).
- **A pickup note** — the collection instruction, frozen onto each order
  line. It belongs to the pickup subsystem: see [`fulfilment.md`](./fulfilment.md)
  ("Per-product pickup note").

**The floor.** Today only: `now + max(15, prep)`, rounded up to 5 — through
the T1 seam above, never a second floor. A future day is untouched (prep is
absorbed overnight). The **slowest** product in the cart sets it, the way the
strictest sets notice, and a refusal names it:

- "“Ice Cream Puff” needs 2 hours to prepare — earliest pickup is 11:00 AM"
- "“Ice Cream Puff” needs 2 hours to prepare — too late for today, pick a later day"

`convex/lib/prepFloor.ts` (`slowestPrep`, `prepFloorIssue`) is the one author
of the rule and its words, and it is **hours-aware**: it reads the selectable
windows, so the earliest time it names can always be picked — never inside a
split day's break, never after closing — and a prep that outlasts today's
hours says "too late for today" instead of pointing at a slot after the
shutters. (The first cut floored against midnight and got both wrong.) It is
deliberately silent on everything that is not prep's fault, so the
opening-hours gate keeps its own words for a closed day or a break.

**What prep races: closing time, or midnight.** A handover the store's hours
bound is made across its counter, so its prep races **closing time**. A
**drop-off meet-up** isn't: its hour is its point's own schedule, so its prep
races **midnight** on every day the store opens. `prepFloorHours(hours, timed)`
makes that call at all four call sites (`orders.create`,
`orderClaims.commit`, and through `isFulfilmentDaySelectable` /
`fulfilmentDayCopy` / `prepHint` at both checkouts): the store's hours for a
bounded handover; for an unbounded one, every open day widened to the whole
day, closed weekdays still closed so "closed on Fridays" speaks first. Judged
against the hours, a date-only order placed after closing found no slot with
prep AND none without, so prep looked blameless and a 24-hour prep could be
booked for that evening's meet-up. The reverse was wrong too: a 2-hour prep at
4:30 PM was refused for a meet-up only because the store's own counter closes
at 6. The date-only hint reads "…so it's ready from 6:30 PM today".

`timed` is **`asksForTime`, the checkout's own question** — on the server too
since `z8r3fdg9aa`. It used to ask a cheaper one there, "did a time arrive in
the request?", and the two diverge the moment a request omits a time the
checkout would have required (a stale tab, a hand-made `orders.create`): the
server then took the *lenient* reading and widened a counter's day to midnight.
A 9-to-6 store with a 2-hour cake, ordered date-only at 5 PM, was accepted for
a collection that couldn't be ready before 7 — from a counter shut at 6. The
missing time is still **accepted** — a date-only order is a legitimate shape,
the one every pickup had before `z8r3fdff97`, and the seller can set an hour
with Reschedule — it is only judged honestly now.

**An order clears BOTH deadlines** — `orderPrepFloorIssue`, the entry point
`orders.create` and `orderClaims.commit` call (`prepFloorIssue` judges one).
Neither deadline implies the other:

| Deadline | What it is | When it bites |
| --- | --- | --- |
| The **handover's** | Closing time when the store's hours bound it, else midnight | Inside the open window — a 2-hour prep at 4:30 PM at a 6 PM counter |
| The **day's** | Midnight, for a request that named no hour at all | After closing, where the handover deadline goes *silent* — no slot left with prep and none without, so prep isn't what emptied the day and it defers (`prepFloorProblem`) |

Without the second, holding a counter to its real hours would have *unrefused*
the case `z8r3fdff97` fixed: at 8 PM a 24-hour prep books tonight, because prep
has nothing left to measure. A request that DID name an hour is judged on that
hour alone — the day's deadline is the date-only reading of "today".

**Still open, deliberately** ([`z8r3fdg9pv`](https://app.clickup.com/t/z8r3fdg9pv)):
a date-only order for a day whose window has already passed is accepted when
prep is small or zero — at 8 PM a 2-hour cake for today still goes through,
from that same shut counter. Prep declines to speak (it isn't prep's fault) and
`assertWithinOpeningHours` applies its **window** test only where a time
exists. That is the opening-hours gate's gap, not prep's, and closing it moves
prep-free orders too.

**One boolean decides whether it applies** — `prepFloorApplies`, in
`orders.create` and `orderClaims.commit`. Exempt:

| Path | Why |
| --- | --- |
| A **collection** trip (the rider collects from the buyer) | The work happens after the rider arrives; prep has nothing to delay. |
| Counter checkout | Never runs this path — the seller is standing there (the notice posture). |
| Bookings | Their own flow; a request-to-book IS the preparation. The form hides prep on a booking listing. |
| Seller reschedule | The seller is the authority on her own exceptions — see "Seller reschedule". |
| Event orders (T3, `z8r3fdff9u`) | The seller fixed the moment; add `&& eventLock === undefined` to `prepFloorApplies` when T3 lands. |

A product needing **a day or more of notice** can't be ordered for today, so
its prep changes nothing. The Order rules card says so in amber rather than
disabling the field — loosening notice back to 0 finds the prep intact — and
the storefront hides the "Ready in ~2 hours" chip on such a product.

**When checkout asks for a time.** Delivery always has. A **pickup asks only
when something makes the hour matter** — the store keeps opening hours, or the
cart needs prep time — and is then required and prefilled like delivery. A
store using neither keeps its date-only pickup, byte for byte, and a
**drop-off meet-up never asks**: its schedule note sets the hour. At a
time-bearing pickup, the server holds the time to the windows and the break
like a delivery's.

`asksForTime` lives in **`convex/lib/fulfilmentShape.ts`** (with the
`FulfilmentKind` type and `fulfilmentKind()`), not in the checkout's own
module, because `orders.create` and `orderClaims.commit` ask it too — see the
deadline section above. `src/lib/checkout-fulfilment.ts` re-exports all three,
so a checkout still reads its whole "when" vocabulary from one import. Both
servers feed it the same inputs the client does: the kind, the point's
`locationType === "drop_off"`, the store's hours, and the cart's prep.

**Checkout, storefront and claim link alike.** The cart's rules live in one
pure module, `src/lib/checkout-fulfilment.ts`, built ON T1's time rules
(`src/lib/fulfilment-time-issue.ts`, the test-round section above) rather than
beside them — each form keeps only its wiring:

- `fulfilmentDayCopy` / `fulfilmentTimeCopy` — the inline notice and the
  submit check, one sentence as `CopyPart`s, rendered through `CopyText` in
  both places: under the field, and beside the CTA (T1's refusal state holds
  the parts, so a prep refusal's time stays whole in the mobile bar too). They are thin calls into T1's
  `fulfilmentTimeIssue`, which **carries prep as a cause**: given the cart's
  `prepMinutes` and `prepItemName`, a `too_early` or `no_slot` that prep
  produced comes back with `prep: { itemName, minutes }` — decided by
  `prepFloorProblem`, the function behind orders.create's refusal — and
  `timeIssueCopy` words it with `prepFloorCopy`, the builder the server joins.
  One precedence rule and one sentence for both checkouts, inline and at
  submit: "“Ice Cream Puff” needs 2 hours to prepare — earliest pickup is
  12:00 PM", or "— too late for today, pick a later day".
- **"Closed" vs "no time left" for every store**, not just under prep.
  `no_slot` carries a `reason`: `closed_day` (the store doesn't open that
  weekday), `closed` (it's past today's LAST closing time) or `too_late` (the
  store is still open but the checkout lead — or prep — runs past its last
  slot). Before, any timed store with hours read "has closed for today" at
  5:50 PM with a 6:00 PM close; it now says "There's no time left to deliver
  today — pick tomorrow". `timeIssueCopy` also gained a **"pick up"** verb
  ("Pick a pickup time.", "The earliest you can pick up is …"); "collect"
  stays the collection service's.
- `isFulfilmentDaySelectable` — chips and the default date skip a today the
  store has closed on, or that prep has used up (for a date-only pickup, a
  today whose prep runs past midnight).
- `prepHint` — one line under the step title, about **today**: "“Ice Cream
  Puff” takes about 1 hour to prepare, so the earliest pickup today is
  9:15 AM", or "…so it can't be ready today" when the chips skip Today. Null
  whenever prep changes nothing the buyer can see.
- **Rules read live.** Prep, note and notice days come from the product list
  the checkout already subscribes to; the cart's own snapshot stands in only
  while it loads or for a product that has left the list. A seller's edit
  after the buyer added the item, or a cart saved before prep existed, is
  judged as `orders.create` will judge it. (Submit now also checks the
  *effective* notice, store ∨ cart — it used to pass the store notice alone
  and let a stricter item notice through to a server refusal.)
- **The repair is T1's**, ownership-aware `planTimeRepair`, floored by the
  cart's prep through its `prepMinutes` — one loop and one `systemTimeRef`
  for both methods (a pickup time reuses the delivery time field). A time the
  buyer typed is never rewritten. Its 30s beat (and tab return) also
  re-renders the prep hint and re-floors the dates past midnight. When PREP is
  why a prefilled time moved — the plain lead would still have allowed it —
  T1's `passed` reason carries `prep` and the note names it: "We moved your
  time to 1:30 PM — “Ice Cream Puff” needs 1 hour to prepare." (one phrase,
  `prepNeedsText`, shared with the refusal). A time the clock overtook stays
  "no longer available".
- **Refusals retire with their inputs** (T1's `fulfilmentInputsKey`, which
  already includes the pickup point): switching to a drop-off point, which
  takes the time requirement away, clears a time refusal made at a self-collect
  point.
- **The store's hours sit on the time field only.** A pickup asks for a time
  whenever the store keeps hours, so T1's date hint for a date-only pickup
  could never render and was removed rather than kept as dead code; a
  drop-off meet-up (date-only) runs on its point's schedule note instead.
- **An untouched date only moves when it slips below the floor** (midnight,
  a raised notice) — to the first day that can actually be fulfilled. A date
  the clock makes impossible is left alone: the inline notice explains and the
  buyer chooses. Silently moving an order to another day is worse than asking.
- **Claim links** mirror all of it: `orderClaims.getByToken` decorates each
  frozen line with its product's live prep and note, and commit keeps a
  self-collect time (it was silently dropped), applies the floor and freezes
  the note. See [`claim-links.md`](./claim-links.md).

**Where the time shows.** Every surface that already read
`fulfilmentTimeMinutes` shows a pickup time for free — the buyer's wa.me
message ("🗓️ Collect on: …"), `/track`, the seller order page, the seller
alert, the email, the calendar feed, the CSV "Fulfilment time" column. New in
this ticket: the inbox card's date badge ("Today · 3:30 PM",
`fulfilmentBadgeLabel`), the notify-manager message ("Collect on …"), and
**same-day orders sort by time** — in the inbox's due sort
(`compareInboxOrder`) and the table's Fulfilment date column
(`fulfilmentMomentSortKey`), untimed after timed, so a kitchen's pickup list
reads in the order buyers arrive.

**Seller side.** The Order rules card (and the create wizard) puts **Prep
time** directly under notice, with presets (30 min / 1 hour / 2 hours /
4 hours, `PREP_PRESETS`), then **Pickup note**; both are hidden on a booking
listing. The card's own description names all four rules — it used to say
"leave both blank" beside four fields, and called a collection instruction a
limit. The prep helper states the **24-hour ceiling** and sends anything longer
to the notice days above, so the cap isn't first met as a refusal after Save.
The store's "Order date notice" setting points sellers who need hours rather
than days at the product's prep time. In the **wizard**, prep time sits on the
Review step under "More options", while step 5 is called *Preparation* and only
asks about stock policy — so answering **"Made fresh"** there names prep time
and says where it is, rather than leaving the made-to-order seller to find it.
Both fields ride the spreadsheet import/export —
[`bulk-product-upload-roadmap.md`](./bulk-product-upload-roadmap.md).

**Known limits.** Prep is per product, not per variant; there is no
store-level prep; prep never bites a future day by design (a product that
needs a day uses notice); a drop-off point's schedule note is advisory, not
enforced; and the Meta confirmation template carries no pickup notes — `/track`
and the order page are the surfaces guaranteed to show them.

## Seller reschedule (19 Aug 2026, ClickUp 86eyp5qd1)

The escape hatch the 3 AM advance order exposed: a buyer scheduled a delivery
two days out at 3:00 AM and nothing in the product could change it — both
fulfilment fields were write-once at `orders.create`, and dispatch would only
offer a rider *at 3 AM*. Now the seller agrees a new time with the buyer in
chat and records it on the order.

- **`orders.rescheduleFulfilment`** (owner-or-admin via `requireRetailerAccess`,
  admin act-as audited): patches `fulfilmentDate` (+ `fulfilmentTimeMinutes` on
  delivery and, since `z8r3fdff97`, self-collect orders) and writes a
  `fulfilment_rescheduled (from … to …)` orderEvent in the `delivery_fee_set`
  note style. Omitting the time keeps the existing one — a date-only change can
  never silently drop the clock. `null` clears a self-collect time (see the
  update below). A dateless legacy order may be *given* a date (`from unset`).
- **Window**: `pending`/`confirmed`/`packed` only; refused on
  shipped/delivered/cancelled, on counter orders (fulfilled on the spot), on
  bookings (their fulfilment date IS the check-in — server backstop added in
  `z8r3fdff97`; the order page never showed the trigger), and once a collection
  order's goods have arrived (`collectedAt`).
- **The hard guard is the ACTIVE Lalamove job**: a booking is frozen against
  its `quotationId` and will NOT follow the order, so rescheduling under it
  would desync the buyer's promise from the trip. Server throws; the dialog
  opens onto an explanation pointing at "cancel the booking first". Order of
  operations is therefore *reschedule → book*, never the reverse.
- **The buyer-facing minimum-notice floor does NOT apply** — the notice window
  protects the seller's lead time and the seller is the one moving the date.
  The `[today, +30d]` range still holds (validation passes notice `0` to
  `assertValidFulfilmentDate`).
- **The buyer sees it instantly, with zero new plumbing**: the tracking page
  reads `orders.get` reactively, later stage messages/emails render from live
  order fields, and the inbox due-today buckets/sort are live reads.
  Deliberately **no new WhatsApp send** (one-msg-per-order posture) — messages
  already sent keep the old time; the chat agreement covers that, and the
  dialog's helper copy says so ("agree the new time with them in chat first").
- **The buyer's page SAYS it moved** (z8r3fdff97 test round). Because nothing
  is sent, "Collect on Mon, 21 Sep · 1:00 PM" on `/track` reads exactly like
  the moment the buyer picked themselves — a seller who moves 3 PM to 1 PM
  leaves no trace the buyer can see. The order now carries `rescheduledAt` +
  the moment it moved FROM (`rescheduledFromDate` /
  `rescheduledFromTimeMinutes`, the second absent when the seller cleared the
  time), and both order pages render `RescheduledNote` from it: the buyer
  reads "**IndoMart changed this** — it was Mon, 21 Sep 2026 · 3:00 PM. 5m
  ago", the seller "**You moved this** — …" (they may not be the one who did,
  and the chat won't tell them either). Stamped only when the moment actually
  differs, so re-saving the same day never cries "changed"; hidden on the
  buyer's page once the order is delivered or cancelled — then it's history,
  not news.
- **UI**: `RescheduleFulfilmentDialog` on order detail's Fulfillment card —
  renders only inside the reschedule window ("Reschedule", or "Set date" on a
  dateless order), native date+time inputs, live "the buyer's order page will
  show …" preview. **Past/beyond-window picks are refused live** (20 Aug
  follow-up — native min/max are advisory): a passed day, a passed time today,
  or a beyond-30d day disables Save with a visible reason, the fee preview
  skips invalid moments (a quote would legitimise them), and an overdue
  order's prefill clamps to today (keeping the agreed time-of-day). The
  server's range check stays the backstop. On a **bookable Lalamove order** the dialog also fetches a
  debounced **"Lalamove for this slot"** price for the picked moment (rider
  prices are slot-sensitive) with the frozen buyer-paid fee named beside it —
  purely the seller's cost outlook, re-quoted for real at booking; flat/
  radius/weight stores never see it (their fees aren't time-sensitive). The
  Fulfillment card itself is two stacked rows (header + Reschedule up top,
  date/time on its own full-width line under a separator) so the badge, time
  and control never fight for one mobile line.
- Dispatch needs no change to follow: `prepareBooking` re-derives
  `requestedMoment` from the live order doc on every quote. The companion
  dispatch-side picker (book a rider at a *different* moment than the order
  promises) lives in docs/delivery-lalamove.md.
- **Prevention shipped alongside** (86eyp5rav, the section above): opening
  hours now gate the buyer's picker at checkout + `orders.create`. This
  reschedule is the vendor-side correction for orders that predate the
  setting or were agreed as exceptions — the seller's own controls are
  deliberately NOT bound by opening hours (the vendor is the authority on
  their own exceptions), which is also why the canonical rebook bug
  (86eyp63xn, Wagyu Walid) is fixed by this pair and not by hours alone.

### Update (Sep 2026, `z8r3fdff97`): a pickup time moves too

Self-collect orders carry a pickup time since the prep-time ticket (see the
section below), so the reschedule dialog and mutation stopped treating pickup
as date-only.

- **Self-collect: set, keep or clear.** The dialog shows an optional **Pickup
  time**, prefilled from the order, with "Optional — leave blank for any time
  that day" and a **Clear time** button. Clearing states its consequence
  ("Removes the 3:00 PM pickup time — the buyer can come any time that day")
  and sends `fulfilmentTimeMinutes: null`; a blank field on an order that never
  had a time sends nothing (keep), so the dialog never invents a time.
- **Delivery keeps a time.** The server refuses `null` on a delivery —
  dispatch composes the rider's moment from it. The dialog used to preview an
  emptied delivery time as date-only while the save quietly kept the old one;
  it now disables Save with "A delivery keeps a time — pick a new one rather
  than clearing it", so the preview, the saved value and the toast agree.
- **Drop-off meet-ups stay date-only**, exactly as checkout offers them: no
  time input, and the point's frozen `scheduleNote` shows beside the date
  ("Drop-off schedule: Every Sat 3–5pm").
- **Neither buyer-side clock rule binds the seller.** Opening hours were
  already exempt (above). The per-product **prep floor** is too: "the puffs
  are done early, come in 30 min" is what this dialog is for, and
  `prepMinutes` is not frozen on the order, so enforcing it would judge an old
  order by today's product settings. The dialog's own passed-moment refusal is
  the only clock rule a seller needs.
- **A pickup time never reaches dispatch.** Lalamove and Delyva both return
  `not_delivery` before reading the moment (`dispatchBlockReason`), and a
  self-collect order never fires the dialog's slot-price quote. Pinned by
  tests in `lalamove.test.ts` and `delyva.test.ts`.

