# Dev scripts — `scripts/`

One-off developer tooling that lives in the repo so any dev can run it.
Nothing here ships to production or runs at build time automatically; each
script is invoked by hand. None of them read or store secrets in the repo —
credentials come from flags or env vars at run time.

| Script | What it does | Typical trigger |
| --- | --- | --- |
| `lalamove-simulate-webhook.mjs` | Replays a **signed** Lalamove webhook to the dev deployment so a booking can be walked through its lifecycle without a real rider | Testing the Lalamove delivery flow locally |
| `generate-og-image.mjs` | Regenerates the social-share OG image (1200×630) at `public/og-image.png` from the brand lockup | After changing the hero headline or brand assets |
| `optimize-images.mjs` | Emits responsive AVIF/WebP variants of landing-page assets from `assets/landing/` into `public/img/landing/` (`pnpm optimize:images`) | After adding/updating a landing asset |

## `lalamove-simulate-webhook.mjs`

Lalamove's sandbox never dispatches a real rider, so `PICKED_UP` /
`COMPLETED` — and therefore Kedaipal's automatic `shipped` / `delivered`
transitions — never fire naturally. This script signs a webhook exactly the
way Lalamove does (HMAC-SHA256 over `ts\r\nPOST\r\n<path>\r\n\r\n<body>`)
and POSTs it to the deployment's `/webhook/lalamove` route, so the full
pipeline (signature verification → idempotent event application → order
transition → buyer WhatsApp) runs for real.

**Sandbox-only by construction:** it refuses to run unless the supplied API
key is a `pk_test_…` key, so it can never sign against or post to a
production booking.

### Usage

```bash
node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs \
  <providerOrderId> <STEP> --key pk_test_xxxx --secret sk_test_xxxx
```

- **Credentials**: `--key` / `--secret` flags, or `LALAMOVE_API_KEY` /
  `LALAMOVE_API_SECRET` env vars (flags win). Use the same sandbox pair the
  test store has saved under Settings → Fulfilment → Delivery charge →
  Lalamove — the webhook route verifies the signature against the job's
  stored secret, so a mismatched pair gets a 401.
- **Deployment URL**: derived from `VITE_CONVEX_URL` in `.env.local`
  (`…convex.cloud` → `…convex.site`) via `--env-file`; override with
  `CONVEX_SITE_URL` or `LALAMOVE_WEBHOOK_URL` if needed.
- **`<providerOrderId>`**: `deliveryJobs.providerOrderId` of the booking —
  Convex dashboard → Data → `deliveryJobs`, newest row, right after tapping
  "Book delivery".

### Steps

| `<STEP>` | Fires | Effect |
| --- | --- | --- |
| `driver` | `DRIVER_ASSIGNED` | Rider name/plate + tracking link fill in on the order card |
| `ON_GOING` | `ORDER_STATUS_CHANGED` | Job pill → "Rider on the way" (order unchanged — rider is heading to the *vendor*) |
| `PICKED_UP` | `ORDER_STATUS_CHANGED` | **Order → `shipped`**, buyer gets the WhatsApp shipped message with live tracking |
| `COMPLETED` | `ORDER_STATUS_CHANGED` | **Order → `delivered`**, buyer gets the delivered message; also triggers the proof-of-delivery photo fetch |
| `POD` | `POD_STATUS_CHANGED` | Triggers the proof-of-delivery fetch path (sandbox has no rider photo, so this exercises the trigger only — see below for injecting a stand-in photo) |
| `CANCELED` / `EXPIRED` / `REJECTED` | `ORDER_STATUS_CHANGED` | Job fails with a reason → amber card + one-tap rebook; the order never regresses |

Typical walk-through after tapping "Book delivery" on a confirmed delivery
order: `driver` → `ON_GOING` → `PICKED_UP` → `COMPLETED`.

**Heads-up:** `PICKED_UP` and `COMPLETED` send **real WhatsApp messages** to
the order's buyer number — use your own number as the test buyer to see
them land. Re-running a step is a harmless no-op (each run stamps a fresh
timestamp and the event handler is idempotent).

### Testing the proof-of-delivery photo locally

Lalamove's sandbox has no riders, so a real POD photo can never be fetched
there — `<STEP> POD` above only exercises the fetch *trigger* (it comes back
empty). To actually see the photo on all its surfaces, inject a stand-in
through the **same** post-parse pipeline a real photo takes:

```bash
npx convex run lalamove:devInjectPodImage '{"providerOrderId":"<providerOrderId>"}'
# custom image instead of the random placeholder:
npx convex run lalamove:devInjectPodImage '{"providerOrderId":"…","imageUrl":"https://…/photo.jpg"}'
```

- **`<providerOrderId>`**: same as the simulator — `deliveryJobs.providerOrderId`
  (Convex dashboard → Data → `deliveryJobs`), on a **completed** booking.
- **No Lalamove credentials needed** — it downloads a placeholder (or your
  `imageUrl`) instead of calling `GET /v3/orders`, so any dev can run it.
- Internal function, so it runs via `npx convex run` (CLI) / the Convex
  dashboard only — clients can't call it.

After running, the injected photo appears on **all three** real surfaces:
1. the buyer's **WhatsApp** (a photo follow-up to the delivered message),
2. the buyer's **tracking page** (`/track/<token>` → "Delivery photo" card),
3. the vendor's **order detail** (thumbnails on the delivered Lalamove card).

The **real** rider photo appearing end-to-end (via the actual `GET /v3/orders`
fetch) remains a first-prod-booking check.

Full feature context: [`delivery-lalamove.md`](./delivery-lalamove.md).
