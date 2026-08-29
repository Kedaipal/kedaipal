# Kedaipal — WhatsApp-First Order Hub

See full project context: [`./PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md)

## Quick Summary

**Kedaipal** ("kedai" + "pal") — B2B SaaS order hub for serious WhatsApp sellers in Malaysia. WhatsApp is the wedge; long-term vision is omnichannel (Shopee, Lazada, TikTok Shop, StoreHub).

**Target cohort (feature-grounded, updated Jul 2026):** Made-to-order or multi-outlet sellers doing 20+ orders/week who **close + collect payment by hand in WhatsApp** and sell **online + at physical points** (counter/stalls/pickup). F&B is the richest instance — cake decorators, kuih/pastry pre-order, frozen **direct multi-outlet** sellers — but both paying customers matched the _pattern_, not the food category (Bearcamp = tent-wash service, Lekor Mr Ganu = multi-stall keropok-lekor SME). Frozen **reseller/wholesale networks** are NOT the ICP: the tiered-pricing/reseller-portal features that thesis needs are unbuilt and no payer has needed them. Outdoor gear was the original beachhead. See `PROJECT_CONTEXT.md` + `01_Strategy/ICP_Feature_Grounded_20260701.md` (Documents workspace).

**Universal pain × universal TAM:**

1. _"I'm missing orders buried in WhatsApp chat history."_
2. _"I'm chasing customers for payment confirmation."_

- Storefront: `kedaipal.com/<retailer-slug>` (no shopper auth)
- Dashboard: Clerk-protected
- Catalog: hosted in Convex (NOT Meta Commerce Catalog)
- Flow: WhatsApp → CTA URL button → web storefront → cart → `wa.me` deep link with `ORD-XXXX` → Convex confirms

## How we decide — "what would a CTO do?"

The product owner is the **CTO / sole dev**; decisions we make together should pass a CTO's bar, not just "does it work." When designing or reviewing any change:

- **Think end-to-end about the human in the flow.** A feature isn't done when the happy path works — it's done when the seller and the buyer are _eased through_ it: clear copy, sensible defaults, no dead ends, no states that silently confuse. When a backend change opens a new state, ask "what does each side now see, and is it obvious what to do next?" and patch the UI/UX, emails, and bot replies to match.
- **Make every feature discoverable — no hidden behavior.** We exist to make the vendor's and buyer's life _easier_, not to add behavior they have to stumble onto. Every feature, setting, and rule (a TTL/expiry, a configurable limit, an auto-action, a new tab, a constraint like "buyers can't pick a date sooner than N days") must be **surfaced in-product to whichever side it affects** — a one-line helper/subtitle, an empty-state hint, a tooltip, or inline copy — so they know it exists and how to use it. If a behavior would make someone wonder "wait, where did that go?" or "why can't I…?", that's a missing piece of UI, not acceptable. This applies to **every** future feature; when you build one, name where the user is told about it. Don't make the CTO point out that a feature is invisible.
- **Polish proportional to impact** — not every feature needs to be gold-plated, but every feature should at least cover the obvious UX easements (a disabled-with-reason button beats a wrong-but-enabled one; a one-line "here's what happens next" beats silence).
- **Decisions are decisions.** A call made here is a decision to build on, production-grade and for the long run — not a demo or a stopgap awaiting sign-off. Surface trade-offs and flag follow-ups proactively (think ahead), but don't stall.
- **Always ship code + tests + docs together** as the baseline (see existing memory). Tests prove the easement holds; docs keep the next person oriented.
- **No lazy / convenient placement — own the structure.** Never park a feature wherever code already happens to exist, append a new option to the end of a list, or reuse the nearest tab/section just because it's less work. Decide _where_ something belongs (information architecture, tab/section, list position, naming) by **meaning and urgency**, and proactively restructure when the right home doesn't exist yet (e.g. a new settings tab). The CTO should not have to point out that an order-flow setting doesn't belong under "WhatsApp", or that an urgent filter shouldn't sit last — get it right the first time and state the reasoning. When you touch adjacent lazy patterns (hardcoded duplicates, stale copy), fix them in passing rather than matching them.

## Ship grade-A UI the FIRST time — no "we'll polish it later"

**Standing rule, every UI change, no exceptions.** A UI that merely works is not
done. Shipping functional-but-unconsidered UI and waiting for the CTO to say
"that's ugly" has happened repeatedly (the inbox toolbar, the filter dialog, the
column picker) and each time cost a second round that should never have existed.
**The design pass happens before it is called done, not after someone complains.**

- **Look at it.** [`docs/design-system.md`](./docs/design-system.md) already says
  Tailwind written blind is a guess — render it and *see* it. If a surface is
  behind Clerk and can't be reached, build a harness or inject the real classes
  into a running page. "I couldn't see it" is not a reason to ship it unseen.
- **Design the states, not just the happy path.** Empty, loading, one item, too
  many items, zero results, error, disabled-with-reason. A feature that only
  looks right with three rows of ideal data is half-built.
- **Bulk affordances are part of the design, not an enhancement.** Any list of
  more than ~5 tickable things needs select-all / clear, and per-group controls
  wherever the list has groups. Making someone click 22 checkboxes by hand is a
  design failure, not a missing feature request.
- **A parent that summarises children is TRI-STATE.** All / none / some — with a
  real indeterminate mark and `aria-checked="mixed"`. A parent box that reads
  unchecked while 3 of 7 children are on is telling the user something false.
- **One idea, one control.** If two surfaces express the same concept, they use
  the same component. Chips in one panel and checkbox rows in another for the
  identical filter is how an app starts looking like two apps.
- **Actions carry their consequence.** "Reset" doesn't say what it undoes;
  "Clear all (3)" does. "Done" doesn't say what happens; "Show 6 orders" does.
  Panels state what is currently on, at the top, removable in place.
- **A constraint is surfaced, never enforced silently.** If the last column
  can't be hidden, say so where the seller is clicking — don't just make the
  click do nothing.
- **Match the house.** Reach for `src/components/ui/` primitives before writing
  markup; semantic tokens, never raw colors; ≥44px touch targets; the mobile
  layout is designed, not inherited.

If a change genuinely warrants mockups (a new surface, a redesign), produce them
and ask — that is not slowing down, it is the cheaper half of the loop.

## Definition of Done — ship PR-ready, every time

Every change must land in a state that would **pass PR review on the first read**, so review becomes a rubber-stamp, not a rework loop. Before calling anything done, it must clear this bar — no "I'll clean it up later":

- **Verify the ticket against reality first.** Tickets may be stale or AI-drafted against assumptions that no longer hold. Audit the actual schema/code before coding (does the table/field/function already exist? does the proposed change collide with live code?), and reconcile the plan to what's really there — don't build what the ticket says if the codebase says otherwise. Flag the divergence.
- **Code + tests + docs in the same change** (existing baseline). Tests cover the happy path _and_ the failure/edge states the change introduces; docs (`docs/*.md` + any CLAUDE.md status line) keep the next person oriented.
- **Green gates:** typecheck, lint, and the full test suite pass locally before it's "done" (run `/ship` or the equivalent). No new warnings introduced. No `any`/`@ts-ignore`/dead code/commented-out blocks/stray `console.log` left behind.
- **End-to-end human flow covered** (per "How we decide"): every new state has UI/copy/email/bot-reply on both sides, sensible defaults, disabled-with-reason over wrong-but-enabled, and the feature is discoverable where it's used.
- **UI changes clear the grade-A bar above** before "done" — states designed,
  bulk affordances present, controls consistent with the rest of the app, and
  actually looked at. A UI round-trip because it shipped unconsidered is a
  failed Definition of Done, not normal iteration.
- **Self-review the diff** as a reviewer would: naming and structure match surrounding code, no scope creep, no unrelated churn, migrations are safe (widen→migrate→narrow), secrets/prod untouched. If something is a deliberate trade-off or a follow-up, **call it out in the summary** rather than leaving it for review to catch.
- **Branch from `staging`, never `main`.** Every new branch/worktree bases on `origin/staging` (fetch it first — e.g. `git worktree add -b <branch> <path> origin/staging`). `main` is downstream of `staging`; branching off `main` also leaves the branch tracking `origin/main`, so a bare `git push` can land on main. After the first push, confirm the upstream tracks the **feature branch**, not `origin/main`/`origin/staging`. Never push directly to `main` or `staging`.
- **Convex specifics:** new validators/indexes are correct and used; reads stay on indexes (no full scans on hot paths); schema changes follow the dev-only, migration-safe path.

The goal: when a change is handed over, the reviewer finds nothing to send back. If a gap is unavoidable, name it up front — don't make review discover it.

## WhatsApp Model — Shared WABA (permanent)

Kedaipal owns **one Meta-verified WhatsApp Business Account** that handles outbound messaging for every retailer. Retailers do NOT need their own WABA, business verification, or SSM registration. Retailer brand surfaces via `{store_name}` in message content; sender number is Kedaipal's.

**Implication:** "No Meta verification needed — live in 5 minutes" is the structural moat vs. WATI / SleekFlow / EasyStore / Orderla. WABA quality is a shared resource — protections (kill switch, per-seller caps, opt-out, quality auto-throttle) shipped as the [`WABA Protection`](https://app.clickup.com/t/86expmgep) real-now core; see [`docs/waba-protection.md`](./docs/waba-protection.md).

Pricing, business model, and founder/entity details: see [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md#business-model).

## Tech Stack

- **Messaging:** WhatsApp Cloud API direct (no BSP). Production WABA verified Apr 2026.
- **Backend/DB:** Convex (functions, HTTP actions for webhooks, scheduled jobs)
- **Frontend:** TanStack Start (React + Router/Query) + Tailwind, **mobile-first hard requirement**. Convex reads flow through the **`@convex-dev/react-query`** adapter (`useQuery(convexQuery(...))`) so results are cached in TanStack Query across navigation — see [`docs/frontend-caching.md`](./docs/frontend-caching.md); mutations/actions/pagination stay on native `convex/react`.
- **Auth:** Clerk (retailer dashboard only)
- **Hosting:** Cloudflare Workers/Pages + Convex Cloud
- **Payments:**
  - **Subscription billing (retailers → Kedaipal):** manual v1 live; Stripe + HitPay pay-links planned
  - **Customer payments (shoppers → retailers):** **HitPay v1 shipped** (`86eyb6z3a` — BYO seller accounts, buyer Pay-now + webhook auto-confirm; see [`docs/hitpay-gateway.md`](./docs/hitpay-gateway.md)); platform/OAuth layer + any Billplz/Stripe Connect fallback deferred. Kedaipal never touches order money

## MVP Status (shipped Apr 2026)

1. Hosted storefront at `/<slug>` — browse, cart ✅
2. WhatsApp bot CTA URL button entry ✅
3. Cart → `wa.me` handoff with order ID ✅
4. Convex parses order, confirms in chat ✅
5. Automated status updates (confirmed/packed/shipped/delivered) ✅
6. Retailer dashboard (products, inventory, orders, settings — live via Convex) ✅
7. Customer tracking page with "I've paid" flow + manual payment claim ✅

## Recently Shipped (post-MVP)

- **Order workspace depth — complete exports, a desktop table view, item thumbnails, pinned orders** ✅ (ClickUp `86eyrtz74`, dev) — four Hermoolah items shipped as one story: the inbox wasn't a place a seller could live in, so they exported to Excel. **`convex/lib/orderCsv.ts` is now a COLUMN REGISTRY** (36 entries: key, label, group, width, accessor) driving BOTH the CSV and the new table — two lists would drift on the first addition, and "the table replaces the export" is only true if they can't. Closed the reported gaps (the export had **no destination column at all**, delivery or self-collect) plus an arithmetic hole the file already admitted: the mockup quote folds into `total` with no column, so `Subtotal + Pickup fee + Delivery fee` silently failed to reconcile on every made-to-order order; the money run is now adjacent and a test pins it. `Categories (current)` is a deliberate **live lookup** (categories are never frozen onto an order line); `trackingToken` is excluded and a test enforces it. **Table view is desktop-only, gated in JS** (`useIsDesktop`) not just CSS, or a shared `?view=table` link hands a phone 36 columns; columns persist per store in localStorage; export becomes a two-item menu (visible / all columns), never a dialog. **Pinning** (`orders.pinnedAt`) has three owner rules: **never auto-unpin**, **a pin outranks the filter** while the Pinned chip is on (sellers pin to compare against a filtered view), and **pinned-first is a partition, not a sort option**. All-tier. The **product export** gained the same treatment — 13 report columns (categories, storefront state, stock policy, reserved, photos, order rules) after the 11 unchanged import-template ones; the import ignores them, so `exportOnlyColumnsPresent()` makes the import screen say which edits won't apply rather than no-op'ing silently. See [`docs/order-inbox.md`](./docs/order-inbox.md) + [`docs/bulk-product-upload-roadmap.md`](./docs/bulk-product-upload-roadmap.md).
- **Storefront source attribution — `?src=` finally consumed, "orders from TikTok" in Insights** ✅ (ClickUp `86eyq0eq9`, dev) — the TikTok Live measurement layer: `?src=`/`utm_source` on any of the four buyer routes persists per-store in sessionStorage for the session (last-touch: a later tagged hit overwrites, untagged navigation never clears) and checkout stamps it as **`orders.attributionSource`** (optional string, no index — the `orders.source` posture; absence = direct, so nothing backfills). One pure shared module **`convex/lib/attribution.ts`** owns sanitize (lowercase, `[a-z0-9_-]`, cap 32; absent/blank → unset, **present-but-garbage → `"other"`** — a tampered tag must not masquerade as direct, and a bad tag never blocks checkout), labels, presets and `attributionBucket` (stamped tag → `counter` → `direct`). **Counter-checkout orders are never stamped** — their bucket derives from the existing `orders.source`, so the Counter row costs zero writes. **Free-form tags allowed** (`?src=raya-promo` renders verbatim; known tags get pretty labels — TikTok, Poster QR = `online`, Parcel label QR = `awb` (the despatch-label emitter the ticket missed, now counted for free), reserved `tiktok-live` for claim links `86eyq0epn`). Report = **`sources` on both insights queries** (bucketed over EARNED revenue so Σ rows === the earned KPI, riding the existing bounded scan + Pro gate; capture stays all-tier so a Starter's history is complete on upgrade day) → `SourceBreakdown` bar list beside the payment donut, whose all-direct state IS the discoverability surface (names the `?src=` mechanic, links the poster). Sellers **filter the inbox by origin** ("Came from" multi-select — a separate dimension from the existing Online/Counter "Order type"; chips come from `searchOrders.availableSources`, tallied over the FULL window so filtering one origin never shrinks the picker, ties broken alphabetically so it can't reshuffle; `?asrc=` in the URL; CSV export honours it via the shared predicate), and **every Insights source row drills into that filtered inbox** in one tap. Tagged links are built in **exactly one place — the Home store-link card** (`tagged-share-links.tsx`, a 4-up grid of brand-glyph tiles — CC0 Simple Icons marks inlined in `brand-icons.tsx` rather than adding a dep, decorative since each button already names itself, brand hex hardcoded because external identities must not drift with our theme; the pressed tile turns into a tick so confirmation lands under the thumb — one-tap copy of `?src=tiktok|instagram|facebook|whatsapp` from the shared `SHARE_TAG_PRESETS`, stamping the same `linkSharedAt` share signal, all-tier like capture). **Deliberately NOT on any QR surface** (owner call, Arif, 26 Aug): a campaign-tagged poster QR was built and reverted — a printed sheet outlives the campaign that produced it, so it would misattribute every later scan; the poster keeps its fixed `?src=counter`/`?src=online` and `StorefrontQrDialog` is untouched, both byte-identical to before. A QR scan is therefore always attributable to the SURFACE (poster / parcel label / counter), never a campaign. `storefront_badge` deliberately stays out (it tags kedaipal.com — Kedaipal's own CAC, `86eye3eyp`); GA/Clarity + the `/track/*` carve-out untouched. See [`docs/source-attribution.md`](./docs/source-attribution.md).
The full chronological record — what shipped, why it was built that way, what was deliberately rejected, and which trap was found — lives in **[`docs/shipped-log.md`](./docs/shipped-log.md)** (62 entries, newest first). Feature-level reference detail lives in the `docs/*.md` each entry links; [`docs/README.md`](./docs/README.md) is the index.

**Maintenance rule — this section stays a pointer.** Shipped-feature detail goes in `docs/`: the feature's own doc for reference material, `docs/shipped-log.md` for the release record, both written in the same PR as the feature. CLAUDE.md carries **rules and pointers only**. This section was 147 KB — **91% of the file**, ~40k tokens loaded into every session while carrying none of the rules — before it was moved out (ClickUp `86eyqh89n`). It grew to that size one reasonable-looking bullet at a time, so the rule matters more than the cleanup did.

## Active Roadmap (17 tasks, 6 sprints, May 25 → Aug 16, 2026)

Tracked in [ClickUp Product Roadmap](https://app.clickup.com/90182681518/v/li/901818308046). High-level:

- **S1–S3 (revenue plumbing):** Customer DB, Order Inbox, Date Picker, Subscription Billing, Legal Pack, Landing+Pricing Rewrite, Setup Wizard, White-Glove Scheduler, PostHog → **first paid customer by Jul 5**
- **S4 (WhatsApp depth):** WABA Protection, Automated Reminders Cron, PWA + Push
- **S5 (growth surface):** Customer Payment Gateway, "Graduate from Orderla" landing + CSV import
- **S6 (acquisition on):** Broadcast, Targeted Ads (validation-first budget)

**Status (12 Jun 2026):** Of S1–S3, done = Customer DB, Legal Pack, Landing+Pricing rewrite, Setup Wizard. **Subscription billing v1 slipped to ~Jun 30** — 7 subtasks under `86expn2qg`, all to-do, Zaki. Still open: Order Inbox (`86expm4xx`). **Date Picker (`86expm524`) — done** (lean version; see [`docs/shipped-log.md`](./docs/shipped-log.md)). In progress: Multiple payment methods (banks + QR, `86extzdpk`); in review: bulk product import rework for variants (`86exu482j`).

## Architectural Constraints

- Schema must treat WhatsApp as one `channel` — leave room for marketplace connectors post-MVP
- **Messaging goes through the `ChannelAdapter` seam** (`convex/lib/channels/`): orchestration emits normalized `OutboundMessage`/`InboundEnvelope` via `getAdapter(channel)`; provider-specific wire logic (Meta payloads, signature scheme) lives inside the adapter. Add a channel = new adapter + registry entry + webhook route, no order-flow changes. See [`docs/messaging-channels.md`](./docs/messaging-channels.md).
- Mobile-first: ≥44px tap targets, single-column, sticky CTAs, bottom-anchored actions. **The house visual language (tokens, primitives, mobile rules, render→look→iterate loop) lives in [`docs/design-system.md`](./docs/design-system.md) — read it before building or changing UI.**
- **Every colour is either a semantic token or carries a `dark:` pair.** The seller app and the buyer storefront both render dark (`/app/*` + the buyer routes; the marketing site is deliberately always-light). Semantic tokens flip for free — reach for them first. A raw palette colour (`bg-amber-50`, `text-emerald-800`) needs its `dark:` twin on the same element, a status pill or notice card goes through [`src/lib/tone.ts`](./src/lib/tone.ts), and anything deliberately theme-invariant (QR plate, brand logo, print surface) says `dark-ok` in a comment **with the reason**. **Machine-enforced** by `src/lib/dark-mode-coverage.test.ts` in the gate, so this is not a rule you have to remember. Theme state lives in `localStorage`, never Convex — it is per-device. See [`docs/dark-mode.md`](./docs/dark-mode.md).
- **Every NEW frontend Convex read uses the TanStack Query adapter — never plain `useQuery` from `convex/react`.** The pattern: `useQuery(convexQuery(api.x, cond ? args : "skip")).data` (import `useQuery` from `@tanstack/react-query`, `convexQuery` from `@convex-dev/react-query`; `"skip"` stays verbatim inside `convexQuery` — never hoist to `enabled:`; unwrap into a named `.data` var so `undefined`=loading/`null`=not-found checks and `typeof`-derived types keep working). Component tests mock the adapter pair, not `convex/react` (see `billing-tab.test.tsx`). **Exceptions that stay on `convex/react`:** `useMutation`/`useAction`/`useConvex`, and `usePaginatedQuery` (no adapter wrapper). Full pattern + rationale: [`docs/frontend-caching.md`](./docs/frontend-caching.md). This rule exists so re-navigation stays instant and no future read-caching refactor is ever needed. **Machine-enforced** by `src/lib/convex-read-pattern.test.ts` in the gate — it scans `src/**` and fails on the banned import, so this is no longer a rule you have to remember. Note the scope: it binds **frontend read call sites in `src/`**, not Convex functions (which know nothing about TanStack).
- **SSR is for buyer surfaces, not the dashboard.** Buyer-facing, unauthenticated, first-paint-critical routes (`/$slug`, `/$slug/p/*`, `/$slug/c/*`, `/track/*`) should SSR their data and **hydrate the client cache** from the loader payload; authenticated `/app` routes stay client-cached. Two reasons this is a rule and not a preference: (1) buyers arrive cold from a WhatsApp link on mobile data and those pages carry the SEO, whereas `/app` is Clerk-gated with no SEO and a repeat visitor whose cache is already warm — SSR there means Clerk + Convex auth on the Worker per request for ~zero gain; (2) the `QueryClient` in `src/lib/convex.ts` is a **module singleton**, safe *only* because nothing fetches Convex during SSR today — enabling SSR data-fetching without moving to a **per-request** client can leak one visitor's data into another's response. SSR is a first-paint layer *under* the reactive subscription, never a replacement (Convex reactivity is a client WebSocket). Buyer loaders today already fetch and then discard the payload while the client re-fetches it — closing that double-fetch is [ClickUp `86eydh4vd`](https://app.clickup.com/t/86eydh4vd).
- Multi-tenant via slugs from day one
- **All outbound messages flow through the `wabaProtection.canSend()` gateway** (via `makeGuardedSender(ctx, retailerId, category)`) — enforces the kill switch, per-seller caps, global opt-outs, and Meta quality status. **`transactional` order messages bypass all gating** (core promise); only `session_message`/templates are gated. See [`docs/waba-protection.md`](./docs/waba-protection.md)
- **Inbound `POST /webhook/whatsapp` verifies Meta's `X-Hub-Signature-256`** (HMAC-SHA256 with `WHATSAPP_APP_SECRET`) and **fails closed** — set the env var before deploying or webhooks 500
- **Customers are keyed by `(retailerId, waPhone)`; aggregates are denormalized** (refreshed on order create/cancel via `linkOrderToCustomer`/`decrementAggregatesForCancel`, counted once per order). Display name resolves `name → waProfileName → phone` via `getDisplayName`, mirrored in `convex/lib/customer.ts` + `src/lib/customer.ts`. A retailer-edited `name` is never overwritten by an inbound pushname.
- Customer payment gateway is **retailer-owned** (HitPay Connect / Billplz / Stripe Connect) — Kedaipal is never the merchant of record for shopper transactions
- **The buyer's no-auth tracking page (`/track/<token>`) is capability-secured by `orders.trackingToken`** (high-entropy, crypto-random), NOT the human `shortId` (which is short + enumerable, so never a secret). Public buyer endpoints key on the token; endpoints shared with the seller dashboard (`orders.get`/`getMockupUrls`/`getCustomerImageUrl`) accept the token (buyer, unauth) **or** an authenticated + ownership-checked `shortId` (seller) via `resolveSharedOrder`. New order data/mutations exposed to buyers must key on the token. See [`docs/infra-cost-scaling.md` §6](./docs/infra-cost-scaling.md).

Competitive positioning vs Orderla: see [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md#competitive-landscape).

## Out of Scope (current sprint horizon)

- Meta Commerce Catalog integration
- BYO WhatsApp Business Account (per-retailer WABA) — deliberately ruled out, see shared-WABA section
- Free tier (deferred until 50 paying customers)
- Marketplace connectors (Shopee, Lazada, TikTok Shop) — original roadmap, parked until F&B core is stable
- Native mobile apps — PWA gets ~80% of the value
- Lawyer-drafted legal docs — using Iubenda/Termly templates + self-drafted AUP for v1

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.

<!-- convex-ai-end -->
