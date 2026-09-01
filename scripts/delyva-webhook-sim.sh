#!/usr/bin/env bash
# Simulate a Delyva courier status webhook against a Convex deployment.
#
# A DEMO Delyva account never dispatches a real courier, so no real tracking
# events ever arrive — this is how you drive a booked order through its
# lifecycle while testing (ClickUp 86eyjpv6z). It signs the body exactly the
# way Delyva does (base64 HMAC-SHA256 of the RAW body with the account's
# apiSecret), so it exercises the real signature check rather than bypassing it.
#
# Usage:
#   DELYVA_API_SECRET=<uuid> ./scripts/delyva-webhook-sim.sh <delyvaOrderId> <statusCode> [consignmentNo]
#
# Status codes (see docs/delivery-delyva.md):
#   100  order created      → job "Booked"      (carries the AWB)
#   200  courier accepted   → "Courier assigned"
#   400  start collecting   → "Courier assigned"
#   500  COLLECTED          → order becomes SHIPPED
#   600  out for delivery   → "In transit"
#   650  delivery FAILED    → reason shown, job stays in transit (not terminal)
#   700  COMPLETED          → order becomes DELIVERED
#   900  cancelled          → job cancelled
#   475  failed collection  → job rejected
set -euo pipefail

SITE_URL="${CONVEX_SITE_URL:-https://qualified-chihuahua-441.convex.site}"
SECRET="${DELYVA_API_SECRET:?Set DELYVA_API_SECRET (Delyva → GET /user → apiSecret)}"
ORDER_ID="${1:?Delyva order id (providerOrderId on the deliveryJobs row)}"
STATUS="${2:?Delyva statusCode, e.g. 500}"
AWB="${3:-}"

BODY="{\"orderId\":\"${ORDER_ID}\",\"statusCode\":${STATUS}"
[ -n "$AWB" ] && BODY="${BODY},\"consignmentNo\":\"${AWB}\""
BODY="${BODY},\"date\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"

SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

echo "→ POST ${SITE_URL}/webhook/delyva"
echo "  ${BODY}"
curl -sS -w '\n← HTTP %{http_code}\n' -X POST "${SITE_URL}/webhook/delyva" \
  -H 'Content-Type: application/json' \
  -H "X-Delyvax-Hmac-SHA256: ${SIG}" \
  -H 'X-Delyvax-Event: order_tracking.update' \
  --data-binary "$BODY"
