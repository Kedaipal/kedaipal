# SEO, AEO and GEO — how Kedaipal is found

**Status: implemented** (ClickUp `z8r3fdh2yt` llms.txt + AI crawler policy,
`z8r3fdh2z3` structured data, `z8r3fdh2ye` sitemap + index hygiene; 21 Oct
2026). Measurement (`z8r3fdh2z4`) and off-site entity consistency
(`z8r3fdh2z8`) are operator work tracked on their tickets. The `/learn`
answer-content route (`z8r3fdh2zr`) and `/ms` `/zh` URL locales (`z8r3fdh2zq`)
stay parked on their triggers.

Three audiences read the public site, and the same facts must reach all three:

| Audience | What it reads | Where the facts live |
|---|---|---|
| Search engines (Google, Bing) | HTML meta, JSON-LD, `sitemap.xml`, `robots.txt` | this doc |
| Answer boxes (featured snippets, AI Overviews) | `FAQPage` on `/`, question-shaped copy | `src/lib/landing-faq.ts` |
| Answer engines (ChatGPT search, Perplexity, Claude, Copilot) | `/llms.txt`, the Organization entity, third-party listings | `src/lib/llms-txt.ts`, `src/lib/site-identity.ts` |

## One identity, one author

Everything the company says about itself — legal entity, description, support
address, markets, languages, public profiles — lives in
[`src/lib/site-identity.ts`](../src/lib/site-identity.ts). The landing's
`Organization` JSON-LD, the footer's social links and `/llms.txt` all read it,
so a profile URL (itself a `site-links.ts` constant) or the description
changes in one place and every surface follows. **Add a directory listing there once it is live** and it joins
`sameAs` automatically.

The GEO premise (the audit of 22 Sep 2026): an answer engine builds its
picture of a company from third-party sources more than from the site, and
when they disagree it hedges or names a competitor it is surer about. The
canonical block pasted into every directory is this file's values, verbatim.

## Structured data per route

| Route | JSON-LD types | Author |
|---|---|---|
| `/` | `Organization` (with `sameAs`, `contactPoint`, `legalName`, `foundingDate`, `address`), `SoftwareApplication` + `AggregateOffer`, `FAQPage`, `VideoObject` | `src/routes/index.tsx` |
| `/pricing` | `SoftwareApplication` with one `Offer` per listed tier × billing cycle, in the visitor's resolved currency | `src/lib/pricing-jsonld.ts` |
| `/stores` | `ItemList` of stores (and the focused showcase) | `src/routes/stores.tsx` |
| `/$slug` | `Store` | `src/routes/$slug.tsx` |
| `/$slug/c/$categorySlug` | `BreadcrumbList` (Store › Category) | `src/lib/breadcrumbs.ts` |
| `/$slug/p/$productSlug` | `Product` + `Offer`/`AggregateOffer`, `BreadcrumbList` (Store › Category › Product) | `src/lib/breadcrumbs.ts` |

Rules that hold across all of them:

- **Prices are derived, never typed.** Every published price reads
  `PLAN_MONTHLY_PRICES` / `annualQuote` (`convex/lib/plans.ts`);
  `pricing-jsonld.test.ts` and `llms-txt.test.ts` pin both currencies, monthly
  and annual. An answer engine quotes whatever number it last crawled, so a
  stale price outlives the reprice for as long as the crawl cache does.
- **The `/pricing` schema currency is the SSR'd currency.** `head()` reads the
  root loader's region (the same answer `useLandingRegion` seeds the cards
  from), so the schema price is the visible price — Google flags a mismatch.
  A visitor's later toggle re-renders the cards, not the head; a crawler never
  toggles.
- **Enterprise is never an Offer and founding prices never appear.** Neither
  is a public list price.
- **The product breadcrumb's category is the product's first visible one**
  (`categories.primaryPublicForProduct`): the seller's first assignment, skipping
  hidden or archived categories whose page 404s. No category → a two-level
  trail, never a null item.
- **Every `<script type="application/ld+json">` goes through `jsonLdScript`**
  (`src/lib/json-ld.ts`) — seller text is escaped so a store name can't close
  the tag. `json-ld.test.ts` lists the routes that carry JSON-LD; add a route
  there when it gains one.

## The storefront index rule

Which storefronts search engines are told about is **one rule**,
[`convex/lib/storefrontIndex.ts`](../convex/lib/storefrontIndex.ts), read by
the three sitemap queries, the storefront's `<meta name="robots">` and
(next) the `/stores` directory. A storefront is indexable when a buyer can
order from it:

| Fact | Indexable? | Why |
|---|---|---|
| Unclaimed pre-built store | no | nobody's shop yet; the slug may be renamed at handover |
| Taken offline by Kedaipal | no | the page is a noindex "unavailable" screen |
| Subscription `cancelled` | no | a churned store still serves 200 — keeping it spends the domain's authority on a page that can't sell |
| Zero storefront-visible products | no | a thin page drags the whole domain's quality |
| `trialing`, `active`, `past_due`, `on_hold`, no subscription row | yes | the catalogue is live and the page is valid; a paused banner over a real catalogue is not a dead page (the `on_hold` call the ticket left to the PR) |
| Seller's own "Accepting orders" pause | yes | a real store that is closed today is still the store |

**The sitemap and the page agree by construction:** a store the sitemap
leaves out renders `noindex, follow` from the same rule (`retailers.indexable`
on the by-slug payload). Excluding it from the sitemap alone would leave it
indexable through any inbound link.

`lastmod` for a store is the newest of the store's last write and its newest
product write (`storefrontLastmod`); for a product or category, that row's
`updatedAt`. Creation time never moves, and a `lastmod` that never moves
teaches Google the field means nothing.

The sitemap lists, in priority order: `/`, `/pricing`, `/stores`, `/cost`, the
legal pack, the three vendor guides in `public/guides/` (static HTML, listed by
`GUIDE_PATHS` in `src/lib/sitemap.ts` — add a guide there when adding the
file), then stores (0.8), category pages (0.7), product pages (0.6). Old slugs
(`slugHistory`) are never emitted.

**Scale note:** the sitemap walk is a full read of `retailers` plus one indexed
products read and one subscription read per store — fine under ~1k retailers
(we are under 100). Past that, add `by_status` on `subscriptions` and page the
walk.

## AI crawlers: `robots.txt` and `/llms.txt`

`public/robots.txt` names every major AI crawler (GPTBot, OAI-SearchBot,
ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot,
Perplexity-User, Google-Extended, Bingbot, Applebot-Extended) with `Allow: /`
and the same private paths as `*`: `/app/`, `/sign-in/`, `/sign-up/`,
`/onboarding/`, and the per-buyer capability links `/track/` and `/claim/`.
Explicit on purpose — a bot that finds no block for its own name falls back to
`*`, but the explicit entry is what a policy audit reads. **Cloudflare's
"Block AI bots" toggle outranks all of this**: if it is on, every one of those
bots gets a 403 before `robots.txt` is read. It is checked in the dashboard,
not in code (ticket `z8r3fdh2yt`).

`/llms.txt` (`src/routes/llms[.]txt.ts` → `src/lib/llms-txt.ts`) is the one
page an answer engine reads to learn what Kedaipal is, who it is for and what
it costs: the `Organization` description, the ICP in plain words, the
shared-WABA "no Meta verification" differentiator, both tiers in both
currencies (monthly and annual, derived), Enterprise as a contract, the
primary landing FAQ as question + answer pairs, and links to the fact pages. A
server route rather than a static file because it reads the billing constants
and the English FAQ catalogue — a static copy would be a second place for the
price to go stale. English only, one document per URL (the FAQ JSON-LD rule).
**Never storefront slugs** — sellers own those and the sitemap carries them.

`/llms-full.txt` is deliberately absent: it earns its place when there is
content beyond the landing page (the parked `/learn` ticket).

## Measurement

Search Console and Bing Webmaster Tools (`z8r3fdh2z4`) are the baseline: a
monthly branded vs non-branded impressions row in the monthly review deck
(`kedaipal-monthly-review`). Bing matters separately — it is the index behind
ChatGPT search and Copilot, so it is the GEO measurement too. The triggers for
re-opening the "is organic a channel yet" decision, and for un-parking
`/learn` and the URL locales, live on those tickets.

## Share images

Every marketing page (`/`, `/pricing`, `/cost`, `/terms`, `/acceptable-use`)
shares one `public/og-image.png` (1200 × 630); storefront, category and product
pages use the seller's own cover, logo or product photo through the image
proxy. The landing `SoftwareApplication.image` points at the same file.

The current card (21 Oct 2026, Arif's pick) is the house mint — solid
`--accent` `#10B981` with the white logo, the "Stop losing orders buried in
WhatsApp chat." headline and a flat phone showing one order card — replacing
the navy gradient card. It was generated with Higgsfield (GPT Image 2.5) from
the logo and the previous card as references, rendered at 16:9/2k and cropped
to 1200 × 630; the rejected variant was a pale mint wash with a navy headline.
Regenerate the same way if the headline changes — the `og:image:alt` in
`src/routes/index.tsx` must keep describing what the image says.
