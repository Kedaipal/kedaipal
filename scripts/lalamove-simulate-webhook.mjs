#!/usr/bin/env node
// Lalamove SANDBOX webhook simulator — replays a signed Lalamove webhook to a
// Kedaipal deployment so a dev can walk a booking through its lifecycle
// (ASSIGNING_DRIVER → ON_GOING → PICKED_UP → COMPLETED, plus the failure paths)
// WITHOUT a real rider. Lalamove's sandbox never dispatches one, so PICKED_UP /
// COMPLETED (and therefore our shipped/delivered auto-transitions) never fire
// naturally — this fires them for you.
//
// SANDBOX ONLY. It refuses to run unless the API key is a `pk_test_…` key, so
// it can never sign against, or post to, a production booking.
//
// ── Setup ────────────────────────────────────────────────────────────────────
// Supply the SAME sandbox credentials the test store has saved under Settings →
// Fulfilment → Delivery charge → Lalamove (the signature must match what the
// webhook route verifies with). The deployment URL is read from your
// .env.local via Node's --env-file:
//
//   export LALAMOVE_API_KEY=pk_test_xxxxxxxx
//   export LALAMOVE_API_SECRET=sk_test_xxxxxxxx
//
// ── Usage ────────────────────────────────────────────────────────────────────
//   node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs <providerOrderId> <STEP>
//
//   <providerOrderId>  deliveryJobs.providerOrderId of the booking
//                      (Convex dashboard → Data → deliveryJobs → newest row)
//   <STEP>             driver | ON_GOING | PICKED_UP | COMPLETED
//                      | CANCELED | EXPIRED | REJECTED
//                        driver     → DRIVER_ASSIGNED (fills rider + tracking link)
//                        ON_GOING   → job pill "Rider on the way"
//                        PICKED_UP  → order → `shipped`   (real WhatsApp to buyer)
//                        COMPLETED  → order → `delivered` (real WhatsApp to buyer)
//                        CANCELED/EXPIRED/REJECTED → job fails + one-tap rebook
//
// Typical walk-through after tapping "Book delivery":
//   node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs 3545… driver
//   node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs 3545… ON_GOING
//   node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs 3545… PICKED_UP
//   node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs 3545… COMPLETED
//
// Each run stamps a fresh timestamp, so re-running the same step is a harmless
// no-op and you never have to bump anything by hand.
import { createHmac, randomUUID } from "node:crypto";

const API_KEY = process.env.LALAMOVE_API_KEY;
const API_SECRET = process.env.LALAMOVE_API_SECRET;

// Webhook host: explicit override wins, else derive from the Convex deployment
// URL (…convex.cloud → …convex.site, where HTTP actions live).
const convexUrl = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
const siteBase =
	process.env.LALAMOVE_WEBHOOK_URL?.replace(/\/webhook\/lalamove\/?$/, "") ??
	process.env.CONVEX_SITE_URL ??
	convexUrl?.replace(/\.convex\.cloud\/?$/, ".convex.site");

const [providerOrderId, step] = process.argv.slice(2);

function fail(msg) {
	console.error(`✖ ${msg}`);
	process.exit(1);
}

if (!API_KEY || !API_SECRET)
	fail(
		"Set LALAMOVE_API_KEY and LALAMOVE_API_SECRET — the sandbox pk_test_/sk_test_ pair your test store has saved.",
	);
if (!API_KEY.startsWith("pk_test_"))
	fail(
		"Refusing to run: LALAMOVE_API_KEY is not a sandbox key (pk_test_…). This tool is sandbox-only and must never touch production.",
	);
if (!siteBase)
	fail(
		"No Convex site URL. Pass --env-file=.env.local (loads VITE_CONVEX_URL) or set CONVEX_SITE_URL / LALAMOVE_WEBHOOK_URL.",
	);
if (!providerOrderId || !step)
	fail(
		"Usage: node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs <providerOrderId> <driver|ON_GOING|PICKED_UP|COMPLETED|CANCELED|EXPIRED|REJECTED>",
	);

const PATH = "/webhook/lalamove";
const WEBHOOK = `${siteBase.replace(/\/$/, "")}${PATH}`;
const share = `https://share.sandbox.lalamove.com/?MYTEST${providerOrderId}`;
const now = new Date().toISOString();

let eventType;
let data;
if (step.toLowerCase() === "driver") {
	eventType = "DRIVER_ASSIGNED";
	data = {
		order: { orderId: providerOrderId, shareLink: share },
		driver: {
			driverId: "9999",
			name: "Rahim (simulated)",
			phone: "+60111111111",
			plateNumber: "WXY 1234",
		},
		updatedAt: now,
	};
} else {
	eventType = "ORDER_STATUS_CHANGED";
	const status = step.toUpperCase();
	data = {
		order: {
			orderId: providerOrderId,
			status,
			shareLink: share,
			...(status === "CANCELED"
				? { cancelReason: "Simulated cancellation" }
				: {}),
		},
		updatedAt: now,
	};
}

// Signature = HMAC-SHA256 over `<ts>\r\nPOST\r\n<path>\r\n\r\n<JSON body>` with
// the sandbox secret — the exact scheme convex/lib/lalamove verifies.
const timestamp = Date.now();
const signature = createHmac("sha256", API_SECRET)
	.update(`${timestamp}\r\nPOST\r\n${PATH}\r\n\r\n${JSON.stringify(data)}`)
	.digest("hex");

const body = JSON.stringify({
	apiKey: API_KEY,
	timestamp,
	signature,
	eventId: randomUUID(),
	eventType,
	eventVersion: "v3",
	data,
});

const res = await fetch(WEBHOOK, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body,
});
console.log(`${eventType} (${step}) → ${WEBHOOK}`);
console.log(`HTTP ${res.status}: ${await res.text()}`);
if (["PICKED_UP", "COMPLETED"].includes(step.toUpperCase()))
	console.log(
		"⚠ This step really sends a WhatsApp message to the order's buyer number.",
	);
