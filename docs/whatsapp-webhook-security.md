# WhatsApp Webhook Signature Verification — Implementation Reference

Reference doc for inbound webhook authenticity. **Implemented and shipped.**

## Context (2026-05-24)

The inbound webhook at `POST /webhook/whatsapp` (`convex/http.ts`) **mutates state** — it confirms orders, stamps customer phone numbers, captures pushnames, and updates customer aggregates. Before this change it processed any JSON body with no authenticity check, so anyone who discovered the URL could POST a forged payload to confirm orders, inject phone numbers, and pollute the customer database. The shared-WABA quality rating is a cross-retailer resource, which raises the stakes further.

## What got built

Meta signs every webhook delivery:

```
X-Hub-Signature-256: sha256=HMAC_SHA256(rawRequestBody, APP_SECRET)
```

The handler now verifies this before acting:

1. Read the **raw body** (`req.text()`) — must be the exact bytes Meta signed; never re-serialize.
2. If `WHATSAPP_APP_SECRET` is unset → **fail closed** with `500` (operator error; Meta will retry 5xx).
3. Recompute the HMAC and constant-time compare against the header → `401` on mismatch.
4. Only then `JSON.parse` the already-verified raw body and dispatch.

### Files

| Path | Purpose |
|---|---|
| `convex/lib/whatsappSignature.ts` | `verifyMetaSignature` + `computeMetaSignature` using Web Crypto (`crypto.subtle`) — edge-runtime compatible, no Convex imports, constant-time compare, case-normalized |
| `convex/http.ts` | POST handler reads raw body, verifies, fails closed / rejects, then parses |
| `convex/lib/whatsappSignature.test.ts` | 9 unit tests (valid, wrong secret, tampered body, missing/empty/malformed header, hex-case) |
| `convex/http.test.ts` | 5 integration tests via `t.fetch` (missing/invalid/wrong-secret → 401, valid → 200, missing secret → 500) |

Web Crypto (not Node `crypto`) because Convex `httpAction`s run on the edge runtime.

## The three WhatsApp credentials (don't confuse them)

| Credential | Direction | Purpose | Used in |
|---|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | You → Meta (outbound) | Bearer auth for *your* Cloud API calls | `Authorization` header of `sendText`/`sendImage` |
| `WHATSAPP_VERIFY_TOKEN` | Meta → You (one-time) | Confirms endpoint ownership at subscription | The initial **GET** handshake only — not on POSTs |
| `WHATSAPP_APP_SECRET` | Meta → You (inbound) | Lets Meta sign each webhook so you can verify it | The **POST** signature check (this feature) |

The access token can't authenticate inbound webhooks: Meta never sends it back to you, and a forger doesn't need it. The verify token only appears on the GET handshake, not per-message POSTs. Signature verification genuinely requires the app secret.

## Env requirements

`WHATSAPP_APP_SECRET` — from **Meta App Dashboard → App settings → Basic → App Secret**.

> ⚠️ The handler **fails closed**. Set this in the Convex deployment env *before* deploying, or the webhook returns `500` and orders stop confirming.

```
npx convex env set WHATSAPP_APP_SECRET <value>          # dev
npx convex env set WHATSAPP_APP_SECRET <value> --prod   # production
```

(Add it to `.env.local.example` alongside the other `WHATSAPP_*` vars.)

## Known limitations

- **Webhook POST path is not rate-limited.** Signature verification makes forgery infeasible, but a flood of unsigned requests still hits the verify path. Low risk (rejected cheaply at the edge); add a rate limit if abuse appears.
- **401 vs 403.** Mismatches return `401`; `403` is arguably more semantically precise but immaterial to Meta, which ignores failed-delivery response bodies.
