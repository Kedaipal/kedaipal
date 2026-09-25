# Team members & per-area permissions (RBAC v1)

> ClickUp [`86exr91r4`](https://app.clickup.com/t/86exr91r4) · re-scoped 24 Sep 2026 (Zaki) from the
> two-role spec to owner-managed per-area grants. Asked for by three paying
> accounts (WaDaFish, FS Fitness, Sue Chef Kitchen); must be live before
> Malaysia Campfest 16–18 Oct.

**TL;DR:** a store has ONE owner (`retailers.userId`, unchanged) and up to
`userCap − 1` teammates (`retailerMembers` rows). The owner invites helpers by
email with per-AREA read/write grants; the helper signs in with their own Clerk
account and lands in the owner's store. Every server function declares what it
needs through `requireRetailerAccess`, so access is re-resolved per request —
removal and grant edits bite on the member's next call.

## The permission model

- **Areas, not components** (`convex/lib/permissions.ts`, the registry):
  `orders · products · customers · bookings · insights · exports ·
  store_settings · fulfilment · payments_settings · integrations · billing`.
  Every tab, route and dashboard widget declares the area whose data it reads
  and inherits visibility — a future Lalamove-balance widget declares
  `integrations` and needs no new permission row. This keeps the Team page ~11
  rows forever and avoids contradictions (hiding a revenue tile while the
  order list shows per-order amounts).
- **none / read / write** per area, write implies read, **deny-by-default**:
  an absent key is no access, and an area added later starts at "none" for
  every existing member automatically.
- **`MAX_GRANTABLE` caps what can even be stored** (server-side
  `sanitizePermissions` on every write): `insights`/`exports` are read-only by
  nature; **`billing` write is owner-only in v1** — plan changes, cancel and
  auto-renew move the owner's money. Relaxing any of these is one registry
  line, not a migration.
- **Hard owner-only, never in the matrix:** the Team page itself, the
  WhatsApp tab (store numbers + templates — Arif D2), slug rename,
  currency/country, business (legal) identity, consent re-acceptance, account
  deletion, plan change/cancel/auto-renew, founding claims, hard deletes.
- **Honesty rule for copy:** `insights: none` hides *totals and trends*, not
  money entirely — a member working orders sees order amounts, because
  collecting payment is the job. Never promise more than that.

## The gate (convex/lib/auth.ts)

`requireRetailerAccess(ctx, retailerId, requirement)` — the requirement is a
**required** argument (`{area, level}` | `{ownerOnly}` | `{anyMember}`), so a
new Convex function that forgets to declare its access does not compile.
Resolution order: owner → admin (allowlist, white-glove act-as — bypasses
grants by design) → active member (grants checked). Deny throws `Forbidden`.

- `tryRetailerAccess` — same check, `null` instead of a throw, for reads inside
  screens a member legitimately sees where a missing grant must render as a
  LOCKED state (e.g. `delyva.getSettings` returns a zeroed `{locked: true}`
  summary inside the Fulfilment tab).
- `resolveMyRetailer` — the store the caller WORKS IN (own store, else active
  membership). Behind every zero-arg "my store" read: `getMyRetailer` (payload
  now carries `role` + `permissions`), counter checkout, claim links,
  `getMyPlan`, the checklist stamps. `resolveMyRetailerFor` adds a grant check
  for zero-arg reads whose answer depends on one (the billing queries).
- `updateSettings` is ONE mutation carrying ~30 fields, so it enforces a
  field→area map (`SETTINGS_FIELD_AREA`, typed over the args keys — an
  undeclared new field is a compile error). A member needs write on every area
  their save touches; owner fields refuse members outright.

## Seats

- `PLAN_CAPS.userCap` is TOTAL people incl. the owner: Starter 1 / Pro 3 /
  Scale 6 = "You + 0/2/5 teammates". Caps are denormalized onto subscription
  rows → **changing them needs `migrations.resyncSubscriptionCaps` on prod**
  (on the release checklist). Comped stores and an admin's own store resolve
  to unlimited seats like every other cap.
- Pending invites hold a seat. At cap the Invite button disables with the
  reason inline; the server repeats the refusal.
- **Plan drop below usage** (`enforceSeatCap`, `convex/lib/seats.ts`) runs at
  the ONE place a plan actually flips — `settleInvoicePaid` (every rail
  funnels there, including scheduled downgrades billed as the pending plan's
  invoice). Over-cap: pending invites cancelled first (newest first), then
  newest members dropped (`removed`/`plan_change`), each emailed, owner
  summarised. **Lapse, comp-off and Off-Season Hold drop nobody** — they lock
  the store without flipping the plan, and members go view-only exactly like
  the owner.

## Invite lifecycle (convex/team.ts)

`invite → resend/cancelInvite → acceptInvite (/join/$token) or
acceptPendingInvite (onboarding banner) → updatePermissions/remove/leave`.

- Token: 32 random bytes hex in the URL, **sha256 at rest**
  (`convex/lib/sha256.ts` — pure TS because mutations can't use
  `crypto.subtle`; FIPS vectors pinned). Kept after accept so a re-clicked
  link honestly says "already used". 7-day expiry, resend rotates it (60s
  cooldown).
- **The token proves the link; the EMAIL proves the person.** Accept requires
  the Clerk identity's verified email to equal the invite email — a forwarded
  link binds nobody. `acceptPendingInvite` needs no token for the same reason:
  the onboarding banner only lists invites addressed to the caller's own
  verified email.
- **One store per login**, both directions, one principle: *ending a store
  relationship is always an explicit act on the thing being left, never a side
  effect.* A member may absolutely become an owner — but the order is **leave,
  then create**, never both in one form. `team.leave` is the ONE member-side
  exit (it emails the owner that a seat freed); only once it has run is the
  login storeless and `/onboarding` reachable at all. `createRetailer` refuses
  an active member outright and names the route ("Leave that team first from
  Settings → Team"), which is what a stale client or a direct API call meets.
  A first pass gave `createRetailer` its own `confirmLeaveTeam` flag that ended
  the membership inline; it was deleted, because it put a second exit from a
  team in the codebase **and was unreachable anyway** — `getMyRetailer`
  resolves a member's TEAM store, so `/onboarding` redirects them before any
  confirm could fire. The Leave dialog and a member-only note under the roster
  now say the one-store rule out loud, so the route isn't something to guess.
  An owner cannot accept an invite — `/join` explains and offers the
  WhatsApp-the-inviter CTA; closing their store first is the path, and
  **accepting a link never cancels a subscription**.
- Accept results are RETURNED, not thrown (`AcceptResult` reasons: invalid /
  used / expired / email_mismatch / own_store / other_membership / no_seat) —
  each is an expected human situation with its own copy on `/join`.
- Removal keeps the row (`removed` + reason) so the removed user's next
  `/onboarding` load explains itself and the timeline still resolves their
  name. Account deletion (`accountDeletion.ts` phase `retailerMembers`)
  DELETES the rows (tenant erasure) after emailing active members.

## Attribution

`orderEvents.actorUserId` + `orders.createdByUserId` (both optional, stamped
from PR1 because stamps can't be backfilled; the timeline's "· by {name}"
renders in PR3). Stamped on every seller-side status move, stage advance,
counter sale, payment confirm, mockup action, fee set and reschedule. NEVER
stamped for buyers, system paths (webhooks, sweeps) or admin act-as — an admin
is not a teammate; `adminAuditLog` traces those.

## Emails (Resend, store's locale)

`teamInvite` (accept link) · `teamAccessRevoked` (removed / plan_change /
store_deleted variants) · `teamMemberJoined` · `teamMemberLeft` ·
`teamSeatSummary` (who a downgrade dropped). The "left" mail says only that
they left and the seat is free — WHY someone left is theirs to tell, not a
fact to forward to the team they just left. Owner
alerts go to `notifyEmail`; `ensureNotifyEmailFromIdentity` stays strictly
owner-keyed so a helper's sign-in can never become the store's alert address.

## Deliberately owner-only-by-construction (`by_user`) — commented in code

Billing writes (`subscribeSelf`, plan changes, auto-renew, seasonal hold),
founding-member surfaces, `releases.ts` What's-new stamps (members skip the
modal in v1), consent acceptance, `subscriptions.current` (no member-facing
caller). Each carries a "do not fix to resolveMyRetailer" comment naming why.

## Release checklist items this feature creates

- Env vars: none new (Resend already configured).
- Schema: additive only (`retailerMembers` + two optional fields).
- **Prod migration: `resyncSubscriptionCaps` (userCap 1/3/6) after deploy.**
- Meta templates: none. `PRIVACY_VERSION`: no bump (member emails/names are
  seller-side users on the same basis as owners) — note in the release PR.

## Follow-ups landing in PR2/PR3 (stacked)

PR2: Team tab + permission matrix UI (presets "Front-desk helper" / "Store
manager"), `/join/$token` route states, onboarding banners (pending invite /
removed), member chrome (locked tabs with "ask {owner}",
hidden consent banner, sign-in redirect fix so an existing account's sign-in
doesn't eat the invite link). PR3: timeline "· by {name}", admin sellers Seats
column, pricing copy ("You + 2 teammates", drop the Soon badge), shipped-log.
