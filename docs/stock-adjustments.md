# Stock integrity — how `onHand` moves

ClickUp [`86eypn8ye`](https://app.clickup.com/t/86eypn8ye). Found in a
concurrency audit run before the first SG vendor's live sale.

**Concurrent checkouts were never the problem.** `orders.create` reads and
decrements `onHand` inside one Convex mutation, sums quantity per variant across
cart lines, and the gate makes a negative count unreachable. That part was, and
is, correct.

The problem was that `onHand` could be inflated **above physical reality** by
paths that had nothing to do with concurrency — after which a later checkout
passes its stock check against a lie and the store oversells for real.

## Hole 1 — cancelled is now terminal

`applyStatusTransition` only ever handled the *into*-cancelled direction, so
re-opening a cancelled order never re-took its stock. `advanceToStage` blocked
that, but **`updateStatus` and `bulkUpdateStatus` did not** — the ticket named
only the bulk path; the audit found the single-order one was open too.

The cycle was repeatable and unbounded:

| step | onHand |
| --- | --- |
| order for 3 | 10 → 7 |
| cancel — restore | 7 → 10 |
| bulk "Mark confirmed" from the Cancelled tab — **no re-decrement** | 10 |
| cancel again — the `!== "cancelled"` check now passes, restore fires again | 10 → **13** |

`decrementAggregatesForCancel` and the usage meter are floored at zero and
self-heal. `onHand` had no floor and no ceiling.

Now: `updateStatus` **throws** (a single order is a deliberate act, and silence
would look like it worked), and `bulkUpdateStatus` **skips** with a counted
reason the toast names — matching its existing skip-list behaviour for the
mockup, collection and rider gates, where a batch is expected to be partially
applicable.

## Hole 2 — stock left the product save entirely

`saveVariantGrid`, `updateVariant` and `bulkUpsert` all wrote `onHand` as an
absolute, last-write-wins. None read first.

> A seller opens the product editor at 14:00 with `onHand: 50` rendered into the
> form. Thirty units sell over the next four minutes. At 14:04 they fix a typo
> in the product name and tap Save — and 50 is written back, resurrecting thirty
> sold units. They did nothing wrong and got no warning.

This was the likelier of the two to fire: editing a live product mid-sale — fix
a price, hide a sold-out size, correct a description — is exactly what a vendor
does during a drop.

### Why option (c), not (a) or (b)

The ticket offered three. (a) send a delta from the same form; (b) send the
`onHand` the form rendered with and reject on mismatch. Both keep stock inside a
save the seller opened **for another reason**, and that is the actual defect: a
number they never intended to touch riding a button they pressed for something
else. (c) removes the coupling instead of managing it.

### Where stock can now change

| path | writes `onHand`? |
| --- | --- |
| `products.create` / new grid combinations | **yes** — a brand-new row has no stock of its own to protect |
| `products.adjustStock` | **yes** — the explicit control |
| `orders.create`, cancel-restore | **yes** — the order lifecycle |
| `products.bulkUpsert` on an existing product | **only** with `updateStock: true` |
| `saveVariantGrid` on an existing variant | **never** |
| `updateVariant` | **never** — the argument no longer exists |

`saveVariantGrid` still *receives* `onHand`, because the same validator serves
the insert path where it is correct. The patch simply omits the key — an
untouched count is never rewritten, not even to the same value.

## `products.adjustStock`

Takes a **list**, because the multi-variant sheet moves several counts at once.
One mutation is one transaction, so a sheet applies whole or not at all; N
separate calls would leave some rows moved, some not, and no way to tell which.

Each entry is one of two shapes, and the difference is the whole point:

**`delta` — a movement.** *"I baked 20 more", "sold 3 at the stall".* Correct
against any starting number, so a sale landing between the seller's last look
and the write cannot corrupt it. The read happens inside the transaction, so two
adjustments racing each other both land. Floors at zero rather than throwing,
matching `decrementAggregatesForCancel`.

**`setTo` + `expectedOnHand` — an overwrite.** For the one job a delta can't
express: a physical stock count. `expectedOnHand` is what the seller could see
when they confirmed; the mutation refuses if reality has moved past it.

That refusal is **deliberately not a silent merge**. Only the seller knows
whether they counted the shelf before or after those units went out the door, so
the answer has to come from them — the dialog re-renders on the live number and
one more tap confirms against a figure they have actually seen.

Refused outright: a `isCustom` line (priced on a quote, never counted — `onHand`
is coerced to 0 on every write path), a batch with the same variant twice (it
would apply in array order and the seller couldn't tell which won), and an entry
that is neither shape or both.

## The seller's side

### The control

Direction settled from a mockup canvas. The live count **is** the control — big
result, `−`/`+` either side, quick chips — rather than a mode picker (Add /
Remove / Set to) that makes the seller name a verb before they can type. Adding
after a bake and knocking one off after a bazaar sale are one-tap, and the
number they stare at is the number that will be true.

What survived from the rejected direction is the **confirm button**: it reads
`Add 10`, never `Save`. Together with the `Adding 10` line under the digits,
that keeps three numbers apart — the shelf now, the change, the result. Without
both, a large number that changes as you tap reads as "how many I'm adding".
`src/lib/stock-adjust.ts` is the single author of all three labels, and
`stock-adjust.test.ts` pins that they never say the same thing.

The exact-count path is reachable but never the default, and is the only one
carrying a warning, because it is the only one that can still write a sale out
of existence.

**Confirming writes immediately**, before and independently of the product
form's Save. Said out loud in both surfaces — otherwise a seller adjusts stock,
backs out of the editor without saving, and reasonably expects the count to have
backed out too.

### Two doors, on purpose

Taking stock out of the product save is only an improvement if changing it got
**easier**. Buried behind Products → open → scroll to Pricing & choices, a
correctness fix would read as a regression.

- **Product editor** — a saved variant's stock renders read-only beside an
  Adjust button. New combinations keep a plain input.
- **Products list** — a `Stock` button per row: one tracked choice opens the
  dialog, several open the batched sheet. Not shown on made-to-order or bespoke
  variants (no count to move), nor on archived products (restore first).

The sheet carries a shared mode toggle rather than a per-row one: a stock take
counts the whole shelf, so the switch happens once. It is also the only way a
multi-variant product can express an exact count at all now — without it, a
seller who counted three sizes would have to do the arithmetic themselves, which
is the failure the exact-count path exists to prevent.

The bulk "Fill all stock" input hides when every tracked row is already saved —
an input that silently does nothing is worse than no input.

## The CSV import — the third door

Import is the same hazard with a far bigger window: export at 10am, edit the
sheet over lunch, import at 3pm, and five hours of sales come back.

The editor's answer doesn't transfer. Export → edit → re-import is a
**documented round-trip** and `stock` is a **required column**, so a genuine
stock take pasted into a spreadsheet has to keep working. Removing stock from
import would solve our correctness problem by handing the seller the work of
tapping through eighty dialogs.

So the side effect becomes a choice: **`updateStock`, default off**. Names,
prices, descriptions and weights always update. Ticking the box is not a leap of
faith — `bulkUpsertPreview` reports `stockChanges` (how many counts would be
replaced) and `stockIncreases` (how many would go **up**, the direction that
invents units and the likeliest sign of a sale made after the export), with
per-product samples so the seller can look rather than trust a number.

Products being **created** always take the sheet's stock: no orders, nothing to
overwrite.

The rule is stated on the import screen *before* the sheet is prepared (the
schema table and the intro block), not only at the confirm step.

## Related: the frozen reservation flag

`blockWhenOutOfStock` decides whether an order line took stock at all. Both
restore paths resolved it from the **current** docs rather than what was true at
create, so flipping the flag made restore asymmetric:

- ordered while tracked → flag off → cancel = units never come back;
- ordered while untracked → flag on → cancel = phantom units appear.

Now frozen onto `orders.items[].stockReserved` at create, the way `price` and
`variantLabel` already are. Counter checkout builds its own snapshot with its
own inline type and stamps it too — without that, every new counter order would
silently have taken the legacy re-resolve path, a miss that only surfaces months
later on one surface.

**Deliberately not backfilled.** Writing today's flag onto historical lines
would bake in the wrong answer for any product whose flag has since changed, and
the original is unrecoverable. Legacy lines fall back to re-resolving.

## Still open

**There is no stock expiry.** An order holds its units from `create` until a
human cancels it. The decrement is not conditioned on order status — the
confirmation push (86eyf1rck) changed the status an order is *born* with but not
the stock timing, so a `pending` order holds stock exactly as hard as a
`confirmed` one, and always did.
[`86eybbxhf`](https://app.clickup.com/t/86eybbxhf) (reservation ledger + 72h
release) is the proper fix and is still unbuilt. Reserved units are also not
netted off the count `adjustStock` shows, for the same reason.

A **stock history** — who moved what, when, why — is the natural next want now
that movements are explicit, and belongs with that ledger rather than bolted on
here.
