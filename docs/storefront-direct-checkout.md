# Storefront — direct-to-checkout from the product view

**Status: implemented.** Buyer-facing flow shortcut. Previously, a shopper who
added items from inside the **product detail sheet** had to close the sheet (tap
the ✕) to reach the fixed **cart bar** and its "Checkout on WhatsApp" button — an
extra, non-obvious step on the path to buying. This adds a **"Go to checkout"**
CTA in the sheet's own footer so the buyer proceeds straight to the review sheet
without leaving the product view. All-tier, buyer-facing, no plan gating (the
buyer flow can't vary by seller plan — same reasoning as the checkout date
picker and the price preview). Source: Zaki, 20 Jul 2026. ClickUp `86eybhqye`.

## The CTA

`src/components/storefront/product-detail-sheet.tsx`

A full-width **"Go to checkout"** button sits directly below the quantity
stepper + "Add to cart" row in the sticky footer:

```
[ − ] 2 [ + ]        [ Add to cart ]
🛍 ③  Go to checkout                    RM 100.00  →
```

- **Appears only once the cart holds ≥1 item** (`cartItemCount > 0`) — an empty
  cart has nothing to check out, so un-added products keep a clean footer. It
  reflects the **whole cart**, not just this product, so it also lets a buyer
  deep in a product jump to checkout for items added earlier.
- Styled as a **tinted-accent secondary** (border + `bg-accent/10`) so it never
  competes with the filled-accent "Add to cart" **primary** above it. It mirrors
  the cart bar's own affordance: a shopping-bag icon with a **count badge** on
  the left, the **cart total** on the right, and a `→` to signal navigation.
- The **money total is dropped when the cart total is 0** (a quote-only cart of
  made-to-order lines) — the count + arrow remain, no misleading `RM 0.00`.
  Same posture as the grid tile's "N in cart" line.
- Tapping it **closes the product sheet, then opens the checkout/review sheet**
  (closing first avoids two stacked radix dialogs). The buyer lands on the same
  "Review your order" sheet the cart bar opens — this is a shortcut to it, not a
  second checkout path.

The product sheet still **stays open after "Add to cart"** (so a buyer can add a
standard variant *and* request the custom line in one visit); the new CTA is the
explicit "I'm done, take me to checkout" exit, replacing the implicit
close-then-find-the-cart-bar dance.

## Wiring — why the route owns the open-state

The product detail sheet (owned by `ProductGrid`) and the checkout sheet (owned
by `CartBar`) are **siblings** under the storefront route. For the product sheet
to open checkout, the open-state was **lifted to the route**:

- `CartBar` no longer owns `checkoutOpen` — it's **controlled** via
  `checkoutOpen` + `onCheckoutOpenChange` props.
- `ProductGrid` takes `onRequestCheckout`, threads a wrapped `onCheckout` to the
  detail sheet that first closes the sheet (`setOpenProduct(null)`) then calls
  `onRequestCheckout()`.
- Each route (`/$slug` and `/$slug/c/$categorySlug`) holds
  `const [checkoutOpen, setCheckoutOpen] = useState(false)` and passes the
  trigger to `ProductGrid` and the state to `CartBar`. Both storefront routes
  render the same trio, so both got the identical three-line wiring.

The detail sheet's new props (`cartItemCount`, `cartTotal`, `onCheckout`) are all
**optional** — a standalone render (e.g. tests) omits them and the CTA simply
doesn't appear.

## Tests

- `src/components/storefront/product-detail-sheet.test.tsx` — CTA hidden when the
  cart is empty and when no `onCheckout` is wired; shown with count + total once
  the cart has items and fires `onCheckout` on click; money amount omitted for a
  quote-only (total 0) cart.

## Related

- [`storefront-price-preview.md`](./storefront-price-preview.md) — the live total
  row this CTA sits beneath, and the cart aggregates (`cart.itemCount` /
  `cart.total`) it reads.
