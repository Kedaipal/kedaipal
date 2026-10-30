# Not-found pages

What a visitor sees at a URL nothing claims, and why it is a page rather than
a redirect.

## The rule: a designed 404, never a redirect home

Before this, every unknown URL rendered TanStack Router's bare
`<p>Not Found</p>` on a blank page. The question was "beautify it, or send
every unknown URL to the homepage?" — and redirecting was rejected:

- **It hides the mistake.** The visitor can't see the typo they need to fix.
- **A mistyped store link lands on our marketing site.** A buyer who followed
  `kedaipal.com/kek-sayang-bakeri` from a seller's WhatsApp expects a cake shop,
  not a SaaS landing page, and has no idea what went wrong.
- **It's a soft 404.** Answering a URL that doesn't exist with a success tells
  search engines it does.

So every miss gets a page that **prints the requested path back** (in mono,
decoded, capped at 60 characters) and offers the way out that fits where the
visitor was. The server still answers **HTTP 404** — TanStack Start reads it
off the not-found match, and `not-found-page.test.tsx` pins it against a real
router.

## Three contexts

Decided from the **pathname** by `notFoundContext` (`src/lib/not-found.ts`),
never from the route id the boundary rendered under — that moves with the
route tree, the pathname is what the visitor typed.

| Context | When | Heading | Ways out |
|---|---|---|---|
| `app` | anything under `/app` | This page doesn't exist | **Back to Home** (`/app`), plus **Go to *Section*** when the first segment names a dashboard section (`appSectionFor`: Orders, Products, Promotions, Deliveries, Counter, Customers, Vouchers, Insights, Settings — the sidebar's words; never admin) |
| `store` | a single public segment that names no store | We couldn't find that store | **Browse stores** (`/stores`), **Go to Kedaipal** (`/`), and "Got this link from a seller? Ask them to send it again." |
| `site` | everything else | Page not found | **Go to homepage** (`/`), **Browse stores** |

One component renders all three: `NotFoundPage`
(`src/components/not-found/not-found-page.tsx`). The `store` and `site`
contexts are a full page with the Kedaipal wordmark (linking home), because
nothing else tells a buyer where they are. The `app` context carries **no**
wordmark and no full-viewport height: it renders inside the dashboard shell,
which is already the brand and the frame.

## Where each page comes from

- **`defaultNotFoundComponent: RouteNotFound`** in `src/router.tsx` catches
  every URL nothing claims. TanStack's default **fuzzy** mode renders it in
  the deepest matched route that has children — so a dead `/app/...` link
  renders inside `/app`'s outlet (sidebar and bottom nav stay; a signed-out
  visitor is sent to sign-in by the shell's gate first), and `/foo/bar`
  renders at the root.
- **`/$slug` and `/$slug/checkout`** render `NotFoundPage context="store"`
  themselves when the slug names nobody (their loader throws `notFound()`), so
  a dead store link reads identically from both doors. A single unknown segment
  never reaches the router default: `/$slug` claims it.
- **Unchanged, deliberately:** product, category, `/track/<token>` and
  `/claim/<token>` keep their own not-found pages. Those are misses *inside* a
  store or an order — they need "back to the store", not "browse stores".

## Who titles the tab

TanStack keeps the **deepest** route's `title`, so the head of a not-found
render needs an owner:

- The **root** titles a global miss at the root (`match.globalNotFound`):
  "Page not found — Kedaipal", `noindex, follow`.
- **`/app`** titles a dead dashboard link (`rendersNotFound(match)` — a global
  miss under `/app` arrives with `globalNotFound: true` and status `success`,
  not `notFound`).
- **`/$slug` / checkout** title their own miss: "Store not found — Kedaipal".
- **The trap:** fuzzy matching still *runs* `/$slug` (slug `foo`) on the way to
  `/foo/bar` — its loader, and its head. Without a guard, `/foo/bar` was titled
  "Store not found", and `/<real-store>/junk` would carry that store's full
  indexable SEO head above a "Page not found" body. Every buyer route that can
  be matched this way (`/$slug`, checkout, product, category) starts its
  `head()` with `missOwnedElsewhere(matches, match)` and returns `{}` when it's
  true. `src/lib/not-found-heads.test.ts` calls the real heads; deleting a
  guard turns it red.

Known cost, not fixed here: that fuzzy match also runs `/$slug`'s loader — one
`getRetailerBySlug` read per unknown multi-segment URL. It was already the case
before this page existed.

## Tests

- `src/lib/not-found.test.ts` — the context classifier, the section map (incl.
  no admin door, no `Object.prototype` keys), path display, head helpers.
- `src/components/not-found/not-found-page.test.tsx` — each context against a
  real TanStack memory router: 404 status, copy, link targets, the `/app` page
  rendering inside the shell, `/$slug` matched on the way; plus the router
  wiring.
- `src/lib/not-found-heads.test.ts` — the real routes' `head()`s.
