// WhatsApp message copy catalog. Pure — no Convex imports — to keep testable.

import { deriveMapsUrl } from "./mapsUrl";
import type { PaymentMethod } from "./payment";

export type Locale = "en" | "ms";

export type DeliveryMethod = "delivery" | "self_collect";

export type CopyVars = {
	shortId: string;
	storeName: string;
	contactPhone?: string;
	trackingUrl?: string;
	carrierTrackingUrl?: string;
	deliveryMethod?: DeliveryMethod;
	// The order's frozen pickup kind (pickupSnapshot.locationType). Only
	// meaningful when deliveryMethod is self_collect; undefined (legacy
	// snapshots / delivery orders) reads as self-collect, matching
	// renderPickupBlock. Drives "pickup" vs "drop-off point" wording.
	pickupKind?: PickupKind;
	/** Pre-formatted money string (e.g. "MYR 25.00") for messages that quote a total. */
	amount?: string;
	/** Short human pairing code (e.g. "K7") the walk-in buyer shows the cashier. */
	code?: string;
};

/** True when the order is fulfilled at a drop-off point (meetup), not the seller's place. */
function isDropOff(v: Pick<CopyVars, "deliveryMethod" | "pickupKind">): boolean {
	return v.deliveryMethod === "self_collect" && v.pickupKind === "drop_off";
}

export type StatusKey = "packed" | "shipped" | "delivered" | "cancelled";

type LocaleCopy = {
	confirm: (v: CopyVars) => string;
	status: Record<StatusKey, (v: CopyVars) => string>;
	unknownFallback: () => string;
};

function contactLine(contactPhone: string | undefined, locale: Locale): string {
	if (!contactPhone) return "";
	return locale === "ms"
		? `\nHubungi kami: wa.me/${contactPhone}`
		: `\nContact us: wa.me/${contactPhone}`;
}

export const waCopy: Record<Locale, LocaleCopy> = {
	en: {
		confirm: ({ shortId, storeName, contactPhone, trackingUrl, deliveryMethod, pickupKind }) => {
			const method = isDropOff({ deliveryMethod, pickupKind })
				? "We'll let you know when it's ready at the drop-off point."
				: deliveryMethod === "self_collect"
					? "We'll let you know when it's ready for pickup."
					: "We'll update you when it ships.";
			return `✅ Order ${shortId} confirmed. ${method} — ${storeName}${trackingUrl ? `\n\nTrack order & tap 'I've paid' to send receipt: ${trackingUrl}` : ""}${contactLine(contactPhone, "en")}`;
		},
		status: {
			packed: ({ shortId, trackingUrl, deliveryMethod, pickupKind }) => {
				const msg = isDropOff({ deliveryMethod, pickupKind })
					? `📦 Order ${shortId} is packed and ready for the drop-off point.`
					: deliveryMethod === "self_collect"
						? `📦 Order ${shortId} is packed and ready for pickup.`
						: `📦 Order ${shortId} is packed and ready to ship.`;
				return `${msg}${trackingUrl ? `\n\nTrack your order: ${trackingUrl}` : ""}`;
			},
			shipped: ({ shortId, carrierTrackingUrl, trackingUrl, deliveryMethod, pickupKind }) => {
				if (isDropOff({ deliveryMethod, pickupKind })) {
					return `📍 Order ${shortId} is ready — see you at the drop-off point!${trackingUrl ? `\n\nOrder status: ${trackingUrl}` : ""}`;
				}
				if (deliveryMethod === "self_collect") {
					return `🏪 Order ${shortId} is ready for pickup!${trackingUrl ? `\n\nOrder status: ${trackingUrl}` : ""}`;
				}
				return `🚚 Order ${shortId} is on the way!${carrierTrackingUrl ? `\n\nTrack shipment: ${carrierTrackingUrl}` : ""}${trackingUrl ? `\n\nOrder status: ${trackingUrl}` : ""}`;
			},
			delivered: ({ shortId, deliveryMethod }) => {
				if (deliveryMethod === "self_collect") {
					return `🎉 Order ${shortId} collected. Thank you!`;
				}
				return `🎉 Order ${shortId} delivered. Thank you!`;
			},
			cancelled: ({ shortId, contactPhone }) =>
				`❌ Order ${shortId} was cancelled. Contact us if this is unexpected.${contactLine(contactPhone, "en")}`,
		},
		unknownFallback: () =>
			"Hi! To place an order, browse our catalog and tap Checkout — you'll be sent back here with an order ID.",
	},
	ms: {
		confirm: ({ shortId, storeName, contactPhone, trackingUrl, deliveryMethod, pickupKind }) => {
			const method = isDropOff({ deliveryMethod, pickupKind })
				? "Kami akan maklumkan apabila sedia di lokasi penyerahan."
				: deliveryMethod === "self_collect"
					? "Kami akan maklumkan apabila sedia untuk diambil."
					: "Kami akan maklumkan apabila dihantar.";
			return `✅ Pesanan ${shortId} telah disahkan. ${method} — ${storeName}${trackingUrl ? `\n\nJejak pesanan & tekan 'I've paid' untuk hantar resit: ${trackingUrl}` : ""}${contactLine(contactPhone, "ms")}`;
		},
		status: {
			packed: ({ shortId, trackingUrl, deliveryMethod, pickupKind }) => {
				const msg = isDropOff({ deliveryMethod, pickupKind })
					? `📦 Pesanan ${shortId} sudah dibungkus dan sedia untuk ke lokasi penyerahan.`
					: deliveryMethod === "self_collect"
						? `📦 Pesanan ${shortId} sudah dibungkus dan sedia untuk diambil.`
						: `📦 Pesanan ${shortId} sudah dibungkus dan sedia untuk dihantar.`;
				return `${msg}${trackingUrl ? `\n\nJejak pesanan anda: ${trackingUrl}` : ""}`;
			},
			shipped: ({ shortId, carrierTrackingUrl, trackingUrl, deliveryMethod, pickupKind }) => {
				if (isDropOff({ deliveryMethod, pickupKind })) {
					return `📍 Pesanan ${shortId} sedia — jumpa di lokasi penyerahan!${trackingUrl ? `\n\nStatus pesanan: ${trackingUrl}` : ""}`;
				}
				if (deliveryMethod === "self_collect") {
					return `🏪 Pesanan ${shortId} sedia untuk diambil!${trackingUrl ? `\n\nStatus pesanan: ${trackingUrl}` : ""}`;
				}
				return `🚚 Pesanan ${shortId} dalam perjalanan!${carrierTrackingUrl ? `\n\nJejak penghantaran: ${carrierTrackingUrl}` : ""}${trackingUrl ? `\n\nStatus pesanan: ${trackingUrl}` : ""}`;
			},
			delivered: ({ shortId, deliveryMethod }) => {
				if (deliveryMethod === "self_collect") {
					return `🎉 Pesanan ${shortId} telah diambil. Terima kasih!`;
				}
				return `🎉 Pesanan ${shortId} telah sampai. Terima kasih!`;
			},
			cancelled: ({ shortId, contactPhone }) =>
				`❌ Pesanan ${shortId} telah dibatalkan. Hubungi kami jika ini tidak dijangka.${contactLine(contactPhone, "ms")}`,
		},
		unknownFallback: () =>
			"Hai! Untuk membuat pesanan, layari katalog kami dan tekan Checkout — anda akan dikembalikan ke sini dengan ID pesanan.",
	},
};

export function pickLocale(input: string | undefined | null): Locale {
	if (input === "ms") return "ms";
	return "en";
}

// ---------------------------------------------------------------------------
// System messages — locale-aware, NOT retailer-overridable.
//
// Used for messages the platform must send verbatim (e.g., the transfer
// reference instruction in the confirm reply, or the payment-received
// notification). Kept separate from the override-able catalog so retailers
// can't break payment matching by editing a template.
// ---------------------------------------------------------------------------

export type SystemMessageKey =
	| "paymentReceived"
	| "transferReferenceLine"
	| "mockupPendingConfirm"
	| "paymentDueApproved"
	| "paymentDueWaived"
	| "paymentDueDeclined"
	| "counterCheckoutPaymentIntro"
	| "storeQrConnected"
	| "storeQrBusy"
	| "counterOrderConfirmedPaid"
	| "counterOrderConfirmedUnpaid"
	| "orderReceiptCaption"
	| "orderInvoiceCaption"
	| "paymentReminder";

type SystemCopy = {
	paymentReceived: (v: CopyVars) => string;
	transferReferenceLine: (v: CopyVars) => string;
	// Confirm reply for an order that still has a custom item awaiting buyer
	// mockup approval — payment is intentionally deferred (no "I've paid" yet).
	mockupPendingConfirm: (v: CopyVars) => string;
	// Intro lines that lead the payment prompt once the mockup gate opens, either
	// by buyer approval, seller waiver, or the buyer removing the custom item from
	// a mixed order (the ready-made remainder is now payable). Payment block follows.
	paymentDueApproved: (v: CopyVars) => string;
	paymentDueWaived: (v: CopyVars) => string;
	paymentDueDeclined: (v: CopyVars) => string;
	// Counter Checkout (docs/counter-checkout.md): the two `counterOrderConfirmed*`
	// messages carry the confirmed order + tracking link (paid vs pay-later branch)
	// so the buyer never has to scan again to pay.
	// Sent right after the store-QR connect ack: leads the retailer's payment
	// methods block so a counter buyer can pay ahead (even before the cashier
	// finishes) instead of waiting for the details at the end. The
	// `renderPaymentMethods` block (with its own "💳 Payment details" header + QR
	// images) follows. See docs/counter-checkout.md.
	counterCheckoutPaymentIntro: (v: CopyVars) => string;
	// Store QR poster (86ey5m35w / 86ey5neg6 — the ONLY counter QR): a buyer
	// scanned the seller's PERMANENT printed QR. `storeQrConnected` acks the
	// walk-in session, gives the buyer their `code` (a short pairing code they
	// show the cashier so it's matched in the open-checkouts list), and carries
	// the PDPA notice-at-collection privacy link (a poster buyer never touches the
	// website before their number is stored). `storeQrBusy` is the polite over-cap
	// / rate-limited reply.
	storeQrConnected: (v: CopyVars) => string;
	storeQrBusy: (v: CopyVars) => string;
	counterOrderConfirmedPaid: (v: CopyVars) => string;
	counterOrderConfirmedUnpaid: (v: CopyVars) => string;
	// Captions for the receipt / invoice PDF the seller sends to the buyer's
	// WhatsApp from the counter Done screen (ticket 86ey4fz3w).
	orderReceiptCaption: (v: CopyVars) => string;
	orderInvoiceCaption: (v: CopyVars) => string;
	// One-time nudge sent 3 days before the 14-day open-payment window closes
	// on an order whose payment was never claimed/received. See
	// docs/payment-reminder.md. Not retailer-overridable (system copy).
	paymentReminder: (v: CopyVars) => string;
};

export const systemMessages: Record<Locale, SystemCopy> = {
	en: {
		paymentReceived: ({ shortId, storeName, trackingUrl }) =>
			`✅ Payment received for ${shortId}. ${storeName} is preparing your order.${
				trackingUrl ? `\n\nTrack: ${trackingUrl}` : ""
			}`,
		transferReferenceLine: ({ shortId }) =>
			`Use ${shortId} as your transfer reference so we can match it.`,
		mockupPendingConfirm: ({ shortId, storeName, contactPhone, trackingUrl }) =>
			`✅ Order ${shortId} received! It includes a custom item, so ${storeName} will send you a design to approve first — no payment needed yet. We'll share payment details right after you approve.${
				trackingUrl ? `\n\nTrack your order: ${trackingUrl}` : ""
			}${contactLine(contactPhone, "en")}`,
		paymentDueApproved: ({ shortId, storeName }) =>
			`✅ Design approved for ${shortId}! Here's how to pay so ${storeName} can start making it:`,
		paymentDueWaived: ({ shortId, storeName }) =>
			`Here are the payment details for your order ${shortId} from ${storeName}:`,
		paymentDueDeclined: ({ shortId, storeName }) =>
			`No problem — the custom item was removed from ${shortId}. Here's how to pay for the rest of your order from ${storeName}:`,
		counterCheckoutPaymentIntro: ({ storeName }) =>
			`💡 No need to wait for the cashier — you can pay ${storeName} whenever you're ready, even now.`,
		storeQrConnected: ({ storeName, code }) =>
			`You're connected to ${storeName} 🎉${
				code ? ` Your order code is *${code}* — show it to the cashier so they can find you.` : ""
			} They'll ring up your order and your confirmation will land right here.\n\nBy continuing you agree to our Privacy Policy: https://kedaipal.com/privacy`,
		storeQrBusy: ({ storeName }) =>
			`${storeName} can't take new scans right now — please ask the cashier for help and they'll sort you out 🙂`,
		counterOrderConfirmedPaid: ({ shortId, storeName, amount, trackingUrl }) =>
			`🧾 All done! Order ${shortId} at ${storeName} is confirmed and paid${
				amount ? ` — total ${amount}` : ""
			}. Thank you! Keep your receipt & track your order here anytime: ${trackingUrl}`,
		counterOrderConfirmedUnpaid: ({ shortId, storeName, amount, trackingUrl }) =>
			`🧾 Thanks for your order at ${storeName}! Order ${shortId} is confirmed${
				amount ? ` — total ${amount} to pay whenever you're ready` : ""
			}. Pay and track everything here, no rush: ${trackingUrl}`,
		orderReceiptCaption: ({ shortId }) =>
			`Here's your receipt for order ${shortId} 🧾 Thanks for shopping with us!`,
		orderInvoiceCaption: ({ shortId }) =>
			`Here's your invoice for order ${shortId} 🧾 The payment details are inside.`,
		paymentReminder: ({ shortId, storeName, amount, trackingUrl, contactPhone }) =>
			`👋 Friendly reminder from ${storeName}: order ${shortId}${
				amount ? ` (${amount})` : ""
			} is still awaiting payment. Once you've paid, tap 'I've paid' so we can get it moving${
				trackingUrl ? `: ${trackingUrl}` : "."
			}${contactLine(contactPhone, "en")}`,
	},
	ms: {
		paymentReceived: ({ shortId, storeName, trackingUrl }) =>
			`✅ Pembayaran diterima untuk ${shortId}. ${storeName} sedang menyediakan pesanan anda.${
				trackingUrl ? `\n\nJejak: ${trackingUrl}` : ""
			}`,
		transferReferenceLine: ({ shortId }) =>
			`Gunakan ${shortId} sebagai rujukan pemindahan supaya kami boleh padankan.`,
		mockupPendingConfirm: ({ shortId, storeName, contactPhone, trackingUrl }) =>
			`✅ Pesanan ${shortId} diterima! Ia termasuk item custom, jadi ${storeName} akan menghantar reka bentuk untuk kelulusan anda dahulu — belum perlu bayar lagi. Kami akan kongsi maklumat pembayaran sebaik anda luluskan.${
				trackingUrl ? `\n\nJejak pesanan anda: ${trackingUrl}` : ""
			}${contactLine(contactPhone, "ms")}`,
		paymentDueApproved: ({ shortId, storeName }) =>
			`✅ Reka bentuk untuk ${shortId} telah diluluskan! Berikut cara membayar supaya ${storeName} boleh mula membuatnya:`,
		paymentDueWaived: ({ shortId, storeName }) =>
			`Berikut maklumat pembayaran untuk pesanan ${shortId} dari ${storeName}:`,
		paymentDueDeclined: ({ shortId, storeName }) =>
			`Tiada masalah — item custom telah dibuang dari ${shortId}. Berikut cara membayar untuk baki pesanan anda dari ${storeName}:`,
		counterCheckoutPaymentIntro: ({ storeName }) =>
			`💡 Tak perlu tunggu juruwang — anda boleh bayar ${storeName} bila-bila masa, walaupun sekarang.`,
		storeQrConnected: ({ storeName, code }) =>
			`Anda telah disambungkan dengan ${storeName} 🎉${
				code ? ` Kod pesanan anda ialah *${code}* — tunjukkan kepada juruwang supaya mereka boleh cari anda.` : ""
			} Mereka akan proses pesanan anda dan pengesahan akan sampai di sini.\n\nDengan meneruskan, anda bersetuju dengan Dasar Privasi kami: https://kedaipal.com/privacy`,
		storeQrBusy: ({ storeName }) =>
			`${storeName} tidak dapat menerima imbasan baharu buat masa ini — sila minta bantuan juruwang ya 🙂`,
		counterOrderConfirmedPaid: ({ shortId, storeName, amount, trackingUrl }) =>
			`🧾 Selesai! Pesanan ${shortId} di ${storeName} telah disahkan dan dibayar${
				amount ? ` — jumlah ${amount}` : ""
			}. Terima kasih! Simpan resit & jejak pesanan anda di sini bila-bila masa: ${trackingUrl}`,
		counterOrderConfirmedUnpaid: ({ shortId, storeName, amount, trackingUrl }) =>
			`🧾 Terima kasih atas pesanan anda di ${storeName}! Pesanan ${shortId} telah disahkan${
				amount ? ` — jumlah ${amount} untuk dibayar bila-bila anda sedia` : ""
			}. Bayar & jejak pesanan di sini, tak perlu tergesa-gesa: ${trackingUrl}`,
		orderReceiptCaption: ({ shortId }) =>
			`Ini resit untuk pesanan ${shortId} 🧾 Terima kasih kerana membeli-belah dengan kami!`,
		orderInvoiceCaption: ({ shortId }) =>
			`Ini invois untuk pesanan ${shortId} 🧾 Maklumat pembayaran ada di dalam.`,
		paymentReminder: ({ shortId, storeName, amount, trackingUrl, contactPhone }) =>
			`👋 Peringatan mesra daripada ${storeName}: pesanan ${shortId}${
				amount ? ` (${amount})` : ""
			} masih menunggu pembayaran. Selepas membayar, tekan 'I've paid' supaya kami boleh teruskan${
				trackingUrl ? `: ${trackingUrl}` : "."
			}${contactLine(contactPhone, "ms")}`,
	},
};

export function renderSystemMessage(
	locale: Locale,
	key: SystemMessageKey,
	vars: CopyVars,
): string {
	return systemMessages[locale][key](vars);
}

/**
 * Phase 2 — generic "your order moved to <stage>" update, sent when a seller
 * advances an order INTO a custom stage that shares its canonical anchor with
 * the previous one (i.e. no canonical status change, so the rich status
 * templates above don't fire) and the stage has `notify: true`. Anchor-CROSSING
 * moves keep using the existing `renderMessage` status copy (+ messageTemplates
 * overrides), so this never duplicates or replaces those. Not retailer-
 * overridable — the seller controls the wording via the stage label/description.
 */
export function renderStageUpdate(
	locale: Locale,
	args: {
		shortId: string;
		stageLabel: string;
		stageDescription?: string;
		trackingUrl?: string;
		// Courier link — present when the stage move carried one (shipped-anchored
		// crossings). Rendered as its own line so the buyer keeps the carrier
		// tracking even when the seller's stage copy replaces the canonical
		// "on the way" template.
		carrierTrackingUrl?: string;
		contactPhone?: string;
	},
): string {
	const desc = args.stageDescription?.trim()
		? `\n${args.stageDescription.trim()}`
		: "";
	const carrier = args.carrierTrackingUrl
		? locale === "ms"
			? `\n\nJejak penghantaran: ${args.carrierTrackingUrl}`
			: `\n\nTrack shipment: ${args.carrierTrackingUrl}`
		: "";
	const track = args.trackingUrl
		? locale === "ms"
			? `\n\nJejak pesanan anda: ${args.trackingUrl}`
			: `\n\nTrack your order: ${args.trackingUrl}`
		: "";
	const head =
		locale === "ms"
			? `📦 Kemaskini pesanan ${args.shortId}: ${args.stageLabel}.`
			: `📦 Order ${args.shortId} update: ${args.stageLabel}.`;
	return `${head}${desc}${carrier}${track}${contactLine(args.contactPhone, locale)}`;
}

// Matches ORD-XXXX where X is from the alphabet in lib/order.ts
// (excludes O, 0, I, 1). Reused by inbound parser to keep alphabet in sync.
export const SHORT_ID_REGEX = /ORD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}/;

// Per-retailer overrides. Any key omitted (or empty string after trim) falls
// back to the built-in catalog above.
export type TemplateKey = "confirm" | StatusKey | "unknownFallback";

export type LocaleOverrides = Partial<Record<TemplateKey, string | undefined>>;

export type MessageTemplates = Partial<Record<Locale, LocaleOverrides>>;

export const TEMPLATE_KEYS: ReadonlyArray<TemplateKey> = [
	"confirm",
	"packed",
	"shipped",
	"delivered",
	"cancelled",
	"unknownFallback",
];

export const TEMPLATE_MAX_LENGTH = 1000;

function interpolate(template: string, vars: CopyVars): string {
	return template
		.replaceAll("{shortId}", vars.shortId)
		.replaceAll("{storeName}", vars.storeName)
		.replaceAll("{contactPhone}", vars.contactPhone ?? "")
		.replaceAll("{trackingUrl}", vars.trackingUrl ?? "")
		.replaceAll("{carrierTrackingUrl}", vars.carrierTrackingUrl ?? "")
		.replaceAll("{deliveryMethod}", vars.deliveryMethod ?? "delivery");
}

function getDefault(locale: Locale, key: TemplateKey, vars: CopyVars): string {
	const c = waCopy[locale];
	if (key === "confirm") return c.confirm(vars);
	if (key === "unknownFallback") return c.unknownFallback();
	return c.status[key](vars);
}

/**
 * Render a message for a given locale + key. Uses retailer override if present
 * and non-empty, otherwise the default catalog. Variables `{shortId}` and
 * `{storeName}` are interpolated in both branches.
 */
/**
 * Whether the retailer explicitly authored an override for this locale+key.
 * Used by notifyStatusChange to keep an authored template winning over the
 * custom-stage wording (override > stage label/description > default catalog).
 */
export function hasTemplateOverride(
	overrides: MessageTemplates | undefined,
	locale: Locale,
	key: TemplateKey,
): boolean {
	const override = overrides?.[locale]?.[key];
	return Boolean(override && override.trim().length > 0);
}

export function renderMessage(
	overrides: MessageTemplates | undefined,
	locale: Locale,
	key: TemplateKey,
	vars: CopyVars,
): string {
	const override = overrides?.[locale]?.[key];
	if (override && override.trim().length > 0) {
		return interpolate(override, vars);
	}
	return getDefault(locale, key, vars);
}

/**
 * Default text for a locale+key with placeholder variables left in. Used by
 * the Settings UI as the textarea placeholder.
 */
export function defaultTemplate(locale: Locale, key: TemplateKey): string {
	return getDefault(locale, key, { shortId: "{shortId}", storeName: "{storeName}" });
}

// ---------------------------------------------------------------------------
// Payment instructions
// ---------------------------------------------------------------------------

const paymentLabels: Record<
	Locale,
	{
		header: string;
		bank: string;
		accountName: string;
		accountNumber: string;
		qrFollows: string;
		qrCaption: string;
	}
> = {
	en: {
		header: "💳 Payment details",
		bank: "Bank",
		accountName: "Name",
		accountNumber: "Account",
		qrFollows: "Scan the QR below 👇",
		qrCaption: "Scan to pay",
	},
	ms: {
		header: "💳 Maklumat pembayaran",
		bank: "Bank",
		accountName: "Nama",
		accountNumber: "Akaun",
		qrFollows: "Imbas QR di bawah 👇",
		qrCaption: "Imbas untuk bayar",
	},
};

/**
 * Render the payment block listing ALL configured methods as plain text. Each
 * method is a labelled sub-block (`*label*` — WhatsApp renders this bold):
 *  - `bank` → Bank / Name / Account-number-on-its-own-line (so a long-press
 *    selects just the number; the web track page has a one-tap copy too);
 *  - `qr` → a "scan the QR below" line — the image itself is sent as a separate
 *    follow-up message by the caller (one per QR, captioned with the label).
 * Returns "" when there are no methods. Pure: no Convex / no storage; the caller
 * resolves QR storage URLs and sends the images.
 */
export function renderPaymentMethods(
	locale: Locale,
	methods: ReadonlyArray<PaymentMethod>,
): string {
	if (methods.length === 0) return "";
	const labels = paymentLabels[locale];
	const lines: string[] = ["", labels.header];

	for (const m of methods) {
		const label = m.label.trim();
		lines.push("");
		lines.push(`*${label}*`);
		if (m.type === "bank") {
			const bank = m.bankName?.trim();
			const accName = m.bankAccountName?.trim();
			const accNum = m.bankAccountNumber?.trim();
			// Skip a redundant "Bank: X" line when the label already IS the bank name.
			if (bank && bank.toLowerCase() !== label.toLowerCase())
				lines.push(`${labels.bank}: ${bank}`);
			if (accName) lines.push(`${labels.accountName}: ${accName}`);
			if (accNum) {
				lines.push(`${labels.accountNumber}:`);
				lines.push(accNum);
			}
		} else {
			lines.push(labels.qrFollows);
		}
		const note = m.note?.trim();
		if (note) lines.push(note);
	}
	return lines.join("\n");
}

/**
 * Caption for a QR follow-up image. Includes the method's label when given (so a
 * buyer with several QRs knows which is which), else the generic "scan to pay".
 */
export function paymentQrCaption(locale: Locale, label?: string): string {
	const base = paymentLabels[locale].qrCaption;
	const trimmed = label?.trim();
	return trimmed ? `${trimmed} — ${base}` : base;
}

// ---------------------------------------------------------------------------
// Self-collect pickup snapshot
// ---------------------------------------------------------------------------

export type PickupKind = "self_collect" | "drop_off";

export type PickupSnapshot = {
	label: string;
	address: string;
	locationType?: PickupKind;
	scheduleNote?: string;
	mapsUrl?: string;
	notes?: string;
	latitude?: number;
	longitude?: number;
	placeId?: string;
	/** Flat fee (minor units) frozen at order create. Undefined = free. Already
	 * folded into the order total — rendered as its own line in the pickup
	 * block so the buyer sees WHY the total is higher than the item sum. */
	fee?: number;
};

// Kind-aware header so the buyer sees WHERE they're going at a glance —
// self-collect (the seller's place) vs a drop-off meetup point read very
// differently on the day. `undefined` legacy snapshots fall through to
// self-collect via `pickupHeaderKey`.
const pickupLabels: Record<Locale, Record<PickupKind, string>> = {
	en: {
		self_collect: "📍 Self-collect details",
		drop_off: "📍 Drop-off point",
	},
	ms: {
		self_collect: "📍 Maklumat ambil sendiri",
		drop_off: "📍 Lokasi penyerahan",
	},
};

// Fee line under the pickup address — tells the buyer the charge is already
// inside the total they're being asked to pay, so the amount never reads as a
// surprise markup.
const pickupFeeLabels: Record<Locale, string> = {
	en: "Pickup fee (included in total)",
	ms: "Caj ambilan (termasuk dalam jumlah)",
};

/**
 * Render the pickup-location block appended to the confirm message for
 * self-collect orders. Returns "" when the snapshot is missing so the caller
 * can string-concat unconditionally — mirrors `renderPaymentMethods`.
 *
 * Output (note leading blank line so consecutive blocks separate visually):
 *   ""
 *   "📍 Drop-off point"   (kind-aware header)
 *   "<label>"
 *   "<address>"
 *   "🗓️ <scheduleNote>"  (optional — meetup time)
 *   "💵 Pickup fee (included in total): MYR 2.00"  (optional — paid point)
 *   "<mapsUrl>"   (optional)
 *   ""
 *   "<notes>"     (optional)
 *
 * `currency` is only needed for the fee line — callers without a fee-carrying
 * snapshot can omit it (the line is skipped when either is missing).
 */
export function renderPickupBlock(
	locale: Locale,
	snapshot: PickupSnapshot | undefined,
	currency?: string,
): string {
	if (!snapshot) return "";
	// Legacy snapshots (frozen before drop-off existed) have no locationType →
	// read as self-collect so the buyer never sees a blank/wrong kind.
	const kind: PickupKind = snapshot.locationType ?? "self_collect";
	const lines: string[] = [""];
	lines.push(pickupLabels[locale][kind]);
	lines.push(snapshot.label);
	lines.push(snapshot.address);
	// Recurring availability ("Every Sat 3-5pm") — surfaced right under the
	// address so a drop-off buyer knows WHEN the meetup happens, not just where.
	if (snapshot.scheduleNote) lines.push(`🗓️ ${snapshot.scheduleNote}`);
	// The point's frozen fee — already folded into the order total, surfaced so
	// the buyer can reconcile total vs item prices. Same amount format as the
	// payment ask ("MYR 2.00").
	if (snapshot.fee && snapshot.fee > 0 && currency) {
		lines.push(
			`💵 ${pickupFeeLabels[locale]}: ${currency} ${(snapshot.fee / 100).toFixed(2)}`,
		);
	}
	// Embed a clickable maps URL inline so the buyer gets one-tap navigation
	// without us having to send a separate WhatsApp location-pin message.
	// Priority: mapsUrl → placeId-derived → lat/lng-derived (see deriveMapsUrl).
	// Skipped when none are available (free-text legacy rows).
	const mapsUrl = deriveMapsUrl({
		mapsUrl: snapshot.mapsUrl,
		latitude: snapshot.latitude,
		longitude: snapshot.longitude,
		placeId: snapshot.placeId,
	});
	if (mapsUrl) lines.push(mapsUrl);
	if (snapshot.notes) {
		lines.push("");
		lines.push(snapshot.notes);
	}
	return lines.join("\n");
}

