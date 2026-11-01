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
| `src/components/settings/order-alerts-card.tsx` | The *Email* row of the Order alerts card (Store tab; was `NotifyEmailForm` until 86eye9xd4) — switching it off clears the address with Undo |

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

Production rollout requires verifying the sender domain (`kedaipal.com` or chosen sender) in the Resend dashboard. Until verified, sends 4xx and the action's swallowed catch logs to Convex. Verifying it is only half the job: read [Sender authentication](#sender-authentication--spf-dkim-dmarc-z8r3fdxrx5) before anything new sends as `@kedaipal.com`.

## Sender authentication — SPF, DKIM, DMARC (z8r3fdxrx5)

**Why it matters here.** We email sellers about money: invoices, dunning
(0 / +2d / +5d) and HitPay Pay-now links, all from `EMAIL_FROM`. Without a
DMARC policy, anyone can send `From: Kedaipal <orders@kedaipal.com>` with their
own payment link and most inboxes deliver it. DMARC tells receivers to reject
mail claiming our domain unless it passes SPF or DKIM **aligned** on
`kedaipal.com`. Gmail and Yahoo also expect DMARC on bulk senders, so it is a
deliverability fix for real billing mail too.

### Who is allowed to send as `@kedaipal.com`

Audited 2 Nov 2026 from public DNS and a real Resend message's
`Authentication-Results` header. All records live in the Cloudflare zone.

| Sender | Sends | SPF (aligned via) | DKIM (selector) | State |
| --- | --- | --- | --- | --- |
| **Resend** (`convex/lib/email.ts`, the app's ONLY mail path) | Order alerts, billing, dunning, Pay-now, trial, handover, admin alerts | `send.kedaipal.com` TXT `v=spf1 include:amazonses.com ~all` + MX `feedback-smtp.ap-northeast-1.amazonses.com` (bounce/return-path only) | `resend._domainkey` | Both pass, both aligned (verified on a real message) |
| **Google Workspace** | Founder + support mail (`hello@`, `arif.r@`, aliases) | Root TXT `v=spf1 include:_spf.google.com ~all` | `google._domainkey` (published) | Record is published. Confirm signing is **on** (Admin > Apps > Gmail > Authenticate email shows "Authenticating email") |
| **Clerk** (prod) | Sign-in and verification codes | `clkmail.kedaipal.com` CNAME to `clerk.services` | `clk._domainkey`, `clk2._domainkey` CNAMEs | Records exist. Confirm "Verified" in the Clerk prod dashboard |

HitPay, Sanity, ClickUp and Meta send from their own domains and are not
affected. Relaxed alignment (the DMARC default) is what lets the `send.` and
`clkmail.` subdomains count for `kedaipal.com`, so **never add `aspf=s` or
`adkim=s`** to the record.

### The DMARC record and its ramp

One TXT record at `_dmarc.kedaipal.com`. The `rua` address comes from
Cloudflare > Email > DMARC Management, which also renders the reports. It is
`d0a7adf19a4c49cb97e783450b4d469c@dmarc-reports.cloudflare.net` (public in
DNS anyway). Keep it unchanged when editing the policy, or reports stop.

**Status: Phase 1 live since 2 Nov 2026** (enabled through DMARC Management,
which published `v=DMARC1; p=none; rua=mailto:…`). Phase 2 is due ~5 Nov.
Edit the policy in DNS > Records, on the `_dmarc` TXT row.

| Phase | When | Record |
| --- | --- | --- |
| 1. Monitor | Day 0 | `v=DMARC1; p=none; rua=mailto:<cloudflare-rua>; fo=1` |
| 2. Quarantine | Day 3–4, once reports show only the three senders above passing | `v=DMARC1; p=quarantine; sp=quarantine; rua=mailto:<cloudflare-rua>; fo=1` |
| 3. Reject | ~Day 10, reports still clean | `v=DMARC1; p=reject; sp=reject; rua=mailto:<cloudflare-rua>; fo=1` |

Never jump to `reject` on day 0. An unverified legitimate sender is silently
dropped at `reject`, and if that sender is Clerk, sellers cannot sign in.
`sp=` covers spoofed `From: x@<anything>.kedaipal.com`. That is safe because
no subdomain is a From domain today: `send.` and `clkmail.` are return paths.

Check the live state:

```bash
dig +short TXT _dmarc.kedaipal.com
```

Some local resolvers filter TXT answers and return nothing. If `dig` is empty,
ask Cloudflare directly before concluding the record is missing:

```bash
curl -s -H 'accept: application/dns-json' 'https://cloudflare-dns.com/dns-query?name=_dmarc.kedaipal.com&type=TXT'
```

To verify a sender end to end, send one message to a Gmail inbox, open
**Show original**, and expect `SPF: PASS`, `DKIM: PASS` and `DMARC: PASS`.

### Adding a new sender — read this before it sends

**At `p=reject`, mail from a sender we have not authorised is dropped without
a bounce we will ever see.** A newsletter tool, a help-desk, a second Resend
domain, a form service: each must be authorised **before** its first send as
`@kedaipal.com`.

1. Publish the provider's DKIM record (its own selector) and confirm the
   provider shows it verified. DKIM is the one that matters, because it
   survives forwarding and mailing lists where SPF breaks.
2. Prefer a provider that uses its own return-path subdomain (like Resend's
   `send.`) over adding another `include:` to the root SPF. The root record
   must stay ONE `v=spf1` TXT under 10 DNS lookups.
3. Send a test to Gmail and read **Show original** as above.
4. Add a row to the sender table here in the same PR.
5. Watch the next DMARC report for the new source passing.

If a new sender must go live before its DNS verifies, send from the
provider's own domain instead of ours. Never relax the policy to make room.

## Patterns worth reusing

When adding a new retailer-facing alert (e.g. `paymentClaimed` — see `payment-handshake-roadmap.md`):

1. Add the new key to `RetailerEmailKey` in `convex/lib/emailCopy.ts`.
2. Add EN + MS copy entries returning `{ subject, html, text }`. Reuse `wrapHtml` and `escapeHtml`; a button is always `ctaButton` (see the layout rules below).
3. Either reuse `notifyRetailerOrderAlert` (if the trigger is order-status-derived) or add a sibling action with the same skip-conditions / swallow-errors structure.
4. Schedule via `ctx.scheduler.runAfter(0, internal.email.<action>, { ... })` from the originating mutation.
5. Add a test in `email.test.ts` mirroring the existing structure (filter `fetchMock.resendCalls()` by URL).

## Email layout rules — every email is read on a phone first (z8r3fdwfb7)

Every Kedaipal email renders through one of two shells: `wrapHtml`
(`convex/lib/emailCopy.ts`: order, team, credit, referral, handover,
payment-thanks, auto-renew) or `wrapBillingHtml` (`convex/lib/billingEmailCopy.ts`:
invoices, recovery, trial). Three rules hold for both, and for any template
added next to them:

1. **A card is fluid.** A table may keep a fixed `width="560"` attribute (that
   is what Outlook desktop, which ignores `max-width`, caps on), but its style
   must also say `width:100%`, which every phone and webmail client obeys.
   Before this rule, every `wrapHtml` email was 592px wide on a 375px phone:
   a sideways scroll on every order alert. The billing shell already did it
   right; `wrapHtml` now copies it.
2. **A long word wraps.** An email address, URL or account number is one
   unbreakable word. The card sets `overflow-wrap:anywhere;word-break:break-word`
   (inherited by everything inside) so it breaks instead of widening the card.
3. **A button is a tap target.** Every CTA comes from `ctaButton(href, label,
   { background, fontSize, fontWeight, radius })`: a fixed 20px line-height
   and 12px padding make it exactly 44px tall at any font size, the same
   ≥44px rule the app holds itself to. Pass the raw url and label, because
   it escapes both.

`convex/lib/emailLayout.test.ts` holds both shells to all three and scans
every `convex/lib/*Copy.ts` module: a fixed-width table without
`width:100%`, or a hand-written button-shaped `<a>`, fails the suite.

**Looking at an email** (the shells are plain strings, so there is no dev
server to open): render it to a file from a scratch vitest test, add
`<meta charset="utf-8">` (Resend sends the charset as a header, but a local
static server doesn't), serve the folder, and load it inside **375px-wide
iframes**. The browser extension's window resize is often ignored, so check
`document.documentElement.scrollWidth <= innerWidth` inside each frame.

## Known limitations

- **convex-test fake-timer noise.** Scheduled actions inside `vi.useFakeTimers()` log `Email retailer notify lookup failed: Transaction not started` on stderr. Same root cause as the WhatsApp scheduled-send noise (historically `notifyStatusChange`, now the confirmation push). Errors are swallowed; tests still pass. Not fixable without upstream convex-test changes.
- **No retry / dead-letter.** A 4xx from Resend (e.g. unverified domain) drops the alert with a Convex log. Acceptable at MVP scale; revisit if reliability bites.
- **Plain HTML, no React Email.** Two messages don't justify a templating dep. Reconsider when adding 5+ message types or when needing inline preview headers / dark-mode handling.

## Future work

- Add `paymentClaimed` retailer alert when the payment handshake ships (see `payment-handshake-roadmap.md`).
- Optional reminder cron — nudge retailer if `claimed > 24h` or shopper if `pending > 24h`.
- Optional in-dashboard toast / push as a third notification surface.
- Once the WhatsApp retailer side is solved (templates approved + business verification done), revisit whether to send WA + email in parallel for redundancy.
