# HTTPS enforcement

Every Kedaipal web page is served over HTTPS only. An `http://` request gets a
permanent redirect to the identical `https://` URL, and a browser that has
visited once never tries plain http again (HSTS). ClickUp
[`z8r3fdg3bw`](https://app.clickup.com/t/z8r3fdg3bw).

**Why it matters.** `/track/<token>` is capability-secured by the token in its
URL ([CLAUDE.md](../CLAUDE.md) → architectural constraints). Over plain http
that token, plus the buyer's phone, address and order, crosses café and mall
Wi-Fi in clear text. Our own links are https (`SITE_URL`), but a hand-typed or
re-shared `http://` link was not: until this shipped, `http://kedaipal.com/`
answered `200 OK` with the whole site. On the seller side the browser showed
"Not secure" on the Clerk login, and secure cookies, the service worker and push
quietly broke on the insecure origin.

## Two layers

| Layer | Where | What it does | Owns |
| --- | --- | --- | --- |
| **Edge** (the real fix) | Cloudflare zone `kedaipal.com` → SSL/TLS → Edge Certificates | **Always Use HTTPS** answers http with a 301 *before the Worker runs*, so it costs no Worker requests. **HSTS** adds `Strict-Transport-Security` to every https response. | The redirect for the custom domain, and the **only** source of the HSTS header |
| **Worker guard** (defence in depth) | `src/server-entry.ts`, step 0 → `src/lib/https-redirect.ts` | If an http request still reaches the Worker, because the toggle was flipped off or the request came in on `*.workers.dev` (zone settings don't apply there), it is redirected before the image route, the placeholder rescue or the router see it | The redirect, whatever the dashboard says |

The guard is what makes "it can't silently regress" true. Without it, one
dashboard click reopens the hole and nothing in the code base notices.

### The guard's rules

- **301** for `GET`/`HEAD`, **308** for anything else. Browsers re-send a 301'd
  POST as a body-less GET, and 308 keeps the method and body.
- **Path and query survive byte-for-byte.** The target is the request string
  with its scheme swapped; `Response.redirect` then parses and serialises it,
  and the WHATWG serialiser keeps percent-encoded bytes (`%7B%7B1%7D%7D`) as
  they arrived. That is the property that matters: the `86eyheqzv` loop was the
  router **decoding** those braces in `Location` (see
  [buyer-page-resilience.md](./buyer-page-resilience.md)), which this hop never
  does. A test asserts the final `Location` header, not just the helper.
- **Single hop, then exactly as before.** An http placeholder link gets 301 →
  https (guard), then 301 → clean URL (rescue). Each hop is https from the
  first one, so it can't loop.
- **A non-default port is dropped.** A public host serves https on 443.
- **Local dev is never redirected.** `localhost`, `*.localhost`, `127.x`,
  `0.0.0.0`, `[::1]` and private-LAN IPv4 (`10.x`, `192.168.x`, `172.16–31.x`)
  stay on http, so `pnpm dev`, `wrangler dev` and phone-on-LAN testing work
  unchanged. That check is `isLocalHttpOrigin` in `convex/lib/localOrigin.ts`,
  the same one the WhatsApp adapter uses for its dev CTA-button upgrade. It
  matches the **whole** host: the old prefix regex would have called
  `http://localhost.evil.com` or `http://10.example.com` local.

### Why the Worker does NOT set HSTS

There is one owner of the header: Cloudflare's HSTS setting, which applies to
every https response on the zone, Worker responses included. A second copy from
the Worker would mean two `max-age`s to keep in step during the ramp below, and
a duplicated header when they drift. Losing HSTS to a flipped toggle costs at
most one plaintext request **that the guard still redirects**, so HSTS is the
optimisation and the redirect is the guarantee. If the curl check below ever
shows the custom domain's https responses without the header while the zone
setting is on, the Worker takes it over instead. Change this section when that
happens.

## Operator setup (Cloudflare dashboard, one time)

Do these on account `8eb3…c1df`, zone `kedaipal.com`. Use SSL/TLS → Edge
Certificates for the first two and SSL/TLS → Overview for the third.

1. **Always Use HTTPS: ON.**
2. **HSTS: enable** with `max-age` **1 week** (604800), **includeSubDomains
   OFF**, **preload OFF**, No-Sniff on.
3. **SSL/TLS encryption mode: Full (strict)**, never Flexible. Flexible plus a
   redirect is the classic infinite loop: the edge talks http to the origin, and
   the origin redirects it back to https forever.

### HSTS ramp

1. Week 1: `max-age` = 1 week. Watch for anything that only works over http.
2. After a clean week, raise it to **6 months** (15768000).
3. **includeSubDomains** and **preload** stay **off** until every subdomain on
   the zone is inventoried and confirmed https-only. Preload is effectively
   irreversible: removal from browser preload lists takes months, and during
   that time any http-only subdomain is unreachable for everyone.

## Verify

```bash
curl -sI http://kedaipal.com/ | grep -iE '^HTTP|^location'
```

Expect `301` and `Location: https://kedaipal.com/`.

```bash
curl -sI 'http://kedaipal.com/some-slug/p/abc?ref=wa' | grep -i '^location'
```

Expect the identical URL on https.

```bash
curl -sI https://kedaipal.com/ | grep -i '^strict-transport-security'
```

Expect `max-age=…` once step 2 is on.

To test the **guard** on its own (with the edge toggle off), request the
Worker's `*.workers.dev` URL over http. Zone settings never apply there, so a
301 from it can only have come from the guard.

## Scope notes

- **Webhooks are unaffected.** `/webhook/whatsapp` and `/webhook/hitpay` live on
  Convex's `*.convex.site`, which is https-only and never passes through the
  Worker.
- **`www.kedaipal.com` has no DNS record**, so it is not covered because it does
  not exist. Adding it means a DNS record plus a redirect to the apex, and it
  falls under the HSTS includeSubDomains inventory above.
- **There is no separate staging web origin.** CI deploys the Worker only from
  `main` (`.github/workflows/deploy.yml`), and staging is Convex dev plus local
  dev. "Same checks on staging" therefore means the unit tests and the
  `*.workers.dev` check. If a staging web origin is ever added, run the curl
  checks against it as well.
