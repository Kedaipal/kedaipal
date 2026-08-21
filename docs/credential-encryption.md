# BYO credential encryption at rest (2026-08-17, ClickUp 86eyn25gk)

**Status: implemented.** The four BYO third-party secrets — `retailers.hitpay.{apiKey,salt}`
and `retailers.deliveryBooking.{apiKey,apiSecret}` — are envelope-encrypted at
rest with AES-256-GCM. They move sellers' **money** (the HitPay key mints
payment requests, the salt signs webhooks, the Lalamove pair books paid trips
from the seller's wallet), and the PDPA 2024 amendments made a data incident a
notifiable breach — plaintext credentials put every connected seller's payment
rails inside that blast radius.

## The shape

- **Format:** `enc.v1.<iv-base64>.<ciphertext-base64>` — 12-byte random IV,
  authenticated (tampering fails decryption loudly). One pure module owns it:
  [`convex/lib/credentialCrypto.ts`](../convex/lib/credentialCrypto.ts)
  (`encryptSecret` / `decryptSecret` / sync `isEncrypted`).
- **Key:** env `CREDENTIALS_ENCRYPTION_KEY` = base64 of 32 random bytes.

```
openssl rand -base64 32
npx convex env set CREDENTIALS_ENCRYPTION_KEY <value>          # dev
npx convex env set CREDENTIALS_ENCRYPTION_KEY <value> --prod   # production
```

## Where crypto runs (the load-bearing decision)

`crypto.subtle` is proven in this repo only in **actions and http actions**
(every webhook HMAC). So:

- **Mutations never encrypt.** `retailers.updateSettings` stores what it was
  given, stamps the plaintext-derived display fields (below), and schedules
  `internal.credentials.encryptRetailerCredentials` — which reads the row,
  encrypts, and writes back through a **compare-and-swap** mutation
  (`storeEncryptedCredentials`: only the exact plaintext the action read is
  replaced, so a save racing in between wins and its own scheduled encryption
  covers the newer key). The scheduled call carries **only the retailerId** —
  scheduled-function args persist in system tables, so no secret ever rides
  one.
- **Queries never decrypt.** Internal queries hand the stored (possibly
  encrypted) values to their consuming action untouched; presence checks
  (`hasCredentials`, enable gates) work on ciphertext.
- **Actions decrypt at the point of use.** Lalamove has one choke point —
  `callLalamove` runs `decryptLalamoveCredentials` before every request — so
  every quote/book/POD/cancel/probe caller is covered at once. HitPay decrypts
  in `deletePaymentRequest`, `fetchSettledPayment`, `refreshAccountMethods`
  and `createCheckout`. The two webhook routes decrypt the verifying secret
  (`decryptSecret`) right before HMAC verification.

## Derived fields move to save time

Sandbox-vs-production **mode** and the settings-card **last-4 hint** used to be
derived from the key at read time — impossible once the stored value is
ciphertext (whose prefix would always read "production", pointing sandbox keys
at live hosts). So:

- `hitpay.mode` + `hitpay.apiKeyHint` + `deliveryBooking.apiKeyHint` +
  `deliveryBooking.env` are **stamped at save** from the typed plaintext (and
  by the backfills for legacy rows). Summaries read the stored values, falling
  back to deriving only on a legacy still-plaintext row.
- `deliveryBooking.env` was added later (21 Aug, `86eypncfy`) — Lalamove had no
  counterpart to `hitpay.mode`, so a seller on sandbox keys had **no way to
  find out**, which cost a paying vendor two weeks of un-dispatchable orders.
  See [`delivery-lalamove.md`](./delivery-lalamove.md#which-environment-am-i-in-21-aug-2026-clickup-86eypncfy).
- The decrypt helpers (`decryptHitpayCredentials` /
  `decryptLalamoveCredentials`) **re-infer** mode/env from the decrypted
  plaintext — never trust a pre-decrypt inference (pinned by tests in both lib
  suites).

## Deploy-order safety (widen → migrate)

- Env key **unset** → `encryptSecret` passes plaintext through: a deployment
  without the key behaves exactly like before this change.
- `decryptSecret` passes non-`enc.v1.` values through, so **legacy plaintext
  rows keep working** until the backfill runs.
- Ciphertext with the key unset/wrong **fails closed** with an error naming
  the env var — never silent garbage to a provider.

**Rollout per deployment:** set `CREDENTIALS_ENCRYPTION_KEY`, deploy, then run
the one-shot:

```
npx convex run credentials:encryptExistingCredentials
```

Idempotent (encrypted fields are skipped), paginated house-style, also stamps
`apiKeyHint`/`mode`/`env` on legacy rows.

**Second one-shot, for deployments where the above ALREADY ran:**

```
npx convex run credentials:backfillLalamoveEnv
```

`deliveryBooking.env` postdates the encryption rollout, so on those deployments
every Lalamove row is already ciphertext and the encrypt backfill can no longer
stamp it (it only ever touched plaintext). This one decrypts each stored key
solely to read its `pk_test_`/`pk_prod_` prefix and writes back the verdict —
the plaintext is never stored, logged or returned, and an undecryptable key
leaves `env` unset rather than guessing. Skipping it leaves every existing
Lalamove seller reading as "environment unknown", which suppresses the sandbox
warning entirely.

**Losing the key strands every encrypted credential** — sellers would re-paste their keys (they own them); store the
key wherever the other Convex prod secrets live.

## Known behaviour changes

- Re-typing the *same* HitPay key now reads as "key changed" (plaintext vs
  stored ciphertext), so the probed method list resets and the connect probe
  refires — it repopulates in seconds, matching the rotate-keys flow.
- `keyChanged` semantics, both-or-neither validation, Pro gates, pause/resume
  key preservation: all unchanged.

Tests: `convex/lib/credentialCrypto.test.ts` (round-trip, IV freshness,
fail-closed paths, tamper), `convex/hitpay.test.ts` ("credentials encrypted at
rest" — connect → encrypt → summary + signed webhook E2E, plus the
key-unset plaintext era), `convex/lalamove.test.ts` (encrypted webhook-secret
resolution), both lib suites (mode re-inference).
