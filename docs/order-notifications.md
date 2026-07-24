# Order alerts — browser notifications with sound (per device)

Shipped Jul 2026 alongside the Lalamove release (ClickUp `86eyb5hrf` polish
round). The seller's ask: know the moment an order lands without flooding
WhatsApp — a chime + system notification on whatever device has the
dashboard open.

## How it works

- `convex/notifications.ts` `latestActivity` — one tiny owner-or-admin query:
  newest order stamp + newest FAILED delivery booking (last-10-jobs window).
  **Convex reactivity is the push channel** — no polling, no service worker.
- `src/hooks/useOrderNotifications.tsx` — `OrderNotificationsBridge`, mounted
  once in the authed app shell. The first sample after (re)subscribe is a
  BASELINE (page loads never chime for existing orders); later increases
  raise: WebAudio two-tone chime (no asset), a system `Notification`
  (`tag`-collapsed, click focuses + navigates to the order), a 6s tab-title
  flash, and an in-app toast fallback.
- Events: **new order** and **rider booking failed** (money-relevant only —
  deliberately not every status change).
- Preferences are **per device** (`localStorage`): master switch + sound.
  The master switch also gates the Convex subscription, so disabled devices
  hold no extra subscription.

## Settings surface (discoverability)

Settings → Store → **"Order alerts on this device"** card
(`src/components/settings/notifications-card.tsx`). Every permission state
has a next step:
- unsupported browser (iOS Safari non-PWA) → explains Add-to-Home-Screen /
  desktop Chrome;
- `default` → "Turn on order alerts" (permission prompt + test alert);
- `denied` → concrete unblock steps (lock icon → Site settings →
  Notifications → Allow, + Android Chrome path);
- `granted` → Turn off / Sound on-off / Send a test.

## Deliberate limits

Alerts require a Kedaipal tab open somewhere (foreground or background).
True closed-browser Web Push (service worker + subscriptions + VAPID) is the
existing roadmap item **"PWA + Push" (S4)** — the card's footnote tells
sellers that upgrade is coming, so today's behavior never reads as broken.
