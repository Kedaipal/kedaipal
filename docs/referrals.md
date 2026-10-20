# Seller referrals

A seller on an active plan forwards `kedaipal.com/referral/<their-slug>`. A
seller who signs up through it becomes their **referee**. When the referee
pays their **first plan invoice**, both sides get bonus credits. There is **no
subscription discount anywhere**: rewards are credits only.

| Ticket | Scope | Status |
| --- | --- | --- |
| [z8r3fdetf5](https://app.clickup.com/t/z8r3fdetf5) — T1 | The link, the durable capture, the `referrals` record, the referee's invite surfaces, the admin fix-up | **this doc** |
| [86ey82hke](https://app.clickup.com/t/86ey82hke) — T2 | The two credit grants at the referee's first paid invoice, the reward emails, the Credit activity rows | **this doc** |
| [z8r3fdfp97](https://app.clickup.com/t/z8r3fdfp97) — T3 | The "Refer a kedai" Home card: copy link, WhatsApp share, signed-up / started / earned counts | **this doc** |

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
3. **The invite follows them.** "Invited by `<store>` · Get 60 bonus credits
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
webhook, auto-charge, admin mark-paid) funnels into — calls
`referrals.grantReferralRewards` when a store's **first** plan invoice is paid
(`firstTime && !isHold`), right after the plan credits land:

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
- **A reward failure never blocks a payment** — it is caught and logged; the
  admin sheet then shows the referral un-rewarded.

**Telling both sides:** an email each, in the seller's locale
(`lib/referralEmailCopy.ts`, en/ms/zh — names the other store, the credits and
the expiry date; the referrer's carries their link to keep sharing), and a
Credit activity row each ("Referral bonus — referred by Siti's Kitchen" /
"Referral reward — New Kedai started their plan"), and the WhatsApp template
above once approved (`referrals.sendRewardWhatsApp`, WABA-gated, retried on
a transient failure). The referee's billing note goes quiet once the invoice
is paid; `referrals.mine.reward` carries what landed.

## The card (T3)

`src/components/home/refer-card.tsx`, read from `referrals.myCard` (any
member: the link is public and the card shows counts, never a referee's name).
Its **own section at the foot of Home** — not inside the "Your store" card,
which shares the store with buyers; this refers another seller, and it is
never urgent.

| Store | Card |
| --- | --- |
| Active paid | The offer ("they get 60 on Pro, 30 on Starter — and so do you"), the link, Copy + Share on WhatsApp (`referralShareMessage`, one author), and Signed up / Started their plan / Credits earned |
| Comped / Kedaipal-owned | The same, minus earnings, with "your account is on the house — but every kedai you refer still gets their bonus" |
| On hold / lapsed | **Paused**, saying why and linking to Billing — a link that silently stopped counting would be hidden behaviour |
| Trial | Nothing (Zaki: refer once the plan is paid) |

Zero sign-ups is a sentence, not a row of zeros. The counts read
`referrals.by_referrer_created`, capped at 500 ("500+").

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
