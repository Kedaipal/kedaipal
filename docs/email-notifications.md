# Retailer Email Notifications — Implementation Reference

Reference doc for the retailer-facing email notification system. **Already implemented and shipped.** This file documents what exists, why it was built this way, and what remains to wire in next (e.g. payment alerts).

## Context (2026-04-28)

**Why email instead of WhatsApp for retailer alerts.** The original implementation routed retailer alerts via Meta WhatsApp Cloud API (`sendText` to `retailer.waPhone`). Two structural Meta restrictions made this unreliable on the test number:

1. **Recipient allowlist** — test numbers are capped at ~5 explicitly-listed recipients. Any retailer outside the list silently fails.
2. **24-hour customer-service window** — free-form text only works within 24h of the recipient last messaging the bot. Business-initiated alerts after the window need approved templates, which require Meta business verification — incompatible with the founder's Singaporean-in-MY entity reality (see `PROJECT_CONTEXT.md`).

**Decision:** retailer-facing notifications go via email (Resend). Shopper-facing WhatsApp is a separate channel: the `wa.me` cart handoff, the inbound `ORD-XXXX` webhook, and the order's **one** confirmation message.

> **Updated 2026-08-04 ([`86eyd63r8`](https://app.clickup.com/t/86eyd63r8)):** this line used to add "…and `notifyStatusChange` for packed/shipped/delivered/cancelled all still work". Those sends are **deleted** — an order sends the buyer exactly one WhatsApp message and everything after it lives on `/track/<token>`. See [`one-message-per-order.md`](./one-message-per-order.md). **Email is unaffected**, and its role grew: for a seller, email is now the richest push channel Kedaipal has, since the buyer side deliberately has almost none.

## What got built

### Schema

`retailers.notifyEmail: v.optional(v.string())` — operational notification address. Independent of Clerk auth email so retailers can route to a shared ops inbox. Empty = no email notifications, mirrors the WA `waPhone` skip behaviour.

### Files

| Path | Purpose |
|---|---|
| `convex/lib/email.ts` | `fetch`-based Resend client, reads creds at call time so tests can stub `globalThis.fetch` |
| `convex/lib/emailCopy.ts` | Bilingual EN/MS templates for `newOrder` and `orderConfirmed`, returns `{ subject, html, text }` |
| `convex/email.ts` | `getOrderForRetailerEmail` query + `notifyRetailerOrderAlert` action (mirrors WA pattern) |
| `convex/email.test.ts` | 5 tests — newOrder, orderConfirmed, skip-when-empty, MS locale, swallowed failure |
| `convex/lib/slug.ts` | Added `assertValidEmail` validator |
| `src/lib/schemas.ts` | Added `settingsNotifyEmailFormSchema` |
| `src/routes/app.settings.tsx` | New `NotifyEmailForm` in the **Store** tab |

### Trigger points

Both retailer alerts schedule the same email action:

- `orders.create` → `internal.email.notifyRetailerOrderAlert` (`newOrder`)
- `whatsapp.handleInbound` after a successful ORD-XXXX match → `internal.email.notifyRetailerOrderAlert` (`orderConfirmed`)

The action picks the alert key from `order.status` (`pending` → `newOrder`, anything else → `orderConfirmed`).

### Default email behaviour

- **New retailers:** `createRetailer` prefills `notifyEmail` from `identity.email` at signup.
- **Existing retailers:** `ensureNotifyEmailFromIdentity` mutation runs once when the dashboard mounts (`src/routes/app.tsx`), idempotent server-side, only patches when current value is empty.
- Either way, retailers can override or clear via Store settings.

### Removed code

The WhatsApp retailer-alert path was deleted entirely (not feature-flagged):

- `convex/whatsapp.ts` — `notifyRetailerOrderAlert` action and `getOrderForRetailerAlert` query removed.
- `convex/lib/whatsappCopy.ts` — `RetailerAlertKey`, `RetailerAlertVars`, `deliveryLabel`, `waRetailerCopy`, `renderRetailerAlert` removed.

The schema's `channel: "whatsapp"` literal stays — that's the marketplace-connector anchor and unrelated to notifications.

## Env requirements

`.env.local.example`:

```
RESEND_API_KEY=
EMAIL_FROM=Kedaipal Orders <orders@kedaipal.com>
```

Production rollout requires verifying the sender domain (`kedaipal.com` or chosen sender) in the Resend dashboard. Until verified, sends 4xx and the action's swallowed catch logs to Convex.

## Patterns worth reusing

When adding a new retailer-facing alert (e.g. `paymentClaimed` — see `payment-handshake-roadmap.md`):

1. Add the new key to `RetailerEmailKey` in `convex/lib/emailCopy.ts`.
2. Add EN + MS copy entries returning `{ subject, html, text }`. Reuse `wrapHtml` and `escapeHtml`.
3. Either reuse `notifyRetailerOrderAlert` (if the trigger is order-status-derived) or add a sibling action with the same skip-conditions / swallow-errors structure.
4. Schedule via `ctx.scheduler.runAfter(0, internal.email.<action>, { ... })` from the originating mutation.
5. Add a test in `email.test.ts` mirroring the existing structure (filter `fetchMock.resendCalls()` by URL).

## Known limitations

- **convex-test fake-timer noise.** Scheduled actions inside `vi.useFakeTimers()` log `Email retailer notify lookup failed: Transaction not started` on stderr. Same root cause as the WhatsApp scheduled-send noise (historically `notifyStatusChange`, now the confirmation push). Errors are swallowed; tests still pass. Not fixable without upstream convex-test changes.
- **No retry / dead-letter.** A 4xx from Resend (e.g. unverified domain) drops the alert with a Convex log. Acceptable at MVP scale; revisit if reliability bites.
- **Plain HTML, no React Email.** Two messages don't justify a templating dep. Reconsider when adding 5+ message types or when needing inline preview headers / dark-mode handling.

## Future work

- Add `paymentClaimed` retailer alert when the payment handshake ships (see `payment-handshake-roadmap.md`).
- Optional reminder cron — nudge retailer if `claimed > 24h` or shopper if `pending > 24h`.
- Optional in-dashboard toast / push as a third notification surface.
- Once the WhatsApp retailer side is solved (templates approved + business verification done), revisit whether to send WA + email in parallel for redundancy.
