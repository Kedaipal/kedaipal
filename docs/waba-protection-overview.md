# WhatsApp Number Safety — Overview & Decisions

> **Who this is for:** anyone — no code knowledge needed. It explains what we
> built, how to use it, and what we decided (and why). Engineers: the technical
> reference is [`docs/waba-protection.md`](./waba-protection.md).
> **Status:** built and on the dev environment (June 2026). Not yet released to
> production.

---

## In one paragraph

Kedaipal sends every shop's WhatsApp messages through **one shared WhatsApp
number**. That's a big advantage (shops don't need their own Meta setup), but it's
also a shared risk: one shop spamming people can get **the whole number** flagged
or banned by Meta — taking down messaging for *every* shop. We built a safety
system that sits in front of that number: an emergency **pause switch** for any
single shop, automatic **speed limits**, a **do-not-message list**, and a
**reputation alarm** — all while guaranteeing real customers never miss an order
update.

## Why we did this (the risk)

Think of our one WhatsApp number as **a single postman delivering for 100 shops**.
If one shop floods him with junk and people complain, the post office (Meta)
punishes *the postman* — and now none of the 100 shops can deliver. One bad shop,
everyone suffers. This system is the mailroom checkpoint that inspects messages
before the postman takes them.

## What we built (the protections)

- **Kill switch** — instantly pause one misbehaving shop's marketing messages,
  without touching the other shops and without stopping that shop's customer order
  updates. (One-click in the admin tool — see below.)
- **Speed limits** — each shop can only send so many messages per day and per
  5 minutes, so a bug or over-eagerness can't flood the number. Brand-new shops
  get the tightest limit (their first 30 days), bigger plans get more.
- **Do-not-message list** — if a customer replies **STOP** to any shop, we stop
  sending them marketing from *every* shop on our number, until they reply START.
  (They still get updates for an order they're actively waiting on.)
- **Reputation alarm** — Meta grades our number's reputation. If it drops, we
  automatically pause the non-essential messages everywhere to let it recover, and
  email us.
- **Receipts** — every message attempt is recorded (who, to whom, sent or
  blocked and why), so problems are easy to spot.

**The golden rule:** *order messages* ("confirmed," "packed," "on the way") are
**never** blocked by any of this — a paying customer always gets their order
updates. The safety system only ever holds back *marketing / non-essential* messages.

## How to pause or un-pause a shop (the admin tool)

There's an admin page: **dashboard → sidebar → "WABA Safety"** (only visible to
admins).

1. Search for the shop by name.
2. Each shop shows **Active** (green) or **Paused** (red, with the reason).
3. Click **Pause** → a confirmation box appears. **You must type a reason** (so
   it's never an accidental click, and the reason is logged). Confirm.
4. The shop is paused immediately; they see a banner in *their* dashboard
   explaining their marketing is paused but order messages still work.
5. To undo, click **Resume** → confirm.

> It's a **deliberate, manual** action — *not* automatic. See the decision below.

## Reading the shop cards (the stats)

Each shop card shows three small numbers for the **last 30 days** (no Meta setup
needed — these come from our own records):

- **Sent** — how many messages went out (context).
- **Blocked** — how many we held back. Turns **amber** when above zero.
- **Opt-outs** — how many customers replied STOP because of this shop. Turns
  **amber** when above zero.

At a glance: a shop with amber numbers is the one to look at. *(Note: until the
marketing/broadcast feature exists, "sent" mostly just mirrors order volume and
"blocked" will sit near zero — these become more meaningful once shops can send
broadcasts.)*

## What we deliberately did NOT build yet (and why)

The original safety ticket was large and partly designed for a **marketing
broadcast feature that doesn't exist yet**. We built everything useful *now* and
parked the rest where it belongs, so we don't write guesswork code:

- **A fancy admin dashboard, "act-as a shop," spam auto-detection, gradual-ramp
  guides** → moved to the **Admin Console** and **Broadcast** tickets. They can't
  be properly tested until those features exist.
- **Out-of-24-hour message templates** (a narrow case where a status update sent
  more than a day later can fail) → parked; only affects advance orders (e.g. a
  cake ordered a week ahead) and needs Meta to approve message templates first.

## Decisions log (what we chose, and why)

| Decision | What we chose | Why |
|---|---|---|
| How much of the safety ticket to build now | The "real-now core" only; relocate the rest | The rest protects a Broadcast feature that doesn't exist — building it now would be guesswork that gets redone |
| Should order messages ever be blocked? | **No, never** — they bypass all safety checks | Blocking an order update punishes an innocent paying customer; safety should only police marketing |
| Pause a bad shop automatically or manually? | **Manual** (a human clicks pause) | Auto-pausing on a false alarm would freeze a legitimate, paying business for no reason. The *global* reputation alarm is automatic; pausing *one shop* stays a human decision |
| Build the kill switch as a UI or command-line? | **UI** (admin tool with confirmation) | So non-developers (e.g. the boss) can use it safely in one click |
| What stats to show per shop | Sent, Blocked, Opt-outs (last 30 days) | High-signal, need no Meta setup, and stay clean as shop count grows |
| Out-of-window message templates | **Defer** | Narrow (advance orders only), not a launch blocker, and depends on Meta approving templates |
| Secure tracking links (item from the original list) | Already done earlier | Tracking links already use an unguessable code, not a guessable order number |
| Force HTTPS / fix "Not Secure" | A Cloudflare setting, not code | It's a hosting-dashboard toggle |

## Still to do (action items)

- [ ] **Subscribe two Meta webhook fields** so the reputation alarm receives data
  (`phone_number_quality_update`, `account_update`) — done by whoever owns the
  Meta account. Until then the alarm is dormant (everything else works).
- [ ] **Give the boss admin access** — add his login ID to the admin list
  (`ADMIN_USER_IDS`) so the "WABA Safety" tool appears for him.
- [ ] **Force HTTPS** — enable "Always Use HTTPS" + HSTS in Cloudflare (ticket
  `86exrgrhn`).
- [ ] *(Later)* Move the relocated items into the Admin Console (`86ey25er1`) and a
  Broadcast ticket.
- [ ] *(Later)* Submit Utility message templates to Meta for the out-of-window
  ticket (`86ey1fgjw`).
- [ ] *(Later, scaling)* Switch the per-shop stats to pre-computed counters before
  we have hundreds of high-volume shops.

## The tickets

| Ticket | What it is | Where it stands |
|---|---|---|
| [`86expmgep`](https://app.clickup.com/t/86expmgep) | WABA Protection & Kill Switch | **Real-now core built** (this work); Broadcast/admin parts relocated |
| [`86ey25er1`](https://app.clickup.com/t/86ey25er1) | Admin Console | First slice (the WABA Safety tab) built; rest open |
| [`86ey1fggw`](https://app.clickup.com/t/86ey1fggw) | Secure tracking links | Already done in code; verify + close |
| [`86ey1fgjw`](https://app.clickup.com/t/86ey1fgjw) | Out-of-window templates | Parked (not a blocker) |
| [`86exrgrhn`](https://app.clickup.com/t/86exrgrhn) | Force HTTP → HTTPS | Cloudflare dashboard setting |

---
*Engineering reference (schema, function names, tests): [`docs/waba-protection.md`](./waba-protection.md).*
