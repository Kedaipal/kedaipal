# Order Note at Checkout

**Status: implemented.** Lets a shopper attach one free-text instruction to an
order at checkout ("no onions", "deliver after 5pm", "ringgit notes for change
pls"). It rides with the order through the `wa.me` handoff, persists on the order
record, and surfaces prominently in the seller's order detail — so the
instruction isn't buried in WhatsApp scrollback. Source: Sukhjeet (Metalpix)
round-2 feedback, 4 Jun 2026.

## Data

One optional field on `orders` (`convex/schema.ts`):

```ts
customerNote: v.optional(v.string()),
```

Order-level and **distinct from `deliveryAddress.notes`** (address/gate detail,
delivery-only) — self-collect orders need a note too. Additive optional field →
no migration; legacy orders read as "no note". No index.

## Flow

1. **Checkout** (`checkout-sheet.tsx`) — an optional "Note for seller" textarea
   (multiline, `maxLength` 500 with a live counter that warns near the cap). Held
   as local form state, not in `useCart` (the note is order-level, not a cart item).
2. **Create** (`orders.create`) — accepts `customerNote`, trims it, treats
   whitespace-only as absent, hard-caps at `MAX_CUSTOMER_NOTE = 500` (throws past
   it — defense-in-depth behind the client cap), and persists. Channel-neutral, no
   adapter change.
3. **`wa.me` body** — the note is appended **last**, in a delimited
   `📝 Note for seller:` section, *after* the `Order: ORD-XXXX` line. So even if
   the note contains something resembling an order token, the inbound parser still
   matches the real ID first (`SHORT_ID_REGEX` takes the first match), and the note
   never lands inside the items block. The whole body is `encodeURIComponent`-ed,
   so newlines/emoji are safe.
4. **Seller view** (`app.orders.$shortId.tsx`) — rendered as a distinct amber
   "Note from customer" block right under the header (front-and-centre, not in a
   sub-panel). Hidden entirely when absent.
5. **Buyer echo** (`track.$token.tsx`) — shown as a "Your note" block under the
   order summary so the shopper can confirm it stuck.

## Safety

Plain text only. Both read sides render `{order.customerNote}` in JSX (React
escapes by default — no markdown/HTML interpretation) with `whitespace-pre-line
break-words` to preserve newlines without breaking layout. No `dangerouslySetInnerHTML`.

## Tier

Starter (RM79) — baseline order-capture quality, ungated.
