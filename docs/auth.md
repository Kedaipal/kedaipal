# Auth — retailer sign-in

Clerk protects the retailer dashboard only. Shoppers never authenticate: the
storefront (`/<slug>`), the buyer tracking page (`/track/<token>`, capability-secured
by the token) and counter checkout are all public by design.

| Surface | Route | Guard |
| --- | --- | --- |
| Sign in | `/sign-in/$` | Clerk `<SignIn>` wrapped in [`AuthPage`](../src/components/auth/auth-page.tsx) |
| Sign up | `/sign-up/$` | Clerk `<SignUp>` wrapped in `AuthPage` |
| Onboarding | `/onboarding` | `<Show when="signed-in">`, else `RedirectToSignUp`/`RedirectToSignIn` |
| Dashboard | `/app/*` | `<Show when="signed-in">`, else `RedirectToSignIn` |

## Email verification must be a CODE, not a link

**Clerk Dashboard → User & authentication → Email verification: enable _Email
verification code_, disable _Email verification link_.**

This is configuration, not code, and it is load-bearing. Email links (magic links)
are structurally broken for our cohort — sellers on phones, reading mail in the
Gmail app:

1. The seller enters their email in tab A. Clerk creates a sign-in attempt against
   the browser's **Client** (the `__client` cookie) and tab A begins polling for it.
2. The seller switches to the Gmail app and taps the link. iOS opens it in whatever
   browser Gmail is configured to use — very often Gmail's own in-app browser, which
   has a **separate cookie jar**, so it is a different Client.
3. Clerk verifies the email against the *original* Client and shows the opening tab
   `Successfully signed in — Return to original tab to continue / You may close this tab`.
   That screen is terminal: it has no button, because the session belongs to tab A.
4. Tab A is usually gone (backgrounded and discarded by iOS, or it was a different
   browser entirely). Nothing ever completes the sign-in, and the browser the seller
   is actually holding has no session — so re-typing `kedaipal.com` asks them to sign
   in again, and the loop repeats forever.

Verification **codes** have no tab affinity: the seller reads six digits and types
them into the tab they are already looking at. Same-tab, same Client, no dead end.
Codes are also Clerk's default; links are opt-in.

## `AuthPage` — the safety net

[`AuthPage`](../src/components/auth/auth-page.tsx) wraps both auth cards and does one
thing: **if a session already exists in this tab, leave.** It watches Clerk's
`isSignedIn` and navigates away rather than letting the visitor sit on an auth screen.

That covers the same-browser variant of the trap above — link opened in another tab
of the *same* browser, so the Client (and therefore the session) is shared, but
Clerk's card still shows the "return to the original tab" screen. Previously that was
a dead end even though the seller was, in fact, signed in. Now the tab moves itself to
the dashboard.

It is a safety net, not a cure. It cannot help when the link opens in a browser with a
different cookie jar, because no session exists there to detect — only the dashboard
setting above fixes that case. Keep both.

Details worth knowing:

- **The Clerk card stays mounted until auth resolves** (`isLoaded`). Clerk renders its
  own skeleton, and on an email-link landing it still has verification work to do —
  swapping it out early would abort that.
- **Destination resolution** lives in the pure
  [`src/lib/auth-redirect.ts`](../src/lib/auth-redirect.ts). It honours Clerk's own
  redirect params (`sign_in_force_redirect_url`, `sign_up_force_redirect_url`,
  `redirect_url`, then the `fallback` pair) so an admin invite keeps its `?p=` prefill
  token instead of being dumped on a bare dashboard, and defaults to `/app` otherwise.
- **Open-redirect guarded.** Only same-origin path-only destinations are accepted.
  `//evil.com` and `/\evil.com` are rejected despite the leading slash (browsers
  resolve both off-origin); absolute URLs are accepted only when their origin matches
  ours, which is the shape `/onboarding` produces when it hands Clerk a `location.href`.
- **The auth routes are never a destination** — bouncing a signed-in visitor back to
  `/sign-in` would loop.
- **`replace: true`** so Back doesn't return the seller to the card they just cleared.
- `/app` routes a signed-in seller with no store onward to `/onboarding`, so `AuthPage`
  never has to reason about onboarding state — `/app` is always a safe default.

Tests: [`src/lib/auth-redirect.test.ts`](../src/lib/auth-redirect.test.ts) (destination
+ open-redirect rules) and
[`src/components/auth/auth-page.test.tsx`](../src/components/auth/auth-page.test.tsx)
(loading / signed-out / signed-in behaviour).

## Convex

`ConvexProviderWithClerk` bridges the Clerk session into Convex (`src/routes/__root.tsx`).
Convex verifies the `convex` JWT template against `CLERK_JWT_ISSUER_DOMAIN`
(`convex/auth.config.ts`). Server-side authorisation — owner-or-admin — is centralised in
`requireRetailerAccess` / `requireOrderAccess` (`convex/lib/auth.ts`); see
[`admin-console.md`](./admin-console.md).
