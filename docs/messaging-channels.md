# Messaging Channels — Adapter Architecture Reference

Reference doc for the channel-agnostic messaging seam. **Phase 1–3 implemented and shipped; Phases 4–6 deferred (see below).**

## Context (2026-05-25)

WhatsApp is the wedge, but the long-term vision is omnichannel (Telegram, WeChat, and marketplace connectors). Before this change, WhatsApp/Meta was hardcoded across three layers — outbound transport (`graph.facebook.com` payloads called by name), the inbound webhook (Meta-shaped payload parsing + `X-Hub-Signature-256`), and customer identity (`customers` keyed by `waPhone`). Adding a second channel would have meant editing the order orchestration itself.

This change introduces a **`ChannelAdapter` seam** so WhatsApp becomes one of N channels behind a uniform interface, **with zero behavior change**. Adding Telegram/WeChat later means writing an adapter + registering it — the order flow in `convex/whatsapp.ts` does not change.

## What got built (Phases 1–3 — pure refactor)

A normalized messaging contract plus a delegating WhatsApp adapter. The orchestrator now emits *intent* (`send this CTA`) and the adapter decides how to render it on its provider.

### Files

| Path | Purpose |
|---|---|
| `convex/lib/channels/types.ts` | The contract: `Channel` union (`"whatsapp" \| "telegram" \| "wechat"`), normalized `OutboundMessage` (text / image / cta), `InboundEnvelope` (with reserved `callbackData` for future button-driven channels), `ChannelCapabilities`, and the `ChannelAdapter` interface. No Convex imports — edge-runtime safe. |
| `convex/lib/channels/whatsapp/adapter.ts` | The WhatsApp adapter. **Thin delegation** to existing `lib/whatsapp.ts` (send), `lib/whatsappWebhook.ts` (parse), `lib/whatsappSignature.ts` (verify) — no wire logic reimplemented. Owns the CTA→image/text degrade. |
| `convex/lib/channels/registry.ts` | `getAdapter(channel)` — the single Channel→adapter map. Only `whatsapp` wired; throws on an unregistered channel. |
| `convex/whatsapp.ts` | `handleInbound`, `notifyStatusChange`, `notifyPaymentReceived`, and the diagnostic now emit normalized messages via `getAdapter("whatsapp").send(...)`. |
| `convex/http.ts` | Webhook POST routes through `adapter.verifySignature(...)` + `adapter.parseInbound(...)`. |
| `convex/lib/channels/whatsapp/adapter.test.ts` | Unit tests: union→Meta-payload mapping, the full CTA degrade matrix, inbound parsing, signature verification. |

### The `OutboundMessage` contract

```ts
type OutboundMessage =
  | { kind: "text"; body: string }
  | { kind: "image"; imageUrl: string; caption?: string }
  | { kind: "document"; documentUrl: string; filename?: string; caption?: string }
  | { kind: "cta"; body: string; buttonText: string; url: string; imageUrl?: string };
```

The adapter's `send(to, msg)` maps these to provider payloads. Provider quirks live *inside* the adapter, never in the orchestrator.

`document` (added `86ey4fz3w`) sends a file attachment hosted at a public URL the provider fetches — used to push a receipt/invoice PDF to the buyer's WhatsApp from the counter Done screen. The WhatsApp adapter maps it to a `type: "document"` message with `{ link, filename?, caption? }` (`sendDocument` in `convex/lib/whatsapp.ts`). The caller (`orders.sendOrderDocumentToBuyer`) is responsible for hosting the file (Convex storage → `getUrl`) and reclaiming it after.

### CTA button URL resolution + degrade (`ctaButtonUrl`)

`ctaButtonUrl(url)` returns the URL an interactive button should point at, or `null` to degrade to a plain image/text:

1. `capabilities.ctaButtons` must be true (the channel supports CTA buttons), **and**
2. **HTTPS** → passes through (Meta accepts it — the production path).
3. **LOCAL `http://`** (localhost / loopback / `10.` / `192.168.` / `172.16–31.` / `[::1]`) → **dev affordance**: upgraded to `https://` so Meta renders the button. Meta rejects non-HTTPS CTA URLs and local dev runs `APP_URL=http://localhost`, so without this the button would never be visible while developing. The message *body* keeps the original `http` link (loads on the dev machine); the button's `https` URL won't resolve as-is, so the developer edits the scheme by hand when tapping. Scoped to local origins so a real **public** production domain can never be silently rewritten.
4. any other **non-HTTPS** URL → `null` (degrade) — a misconfigured public `http://` prod URL stays safe.

When degraded, a `cta` falls back to an image-with-caption (if `imageUrl` is set) or plain text. Today's only `cta` caller (the order-confirm reply) always supplies `imageUrl`, so the paths are: HTTPS (or local-http-upgraded)→`sendCtaUrlWithImage`, public-non-HTTPS→`sendImage`.

## Behavior fidelity

The refactor is behavior-preserving. The **one intentional delta**: the webhook's old `400`-on-bad-JSON became `200 + console.error` — a correctly-signed Meta body is always valid JSON, so a malformed signed body is now acked + logged rather than triggering a Meta retry. The `500` (missing `WHATSAPP_APP_SECRET`) / `401` (bad signature) / `200` contract is otherwise preserved exactly. See [`whatsapp-webhook-security.md`](./whatsapp-webhook-security.md).

All 214 pre-existing tests pass unchanged (the acceptance gate for a pure refactor).

## Adding a new channel (the payoff)

1. Implement `ChannelAdapter` in `convex/lib/channels/<channel>/adapter.ts` — `send`, `parseInbound`, `verifySignature`, `capabilities`. Stay in the default Convex runtime (fetch + Web Crypto) so it works inside edge `httpAction`s.
2. Register it in `convex/lib/channels/registry.ts`.
3. Add the inbound webhook route in `convex/http.ts` (each provider's verify handshake differs — do **not** force the Meta `hub.challenge` GET into a shared `:channel` route).
4. Complete the identity migration below so the channel's users get first-class customer records.

No changes to `confirmOrderFromWhatsApp`, the ORD-XXXX matching, or the reply rendering — they are already channel-neutral.

## Deferred — Phases 4–6 (customer identity migration)

Multi-channel is currently **out of scope** on the roadmap, so the data-layer generalization was deliberately *not* done. Today `customers` is still keyed by `(retailerId, waPhone)`. When a second channel is greenlit, generalize to `(retailerId, channel, channelUserId)` via Convex's expand/migrate/contract sequence (additive optional fields → batched backfill cloned from `backfillCustomers` → switch reads → contract), and widen the `channel` literal unions on `retailers`/`orders`/`products`. Each step is a separate green deploy; never combine "add required field" with absent data, or "remove field" with populated data.

### Known channel-specific bits to generalize in Phase 5+

- `assertValidWaPhone` (`convex/lib/slug.ts`) — phone validation; a Telegram user id is not a phone. Route identity validation through the adapter.
- `getDisplayName` / `formatPhone` (`convex/lib/customer.ts` + mirrored `src/lib/customer.ts`) — assume a WhatsApp phone.
- `contactLine` in `convex/lib/whatsappCopy.ts` — hardcoded `wa.me/{phone}` deep link.
- `WHATSAPP_CHECKOUT_PHONE` (`convex/retailers.ts`) — the WhatsApp checkout entry point.
