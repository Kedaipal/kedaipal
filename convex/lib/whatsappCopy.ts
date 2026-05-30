// WhatsApp message copy catalog. Pure — no Convex imports — to keep testable.

export type Locale = "en" | "ms";

export type DeliveryMethod = "delivery" | "self_collect";

export type CopyVars = {
	shortId: string;
	storeName: string;
	contactPhone?: string;
	trackingUrl?: string;
	carrierTrackingUrl?: string;
	deliveryMethod?: DeliveryMethod;
};

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
		confirm: ({ shortId, storeName, contactPhone, trackingUrl, deliveryMethod }) => {
			const method = deliveryMethod === "self_collect"
				? "We'll let you know when it's ready for pickup."
				: "We'll update you when it ships.";
			return `✅ Order ${shortId} confirmed. ${method} — ${storeName}${trackingUrl ? `\n\nTrack order & tap 'I've paid' to send receipt: ${trackingUrl}` : ""}${contactLine(contactPhone, "en")}`;
		},
		status: {
			packed: ({ shortId, trackingUrl, deliveryMethod }) => {
				const msg = deliveryMethod === "self_collect"
					? `📦 Order ${shortId} is packed and ready for pickup.`
					: `📦 Order ${shortId} is packed and ready to ship.`;
				return `${msg}${trackingUrl ? `\n\nTrack your order: ${trackingUrl}` : ""}`;
			},
			shipped: ({ shortId, carrierTrackingUrl, trackingUrl, deliveryMethod }) => {
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
		confirm: ({ shortId, storeName, contactPhone, trackingUrl, deliveryMethod }) => {
			const method = deliveryMethod === "self_collect"
				? "Kami akan maklumkan apabila sedia untuk diambil."
				: "Kami akan maklumkan apabila dihantar.";
			return `✅ Pesanan ${shortId} telah disahkan. ${method} — ${storeName}${trackingUrl ? `\n\nJejak pesanan & tekan 'I've paid' untuk hantar resit: ${trackingUrl}` : ""}${contactLine(contactPhone, "ms")}`;
		},
		status: {
			packed: ({ shortId, trackingUrl, deliveryMethod }) => {
				const msg = deliveryMethod === "self_collect"
					? `📦 Pesanan ${shortId} sudah dibungkus dan sedia untuk diambil.`
					: `📦 Pesanan ${shortId} sudah dibungkus dan sedia untuk dihantar.`;
				return `${msg}${trackingUrl ? `\n\nJejak pesanan anda: ${trackingUrl}` : ""}`;
			},
			shipped: ({ shortId, carrierTrackingUrl, trackingUrl, deliveryMethod }) => {
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

export type SystemMessageKey = "paymentReceived" | "transferReferenceLine";

type SystemCopy = {
	paymentReceived: (v: CopyVars) => string;
	transferReferenceLine: (v: CopyVars) => string;
};

export const systemMessages: Record<Locale, SystemCopy> = {
	en: {
		paymentReceived: ({ shortId, storeName, trackingUrl }) =>
			`✅ Payment received for ${shortId}. ${storeName} is preparing your order.${
				trackingUrl ? `\n\nTrack: ${trackingUrl}` : ""
			}`,
		transferReferenceLine: ({ shortId }) =>
			`Use ${shortId} as your transfer reference so we can match it.`,
	},
	ms: {
		paymentReceived: ({ shortId, storeName, trackingUrl }) =>
			`✅ Pembayaran diterima untuk ${shortId}. ${storeName} sedang menyediakan pesanan anda.${
				trackingUrl ? `\n\nJejak: ${trackingUrl}` : ""
			}`,
		transferReferenceLine: ({ shortId }) =>
			`Gunakan ${shortId} sebagai rujukan pemindahan supaya kami boleh padankan.`,
	},
};

export function renderSystemMessage(
	locale: Locale,
	key: SystemMessageKey,
	vars: CopyVars,
): string {
	return systemMessages[locale][key](vars);
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

export type PaymentInstructions = {
	bankName?: string;
	bankAccountName?: string;
	bankAccountNumber?: string;
	qrImageStorageId?: string;
	note?: string;
};

const paymentLabels: Record<
	Locale,
	{
		header: string;
		bank: string;
		accountName: string;
		accountNumber: string;
		qrCaption: string;
	}
> = {
	en: {
		header: "💳 Payment details",
		bank: "Bank",
		accountName: "Name",
		accountNumber: "Account",
		qrCaption: "Scan to pay",
	},
	ms: {
		header: "💳 Maklumat pembayaran",
		bank: "Bank",
		accountName: "Nama",
		accountNumber: "Akaun",
		qrCaption: "Imbas untuk bayar",
	},
};

/**
 * Render the payment instructions block as plain text. Returns empty string if
 * no bank fields and no note are present (QR-only retailers get a header line
 * only when bank/note are absent — the QR image carries its own caption).
 *
 * Pure: no Convex / no storage. Caller resolves the QR storage URL separately.
 */
export function renderPaymentInstructions(
	locale: Locale,
	instructions: PaymentInstructions | undefined,
): string {
	if (!instructions) return "";
	const labels = paymentLabels[locale];
	const lines: string[] = [];

	const bank = instructions.bankName?.trim();
	const accName = instructions.bankAccountName?.trim();
	const accNum = instructions.bankAccountNumber?.trim();
	const note = instructions.note?.trim();

	const hasBankBlock = Boolean(bank || accName || accNum);
	const hasAny = hasBankBlock || Boolean(note);
	if (!hasAny) return "";

	lines.push("");
	lines.push(labels.header);
	if (bank) lines.push(`${labels.bank}: ${bank}`);
	if (accName) lines.push(`${labels.accountName}: ${accName}`);
	if (accNum) lines.push(`${labels.accountNumber}: ${accNum}`);
	if (note) {
		if (hasBankBlock) lines.push("");
		lines.push(note);
	}
	return lines.join("\n");
}

export function paymentQrCaption(locale: Locale): string {
	return paymentLabels[locale].qrCaption;
}

// ---------------------------------------------------------------------------
// Self-collect pickup snapshot
// ---------------------------------------------------------------------------

export type PickupSnapshot = {
	label: string;
	address: string;
	mapsUrl?: string;
	notes?: string;
	latitude?: number;
	longitude?: number;
};

const pickupLabels: Record<Locale, { header: string }> = {
	en: { header: "📍 Pickup details" },
	ms: { header: "📍 Maklumat pengambilan" },
};

/**
 * Render the pickup-location block appended to the confirm message for
 * self-collect orders. Returns "" when the snapshot is missing so the caller
 * can string-concat unconditionally — mirrors `renderPaymentInstructions`.
 *
 * Output (note leading blank line so consecutive blocks separate visually):
 *   ""
 *   "📍 Pickup details"
 *   "<label>"
 *   "<address>"
 *   "<mapsUrl>"   (optional)
 *   ""
 *   "<notes>"     (optional)
 */
export function renderPickupBlock(
	locale: Locale,
	snapshot: PickupSnapshot | undefined,
): string {
	if (!snapshot) return "";
	const labels = pickupLabels[locale];
	const lines: string[] = [""];
	lines.push(labels.header);
	lines.push(snapshot.label);
	lines.push(snapshot.address);
	// When we have coordinates, the WhatsApp location pin (sent as a follow-up
	// message) replaces the inline mapsUrl — keeps the confirm text clean and
	// avoids "ugly long URL" criticism. Legacy snapshots without lat/lng still
	// get the URL inline so navigation isn't lost.
	const hasCoords =
		typeof snapshot.latitude === "number" &&
		typeof snapshot.longitude === "number";
	if (!hasCoords && snapshot.mapsUrl) lines.push(snapshot.mapsUrl);
	if (snapshot.notes) {
		lines.push("");
		lines.push(snapshot.notes);
	}
	return lines.join("\n");
}

