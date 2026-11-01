# Seller referrals

A seller on an active plan forwards `kedaipal.com/referral/<their-slug>`. A
seller who signs up through it becomes their **referee**. When the referee
pays their **first plan invoice**, both sides get bonus credits. There is **no
subscription discount anywhere**: rewards are credits only.

| Ticket | Scope | Status |
| --- | --- | --- |
| [z8r3fdetf5](https://app.clickup.com/t/z8r3fdetf5) — T1 | The link, the durable capture, the `referrals` record, the referee's invite surfaces, the admin fix-up | **this doc** |
| [86ey82hke](https://app.clickup.com/t/86ey82hke) — T2 | The two credit grants at the referee's first paid invoice, the reward emails, the Credit activity rows | **this doc** |
| [z8r3fdfp97](https://app.clickup.com/t/z8r3fdfp97) — T3 | The "Refer a kedai" Home card: copy link, WhatsApp share, signed-up / started / earned counts (since 31 Oct a first-view door — § On Home) | **this doc** |

Management-level write-up (terms, reasons, what each person sees): the
ClickUp doc [Referral programme — how it works, who gets what, and why](https://app.clickup.com/90182681518/docs/2kzmx0xe-638).

The three ship as ONE release on one branch. T1 shows the referee the bonus
they'll get and T2 is what pays it, so they must never ship apart.

## The terms (Zaki, 7 Oct 2026)

These supersede the 8, 14 and 15 Sep terms in the ticket bodies (the 50%-off
first Pro invoice, the free month, and the 150 / 50 credits). The canonical
statement is the 7 Oct comment on z8r3fdetf5.

- **Reward = 30% of a month of the REFEREE's tier's LIST grant, to each
  side** (Zaki, 20 Oct 2026): a Pro referee → 60 to the referee and 60 to the
  referrer; a Starter referee → 30 and 30. The referrer's own plan doesn't
  enter it, so bringing in a Pro store pays more than bringing in a Starter —
  the incentive tracks the revenue. Enterprise (a contract, no list grant)
  counts as Pro: a literal 30% of a 1,500-credit contract would be 450
  credits, more than a RM79 first invoice brought in. One author:
  `referralRewardCredits` in `convex/lib/referral.ts`.
- **Both sides are rewarded when the referee's first plan invoice is paid.**
  Nothing is granted during the trial. A paid invoice makes farming
  uneconomic, so there is no monthly cap.
- **Self-referral guard:** if the referee shares the referrer's email or
  WhatsApp number (`looksLikeSelfReferral`), the referrer half is withheld
  and the row reads `self`; the referee — a paying store either way — still
  gets theirs. Not airtight, but a real RM79+ invoice buys at most ~90
  credits, so there is little left to game.
- **Credits land in the purchased bucket**, so they last 12 months
  (`addPurchasedCredits`, lot source `referral`, ledger reasons
  `referral_referee` / `referral_referrer`, all already in the schema since
  Credits T1).
- **Who can refer:** a store on an active paid plan, or a comped one.
  Trial, Off-Season Hold, past-due, cancelled and unclaimed stores can't. A
  zero credit balance doesn't matter.
- **Comped referrers** (partners, sponsors) and Kedaipal's own admin stores
  earn nothing, because they're already unlimited. **Their referees still get
  their credits.**
- **The link is the code.** There are no typed codes anywhere, and a link
  whose store can't refer gives nothing, so the URL pattern is never a public
  coupon. Partners refer with their store link. `?src=referral-hcm`-style tags
  carry no reward.
- **Notifications:** an email each (always), a Credit activity row each, and
  a WhatsApp utility template each **only once Meta has approved it** —
  `WHATSAPP_REFERRAL_REFERRER_TEMPLATE` / `WHATSAPP_REFERRAL_REFEREE_TEMPLATE`
  (params: store, credits, the other store; button → Billing), the credit
  balance notices' exact shape. Unset = nothing sends; the email carries it.

Cost check: a Pro-to-Pro paid referral is 120 credits, about RM24 at Meta's
per-message cost, against a RM149 first invoice (~16%). The old terms cost
about RM104.50.

## The record: `referrals`

One row per **referee** (`refereeId`, `referrerId`, `via: link | admin`,
`recordedBy`, `createdAt`), indexed `by_referee` and `by_referrer_created`.

- **A row is a promise the referee was shown.** It is written only when the
  referrer could refer at that moment (`referrerStanding`), so its existence is
  what T2's reward keys off. The reward never reads the `signupSource`
  analytics tag.
- **It lives in its own table, not in fields on `retailers`.** T3 counts a
  referrer's rows by index, and new fields on `retailers` break other branches
  on the shared dev deployment.
- **`referrerId` can dangle.** If the referrer is deleted after the signup,
  the referee's row and reward stand, and the surfaces read "a Kedaipal
  seller". Account deletion erases the tenant's OWN row as a referee and keeps
  rows naming it as a referrer (`accountDeletion.ts`, phase `referrals`).

**Who referred whom never comes from the tag.** `referral-<slug>` is
sanitized to 32 characters and a slug can be 32 on its own, so a long slug
truncates. The referrer rides `store=` and lands on the row.

## The referee's journey

1. **The link: `/referral/<slug>`** (`src/routes/referral.$slug.tsx`). The
   page renders the landing page itself instead of redirecting to `/`. That is
   for WhatsApp: a link unfurler follows a redirect and reads the target's
   tags, so a redirect would preview every referral as the generic Kedaipal
   card. The loader resolves the invite server-side (`referrals.invite`, with
   an `ssrRead` soft-degrade), so the preview reads "Siti's Kitchen invited you
   to Kedaipal". The page is `noindex` with canonical `/`. A link that doesn't
   resolve renders the plain landing and promises nothing.
2. **Capture.** The analytics tag `src=referral-<slug>&store=<slug>` goes
   through the normal marketing capture (`useMarketingLanding(search)`). The
   referral itself goes into a **30-day first-party cookie**, `kp_referral`
   (`src/lib/referral-cookie.ts`), written only for an invite that resolved.
   It's a cookie rather than sessionStorage because a referral carries a
   promise and a session dies with the tab: a referee who taps the link today
   and signs up tomorrow by typing kedaipal.com must still be a referee. The
   latest link wins. A link shared before the referrer renamed still resolves
   while the old slug is parked, and the cookie keeps the CURRENT slug.
3. **The invite follows them.** "Invited by `<store>` · Get 60 free orders
   when you start Pro, or 30 on Starter" (`ReferralInvitePill`, en/ms/zh)
   appears:
   - at the top of the landing hero (the badge slot that is empty for everyone
     else);
   - in place of the `/pricing` badge;
   - at onboarding (`ReferralInviteNote`).

   The root loader reads the cookie, so SSR reserves the pill's place (a
   skeleton) and the hero never jumps when the name arrives.
4. **Signup.** Onboarding has an optional **"Referred by a Kedaipal
   seller?"** field, seeded from the cookie and typeable — so a referee who
   tapped the link on their phone and signs up on a laptop can paste the
   link (or the store name) and still be credited, and a seeded one can
   clear it. It checks live ("✓ Kuih Lab referred you" / "✗ No store on an
   active plan at that link"). `createRetailer({ referralSlug })` resolves
   the store before inserting the new one, so its own fresh slug can never
   answer, checks the referrer can refer, and writes the row. The referral
   outranks a badge referrer as `signupReferrerId`, and lends its tag to a
   session that carried none. The cookie is cleared on success.
5. **Billing.** Until the first plan invoice is paid, the billing tab says what
   paying brings (`ReferralBonusNote`, from `referrals.mine`, billing:read,
   act-as aware):
   - on the first invoice, the exact number for its plan;
   - above the plan picker, both numbers;
   - on each plan row, "+N referral bonus credits with your first invoice";
   - on the manual "message us" card.

   The note goes quiet once that invoice is paid.

The offer copy never says "you both get". A comped referrer earns nothing, so
"both" would be false for a partner's referee.

## The reward (T2)

`invoices.settleInvoicePaid` — the ONE settle path every rail (Pay-now
webhook, auto-charge, admin mark-paid) funnels into — **schedules**
`referrals.grantForFirstInvoice` when a store's **first** plan invoice is paid
(`firstTime && !isHold`). The grant runs in a transaction of its own, on
purpose: a `try/catch` around several writes inside the settle would not have
rolled them back, so a throw between the referee's credits and the row's stamp
would have left a half-paid reward that never retries; and an uncaught throw
would have failed a payment over a bonus. Scheduled, it is all-or-nothing and
can never block the settle (PR #393 review). What it does:

- **Referee:** `referralRewardCredits(paidPlan)` → a `referral` lot (12
  months), ledger reason `referral_referee`, `refLabel` = the referrer's name.
- **Referrer:** the SAME amount, reason `referral_referrer`, `refLabel` = the
  referee's name — **unless** the referrer is unmetered (comped or
  Kedaipal-owned), deleted, or the same person (`self`). A referrer that
  LAPSED since still earns: the referral was valid when it was made.
- **Exactly once.** The `referrals` row is stamped (`rewardedAt`,
  `refereeCredits`, `referrerCredits`, `referrerOutcome`) in the same
  transaction as the credits, and a stamped row is a no-op — so a webhook and
  a manual mark-paid racing each other can't pay twice. Pinned by a test that
  calls the grant twice (and goes red when the guard is removed).
- **A reward failure never blocks a payment** — the grant is a separate
  scheduled mutation; if it throws, none of its writes land and the admin
  sheet shows the referral un-rewarded (the `rewardedAt` guard means a
  re-run is safe).

**Telling both sides:** an email each, in the seller's locale
(`lib/referralEmailCopy.ts`, en/ms/zh — names the other store, the credits and
the expiry date; the referrer's carries their link to keep sharing), and a
Credit activity row each ("Referral bonus — referred by Siti's Kitchen" /
"Referral reward — New Kedai started their plan"), and the WhatsApp template
above once approved (`referrals.sendRewardWhatsApp`, WABA-gated, retried on
a transient failure). The referee's billing note goes quiet once the invoice
is paid; `referrals.mine.reward` carries what landed.

## On Home — a door, not a card (31 Oct 2026)

T3 put a card at the **foot** of Home; the push (below) turned it into a
teaser; on 31 Oct it went, because a seller never scrolled to it. Referrals
now sit in Home's **first view**, as a door into `/app/refer` — the page
holds everything the card did (link, WhatsApp + Copy, the counts, the fine
print). Mockups: the
[Home: referral + live wallets](https://claude.ai/artifact/5tTKwdXJ2A58FZeh6mtBG2)
canvas, option A.

| Screen | Where | Looks like |
| --- | --- | --- |
| Desktop | Home's header, **first** of the three buttons, before Open store and New order | Dashed mint pill: 🎁 "Refer & earn · 60 free orders each" |
| Phone | Directly under the greeting (the header buttons are desktop-only) | The profile menu's own featured row — gift tile, "Refer & earn", one line, chevron |
| Profile menu | Featured row under the store name | The same row |

One component — `src/components/referrals/refer-entry.tsx` — draws all three
from `referrals.myCard` (same args as the menu, so one cache entry answers
both). The words follow the store's standing:

| Store | Line (row) | Hint (button) |
| --- | --- | --- |
| Active paid | "Refer a kedai, you both get 60 free orders" | "60 free orders each" |
| Comped / Kedaipal-owned | "Refer a kedai, they get 60 free orders" | "they get 60" |
| Trial / no plan | "Starts once your plan is active" | "starts with your plan" |
| On hold / lapsed | "Paused until your plan is active again" | "paused" |

A referee who signed up and hasn't paid replaces the chevron/hint with an
amber **"N waiting"** badge — the one piece of news that brings a seller back
to the page — never on a paused link, where nothing counts. A trial or paused
store still sees the door: the page explains its standing, so the rule is
said, not hidden. No door while the card loads, or for a reader with no store.

The What's-new deep link (`?spot=refer`) lands on the block holding both
doors (`SPOTLIGHT_ANCHOR.refer`, on the route) and rings whichever is showing.

## The push (28 Oct 2026)

The programme was well built and invisible. Eight days after it shipped, the
only seller-side surface was the T3 card at the very foot of Home, below
Deliveries, the checklist and Your store; the offer was phrased in "bonus
credits"; the card showed counts and no *pending* state; the WhatsApp message
was generic with the link mid-paragraph; nothing fired when credits ran low
or an invoice was paid; a trial store saw nothing at all; and Copy / Share
fired no analytics event. Mockups for the discussion: the
[Referral UX push](https://claude.ai/artifact/51CanAFAhgCj4mhQvRm8wC) canvas.

What changed, and why each piece is where it is:

- **A page of its own — `/app/refer`, "Refer & earn"** (`src/routes/app.refer.tsx`,
  pieces in `src/components/referrals/refer-sections.tsx`). The hero says the
  offer in orders; the share kit holds all four channels; the three numbers;
  **one row per referee** (`referrals.myReferrals`, credits:read — the rows say
  what the store *earned*, so a teammate without the grant gets the
  NeedsAccessNote in the list's place); how it works; the fine print. A trial
  or paused store still gets the page: the notice, then how it works, so the
  rule is never a surprise. Not plan-walled and not in `RouteAreaGuard`.
- **The pending state is the engine.** A referee who signed up and hasn't
  paid is a reward *waiting*, and the one thing the referrer can still act
  on. `myCard` carries `pending` — the "N waiting" badge on every door
  into the page (§ On Home; the Home teaser's named `latestPending` line went
  with the teaser on 31 Oct); the page's pending rows lead, amber, and carry
  **"Say hi on WhatsApp"** to the referee's public number — a word from a
  friend converts where an email from us doesn't. Each waiting row says
  **where the referee actually stands** — `stage` on `MyReferralRow`, from
  `refereeStage` (`convex/lib/referral.ts`) reading their subscription: "on
  their free period", "free period over · first invoice due", "first invoice
  overdue", or "not on a plan yet" — in the Billing tab's own words. The
  first build printed "on their free trial" on every waiting row by
  assumption; a referee whose free period ended unpaid is the commonest
  state, and the one a nudge matters most for. How a waiting row pays out is
  said **once**, above the list, not on every row; a started row that paid
  this store nothing ("Same owner", "On the house") says why **on the row** —
  a hover tooltip is invisible on a phone. The page's own list leads with the
  waiting rows.
- **Entry points.** Sidebar: "Refer & earn" after Insights, before Settings
  (the growth items together, above configuration). Phone More sheet: after
  Vouchers, above Store poster. The profile menu's featured row and Home's door
  (above) link here too.
- **Moments.** The credit meter's LOW and OUT states carry one line under the
  top-up — "Or earn 60 free orders: refer a kedai that starts Pro" — only for
  a store that earns the referrer half, never on a healthy meter. Every
  paid-**plan** receipt email (`notifyPaymentReceived`) carries the invitation
  under its CTA (`referralReceiptFooter`, en/ms/zh, in orders like every share
  surface); a hold receipt does not — a paused store's link is paused too.
- **The referee's side.** Home shows a **referral welcome card** above the
  welcome card for a referred store until its first invoice is paid — who
  invited them, the 60, and "Start your plan" into Billing. Built as a card,
  not a post-onboarding redirect into Billing: a paywall before any value is
  the classic trial killer, and the trial exists so value comes first.
  Onboarding's "Referred by" field, when the cookie seeded it and the invite
  resolved, is a **confirmed chip** ("Kuih Lab referred you ✓ · Not them?")
  rather than an input — no slug to mistype — and never a *disabled* input,
  because the cookie keeps the *last* link opened and two partners can share
  a prospect.
- **The share kit.** `referralShareMessage(link, storeName)` opens with the
  store's own name (a friend vouching, not an ad), says "60 free orders", and
  puts the link alone on the last line so WhatsApp renders the invite page's
  preview card. **Copy message** and a **share image** join WhatsApp and
  **Copy invite link** — never bare "Copy link": on Home the teaser sits under
  the store-link card, whose own button is "Copy link", and two identical
  labels for two different links is how a seller sends their storefront
  instead of their invite.
- **The share image — the invite as a voucher** (`ShareImageDialog`, drawn by
  `src/lib/referral-share-image.ts` from `referralShareImageCopy`; mockups F1–F3
  on the canvas). The offer on top ("Kek Mak Jah invites you", **60 orders**
  lit, "on us."), a perforated stub below with a large QR and the link, the
  Kedaipal mark in the corner so a stranger scrolling a status knows what it
  is. **Two formats**, one pick-one control (`ModeButton`): **Square** 1080²
  for posts, seller groups and chats; **Story** 1080×1920 for a WhatsApp
  status or an Instagram/Facebook story (it adds three benefit lines where
  there is room). The card is a **brand asset in fixed colours**, identical
  in light and dark, and the dialog's preview **is the drawn PNG** — the first
  build showed a DOM look-alike whose navy drifted from the file in dark
  mode. On a device that can share files (`navigator.canShare`), **Share
  image** is primary and hands the PNG to the system share sheet (WhatsApp,
  Instagram) — a download strands it in Files; **Save image** and **Copy
  link** sit below. Elsewhere the primary is **Download PNG**. A failed draw
  shows "Try again", never a blank stage. Long store names shrink, then
  ellipsise, never run off the card. The draw waits on the card's fonts
  (`document.fonts.load`) — a canvas never waits on its own.
- **One promise, referee-side.** Everything a referee sees before Billing —
  the invite pill, the link preview, the onboarding chip and note, the Home
  welcome card — says "free orders", the same words as the message and image
  that brought them, and so does the receipt footer. Billing keeps "bonus
  credits": its plan rows are counted in credits ("200 credits a month"), and
  1 credit = 1 order. The referee welcome card reads `referrals.mine` only
  with billing:read in hand (the query refuses without it), the way Home
  skips its other gated reads — never fired and left to error.
- **Measured.** `referral_share` (`channel` × `surface`) fires on every share
  tap — `image` for a saved PNG, `image_share` for one handed to the share
  sheet; docs/analytics.md.

Deliberately not changed: the terms (a trial store still can't refer; letting
one refer with its half held until it subscribes is a terms decision, flagged
for Zaki), and the T2 reward path.

## Admin

- **Sellers → a seller's sheet → "How they arrived" → Referred by** shows the
  referrer (or "A store since deleted"), whether it came via their link or was
  set by an admin, and when — and once paid, what each side received
  ("Rewarded · +60 them · +30 referrer" / "referrer on the house").
- **Set referrer / Change** (`referrals.adminSetReferrer`) puts right a
  referral the link didn't capture: another browser, an off-link intro, or a
  pre-built store handed to a referred vendor. The link's own rules apply, and
  the refusal names the reason under the field.
- **Remove referral** (`adminClearReferral`) sits behind its own confirm. Both
  actions are audited (`referrals.adminSetReferrer` /
  `referrals.adminClearReferral`).
- **Both are locked once the referee pays its first plan invoice** ("Locked —
  first invoice paid"). The reward moment has passed; a missed reward is a
  credits adjustment.
- **The sellers CSV** carries a "Referred by" column, distinct from
  "Referrer", which is the badge or link that brought the signup.

## Deliberate trade-offs

- **Eligibility is observable.** `/referral/<slug>` shows an invite only for a
  store that can refer, so a prober can tell "on an active or comped plan"
  from "trial or lapsed". The invite never says why, and a public coupon was
  the worse alternative.
- **The analytics tag and the referral can name different stores.** The
  `signupSource` tag is session last-touch, but the referral is the cookie,
  and a trial store's link doesn't overwrite a live one (it promised
  nothing). So a visitor who opens Kuih Lab's link, then a trial store's,
  signs up with tag `referral-<trial-store>` while "Referred by" (and the
  reward) says Kuih Lab. The admin sheet shows both rows side by side; the
  reward always follows "Referred by".
- **Last referral link wins**, per browser. Two partners sharing one prospect
  is decided by whichever link the prospect opened last. An admin can change
  it before the first invoice.
- **The privacy policy** lists the referral cookie among the strictly
  necessary ones, and `PRIVACY_VERSION` is bumped to `2026-10-20` (Zaki,
  20 Oct 2026) — every seller re-accepts on their next visit.
- **Cross-device** is covered by the onboarding field, not the cookie: the
  cookie seeds it on the same device; elsewhere the referee pastes the link.
