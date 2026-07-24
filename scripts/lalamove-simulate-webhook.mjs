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
// webhook route verifies with) — either as --key/--secret flags on the command
// or LALAMOVE_API_KEY/LALAMOVE_API_SECRET env vars. The deployment URL is read
// from your .env.local via Node's --env-file.
//
// ── Usage ────────────────────────────────────────────────────────────────────
//   node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs \
//     <providerOrderId> <STEP> --key pk_test_xxxx --secret sk_test_xxxx
//
//   <providerOrderId>  deliveryJobs.providerOrderId of the booking
//                      (Convex dashboard → Data → deliveryJobs → newest row)
//   <STEP>             driver | ON_GOING | PICKED_UP | COMPLETED | POD
//                      | CANCELED | EXPIRED | REJECTED
//                        driver     → DRIVER_ASSIGNED (fills rider + tracking link)
//                        ON_GOING   → job pill "Rider on the way"
//                        PICKED_UP  → order → `shipped`   (real WhatsApp to buyer)
//                        COMPLETED  → order → `delivered` (real WhatsApp to buyer)
//                        POD        → POD_STATUS_CHANGED (proof-of-delivery
//                                     trigger — sandbox has no rider photo, so
//                                     this exercises the fetch path only)
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

// Args: positionals (<providerOrderId> <STEP>) plus optional --key/--secret
// flags, so any dev can run it without exporting env vars first. Flags win
// over LALAMOVE_API_KEY / LALAMOVE_API_SECRET env.
const positional = [];
const flags = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === "--key" || argv[i] === "--secret") {
		flags[argv[i].slice(2)] = argv[++i];
	} else {
		positional.push(argv[i]);
	}
}
const API_KEY = flags.key ?? process.env.LALAMOVE_API_KEY;
const API_SECRET = flags.secret ?? process.env.LALAMOVE_API_SECRET;

// Webhook host: explicit override wins, else derive from the Convex deployment
// URL (…convex.cloud → …convex.site, where HTTP actions live).
const convexUrl = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
const siteBase =
	process.env.LALAMOVE_WEBHOOK_URL?.replace(/\/webhook\/lalamove\/?$/, "") ??
	process.env.CONVEX_SITE_URL ??
	convexUrl?.replace(/\.convex\.cloud\/?$/, ".convex.site");

const [providerOrderId, step] = positional;

function fail(msg) {
	console.error(`✖ ${msg}`);
	process.exit(1);
}

if (!API_KEY || !API_SECRET)
	fail(
		"Supply the sandbox pk_test_/sk_test_ pair your test store has saved — either --key/--secret flags or LALAMOVE_API_KEY/LALAMOVE_API_SECRET env vars.",
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
		"Usage: node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs <providerOrderId> <driver|ON_GOING|PICKED_UP|COMPLETED|POD|CANCELED|EXPIRED|REJECTED> [--key pk_test_…] [--secret sk_test_…]",
	);

const PATH = "/webhook/lalamove";
const WEBHOOK = `${siteBase.replace(/\/$/, "")}${PATH}`;
const share = `https://share.sandbox.lalamove.com/?MYTEST${providerOrderId}`;
const now = new Date().toISOString();

let eventType;
let data;
if (step.toUpperCase() === "POD") {
	// Proof-of-delivery trigger. NOTE: the handler responds by fetching
	// GET /v3/orders from the REAL sandbox, which never has a rider photo —
	// so this exercises the trigger path only; the image itself can only be
	// verified on a production booking.
	eventType = "POD_STATUS_CHANGED";
	data = {
		order: { orderId: providerOrderId },
		updatedAt: now,
	};
} else if (step.toLowerCase() === "driver") {
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
