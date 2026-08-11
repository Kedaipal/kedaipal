// WhatsApp message copy catalog. Pure — no Convex imports — to keep testable.
//
// Scope (86eyd63r8 — ONE WhatsApp message per order): an order's single outbound
// message is the Meta-approved `order_confirmation_utility` template, whose
// content lives with Meta, not here. Everything this catalog still renders is a
// REPLY to something the buyer sent us first — the legacy/recovery confirm when
// they message their ORD- reference, the store-QR scan ack, the counter-order
// confirmation, and the unknown-message fallback.
//
// There is no lifecycle of sends any more. Packed / shipped / delivered /
// cancelled updates, payment prompts and reminders, delivery-fee and mockup
// notices, and receipt/invoice captions were all deleted — the buyer gets that
// from their order page (`/track/<token>`), which is exactly where the one
// message points. Don't re-add copy for a send that no longer exists.

import { type Locale, pickLocale as pickLocaleBase } from "./locale";
import { deriveMapsUrl } from "./mapsUrl";

export type { Locale } from "./locale";

export type DeliveryMethod = "delivery" | "self_collect";

export type CopyVars = {
	shortId: string;
	storeName: string;
	contactPhone?: string;
	trackingUrl?: string;
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

// There is deliberately no `status` copy here. Packed / shipped / delivered /
// cancelled no longer message the buyer at all (86eyd63r8) — those states are
// read off the order page instead.
type LocaleCopy = {
	confirm: (v: CopyVars) => string;
	unknownFallback: () => string;
};

const CONTACT_LINE_LABEL: Record<Locale, string> = {
	en: "Contact us",
	ms: "Hubungi kami",
	zh: "联系我们",
};

function contactLine(contactPhone: string | undefined, locale: Locale): string {
	if (!contactPhone) return "";
	return `\n${CONTACT_LINE_LABEL[locale]}: wa.me/${contactPhone}`;
}

/**
 * PDPA notice-at-collection line (86ey5m3hx). Shown the first time we store a
 * counter buyer's number and message them without them having visited the
 * website. The store-QR scan flow carries it in `storeQrConnected`; the manual-
 * phone entry flow (cashier types the number, buyer never scanned) carries it on
 * the order confirmation — their first message from us. One source of truth so
 * the two paths never drift.
 */
const PRIVACY_NOTICE_LINE: Record<Locale, string> = {
	en: "\n\nBy continuing you agree to our Privacy Policy: https://kedaipal.com/privacy",
	ms: "\n\nDengan meneruskan, anda bersetuju dengan Dasar Privasi kami: https://kedaipal.com/privacy",
	zh: "\n\n继续操作即表示您同意我们的隐私政策：https://kedaipal.com/privacy",
};

export function privacyNoticeLine(locale: Locale): string {
	return PRIVACY_NOTICE_LINE[locale];
}

// The confirm reply must not promise a follow-up WhatsApp message: packed /
// shipped / delivered updates were deleted (86eyd63r8), so the copy names the
// order page as the place progress and payment live instead.
export const waCopy: Record<Locale, LocaleCopy> = {
	en: {
		confirm: ({ shortId, storeName, contactPhone, trackingUrl, deliveryMethod, pickupKind }) => {
			const method = isDropOff({ deliveryMethod, pickupKind })
				? "We'll have it ready at the drop-off point."
				: deliveryMethod === "self_collect"
					? "We'll have it ready for pickup."
					: "We're getting it ready to ship.";
			return `✅ Order ${shortId} confirmed. ${method} — ${storeName}${trackingUrl ? `\n\nProgress & payment are on your order page: ${trackingUrl}` : ""}${contactLine(contactPhone, "en")}`;
		},
		unknownFallback: () =>
			"Hi! To place an order, browse our catalog and tap Checkout — you'll be sent back here with an order ID.",
	},
	ms: {
		confirm: ({ shortId, storeName, contactPhone, trackingUrl, deliveryMethod, pickupKind }) => {
			const method = isDropOff({ deliveryMethod, pickupKind })
				? "Kami akan sediakan di lokasi penyerahan."
				: deliveryMethod === "self_collect"
					? "Kami akan sediakan untuk diambil."
					: "Kami sedang sediakan untuk dihantar.";
			return `✅ Pesanan ${shortId} telah disahkan. ${method} — ${storeName}${trackingUrl ? `\n\nStatus & pembayaran ada di halaman pesanan anda: ${trackingUrl}` : ""}${contactLine(contactPhone, "ms")}`;
		},
		unknownFallback: () =>
			"Hai! Untuk membuat pesanan, layari katalog kami dan tekan Checkout — anda akan dikembalikan ke sini dengan ID pesanan.",
	},
	zh: {
		confirm: ({ shortId, storeName, contactPhone, trackingUrl, deliveryMethod, pickupKind }) => {
			const method = isDropOff({ deliveryMethod, pickupKind })
				? "我们会在交收点为您准备好。"
				: deliveryMethod === "self_collect"
					? "我们会帮您准备好，等您来拿。"
					: "我们正在为您准备发货。";
			return `✅ 订单 ${shortId} 已确认。${method} —— ${storeName}${trackingUrl ? `\n\n订单进度和付款都在订单页面：${trackingUrl}` : ""}${contactLine(contactPhone, "zh")}`;
		},
		unknownFallback: () =>
			"您好！要下单的话，请浏览我们的商品目录，点击 Checkout 结账 —— 系统会把您带回这里，并附上订单编号。",
	},
};

export const pickLocale = pickLocaleBase;

// ---------------------------------------------------------------------------
// System messages — locale-aware, NOT retailer-overridable.
//
// Used for the parts of a reply the platform must send verbatim (e.g. the
// transfer-reference instruction), kept separate from the override-able catalog
// so retailers can't break payment matching by editing a template. Every entry
// below is a reply to a buyer-initiated event — an inbound ORD- message, a store
// QR scan, or a counter order rung up while the buyer is standing there.
// ---------------------------------------------------------------------------

export type SystemMessageKey =
	| "transferReferenceLine"
	| "mockupPendingConfirm"
	| "deliveryFeePendingConfirm"
	| "storeQrConnected"
	| "storeQrBusy"
	| "counterOrderConfirmedPaid"
	| "counterOrderConfirmedUnpaid";

type SystemCopy = {
	transferReferenceLine: (v: CopyVars) => string;
	// Confirm reply for an order that still has a custom item awaiting buyer
	// mockup approval — payment is intentionally deferred (no "I've paid" yet).
	mockupPendingConfirm: (v: CopyVars) => string;
	// Confirm reply while the delivery charge is still to be confirmed by the
	// seller (radius "arrange" order, out of range / no coordinates) — payment
	// is deferred exactly like the mockup hold. See orders.deliveryFeePending.
	deliveryFeePendingConfirm: (v: CopyVars) => string;
	// Store QR poster (86ey5m35w / 86ey5neg6 — the ONLY counter QR): a buyer
	// scanned the seller's PERMANENT printed QR. `storeQrConnected` acks the
	// walk-in session, gives the buyer their `code` (a short pairing code they
	// show the cashier so it's matched in the open-checkouts list), and carries
	// the PDPA notice-at-collection privacy link (a poster buyer never touches the
	// website before their number is stored). `storeQrBusy` is the polite over-cap
	// / rate-limited reply.
	storeQrConnected: (v: CopyVars) => string;
	storeQrBusy: (v: CopyVars) => string;
	// Counter Checkout (docs/counter-checkout.md): the two `counterOrderConfirmed*`
	// messages carry the confirmed order + tracking link (paid vs pay-later branch)
	// so the buyer never has to scan again to pay.
	counterOrderConfirmedPaid: (v: CopyVars) => string;
	counterOrderConfirmedUnpaid: (v: CopyVars) => string;
};

export const systemMessages: Record<Locale, SystemCopy> = {
	en: {
		transferReferenceLine: ({ shortId }) =>
			`Use ${shortId} as your transfer reference so we can match it.`,
		mockupPendingConfirm: ({ shortId, storeName, contactPhone, trackingUrl }) =>
			`✅ Order ${shortId} received! It includes a custom item, so ${storeName} will prepare a design for you to approve first — no payment needed yet. The design, price and payment details will all be on your order page below, so keep this link.${
				trackingUrl ? `\n\nTrack your order: ${trackingUrl}` : ""
			}${contactLine(contactPhone, "en")}`,
		deliveryFeePendingConfirm: ({ shortId, storeName, contactPhone, trackingUrl }) =>
			`✅ Order ${shortId} received! Your address is outside ${storeName}'s standard delivery zones, so they'll confirm the delivery charge with you first — no payment needed yet. Once it's set, the final total and payment details appear on your order page below, so keep this link.${
				trackingUrl ? `\n\nTrack your order: ${trackingUrl}` : ""
			}${contactLine(contactPhone, "en")}`,
		storeQrConnected: ({ storeName, code }) =>
			`You're connected to ${storeName} 🎉${
				code ? ` Your order code is *${code}* — show it to the cashier so they can find you.` : ""
			} They'll ring up your order and your confirmation will land right here.${privacyNoticeLine("en")}`,
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
	},
	ms: {
		transferReferenceLine: ({ shortId }) =>
			`Gunakan ${shortId} sebagai rujukan pemindahan supaya kami boleh padankan.`,
		mockupPendingConfirm: ({ shortId, storeName, contactPhone, trackingUrl }) =>
			`✅ Pesanan ${shortId} diterima! Ia termasuk item custom, jadi ${storeName} akan sediakan reka bentuk untuk kelulusan anda dahulu — belum perlu bayar lagi. Reka bentuk, harga dan maklumat pembayaran semuanya ada di halaman pesanan anda di bawah, jadi simpan pautan ini.${
				trackingUrl ? `\n\nJejak pesanan anda: ${trackingUrl}` : ""
			}${contactLine(contactPhone, "ms")}`,
		deliveryFeePendingConfirm: ({ shortId, storeName, contactPhone, trackingUrl }) =>
			`✅ Pesanan ${shortId} diterima! Alamat anda di luar zon penghantaran biasa ${storeName}, jadi mereka akan sahkan caj penghantaran dengan anda dahulu — belum perlu bayar lagi. Setelah ditetapkan, jumlah akhir dan maklumat pembayaran akan tertera di halaman pesanan anda di bawah, jadi simpan pautan ini.${
				trackingUrl ? `\n\nJejak pesanan anda: ${trackingUrl}` : ""
			}${contactLine(contactPhone, "ms")}`,
		storeQrConnected: ({ storeName, code }) =>
			`Anda telah disambungkan dengan ${storeName} 🎉${
				code ? ` Kod pesanan anda ialah *${code}* — tunjukkan kepada juruwang supaya mereka boleh cari anda.` : ""
			} Mereka akan proses pesanan anda dan pengesahan akan sampai di sini.${privacyNoticeLine("ms")}`,
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
	},
	zh: {
		transferReferenceLine: ({ shortId }) =>
			`转账时请填写 ${shortId} 作为备注，方便我们核对。`,
		mockupPendingConfirm: ({ shortId, storeName, contactPhone, trackingUrl }) =>
			`✅ 订单 ${shortId} 已收到！里面有客制化商品，${storeName} 会先准备设计稿供您确认 —— 暂时不用付款。设计稿、价格和付款详情都会显示在下方的订单页面，请保存此链接。${
				trackingUrl ? `\n\n查看订单状态：${trackingUrl}` : ""
			}${contactLine(contactPhone, "zh")}`,
		deliveryFeePendingConfirm: ({ shortId, storeName, contactPhone, trackingUrl }) =>
			`✅ 订单 ${shortId} 已收到！您的地址超出 ${storeName} 的标准配送范围，他们会先跟您确认配送费 —— 暂时不用付款。费用确定后，最终总额和付款详情会显示在下方的订单页面，请保存此链接。${
				trackingUrl ? `\n\n查看订单状态：${trackingUrl}` : ""
			}${contactLine(contactPhone, "zh")}`,
		storeQrConnected: ({ storeName, code }) =>
			`您已经连接上 ${storeName} 了 🎉${
				code ? ` 您的订单代码是 *${code}* —— 出示给收银员，方便他们找到您。` : ""
			}他们会帮您结账，确认信息会发到这里。${privacyNoticeLine("zh")}`,
		storeQrBusy: ({ storeName }) =>
			`${storeName} 目前无法处理新的扫码 —— 请直接找收银员帮忙 🙂`,
		counterOrderConfirmedPaid: ({ shortId, storeName, amount, trackingUrl }) =>
			`🧾 完成了！您在 ${storeName} 的订单 ${shortId} 已确认并付款${
				amount ? ` —— 总额 ${amount}` : ""
			}。谢谢惠顾！收据帮您保存好了，随时可以在这里查看订单：${trackingUrl}`,
		counterOrderConfirmedUnpaid: ({ shortId, storeName, amount, trackingUrl }) =>
			`🧾 谢谢您在 ${storeName} 下单！订单 ${shortId} 已确认${
				amount ? ` —— 总额 ${amount}，方便的时候付款就好` : ""
			}。可以在这里付款和查看订单，不急：${trackingUrl}`,
	},
};

export function renderSystemMessage(
	locale: Locale,
	key: SystemMessageKey,
	vars: CopyVars,
): string {
	return systemMessages[locale][key](vars);
}

// ---------------------------------------------------------------------------
// "Powered by Kedaipal" growth line (ticket 86ey8zh3r)
//
// Appended to every buyer-facing STOREFRONT order-confirmation message so each
// order becomes a Kedaipal impression with a click path — the digital twin of
// the storefront footer badge. Always-on and deliberately NOT retailer-
// overridable (locked decision, Arif 13 Jul 2026: universal or the loop doesn't
// compound), which is why it lives here as a system suffix appended at the send
// site rather than inside the override-able `confirm` template — a seller
// editing their template can't strip it out.
// ---------------------------------------------------------------------------

const poweredByCopy: Record<Locale, string> = {
	en: "This shop runs on Kedaipal 🛒 kedaipal.com",
	ms: "Kedai ini guna Kedaipal 🛒 kedaipal.com",
	zh: "这家店用 Kedaipal 营业 🛒 kedaipal.com",
};

/**
 * The growth line as its own trailing block, with a leading blank line so it
 * reads as a quiet footer under whatever confirmation message it follows.
 * Callers append it verbatim: `body + poweredByLine(locale)`.
 */
export function poweredByLine(locale: Locale): string {
	return `\n\n${poweredByCopy[locale]}`;
}

// Custom order stages no longer message the buyer either (86eyd63r8) — the
// `notify` flag is gone from OrderStage and `renderStageUpdate` with it. A
// seller's stage vocabulary now surfaces on the order page's timeline only.

// Matches ORD-XXXX where X is from the alphabet in lib/order.ts
// (excludes O, 0, I, 1). Reused by inbound parser to keep alphabet in sync.
export const SHORT_ID_REGEX = /ORD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}/;

// Per-retailer overrides. Any key omitted (or empty string after trim) falls
// back to the built-in catalog above. Only two keys are renderable at all now:
// `confirm` (the legacy/recovery reply when a buyer messages their ORD- id) and
// `unknownFallback`.
export type TemplateKey = "confirm" | "unknownFallback";

export type LocaleOverrides = Partial<Record<TemplateKey, string | undefined>>;

export type MessageTemplates = Partial<Record<Locale, LocaleOverrides>>;

/**
 * The keys the seller's template editor renders. `confirm` is the only one:
 * packed/shipped/delivered/cancelled no longer send anything, and an editor
 * whose value can never take effect is worse than no editor.
 *
 * `unknownFallback` is deliberately NOT here either — and dropping it fixes a
 * pre-existing bug rather than causing one. The single caller renders it as
 * `renderMessage(undefined, "en", "unknownFallback", …)`: overrides hardcoded
 * to undefined, locale hardcoded to English. So a seller could type custom copy
 * into "Unknown message reply", save it, and it was never used — in any locale.
 * Making it un-editable makes the UI honest about what actually ships.
 */
export const TEMPLATE_KEYS: ReadonlyArray<TemplateKey> = ["confirm"];

export const TEMPLATE_MAX_LENGTH = 1000;

function interpolate(template: string, vars: CopyVars): string {
	return template
		.replaceAll("{shortId}", vars.shortId)
		.replaceAll("{storeName}", vars.storeName)
		.replaceAll("{contactPhone}", vars.contactPhone ?? "")
		.replaceAll("{trackingUrl}", vars.trackingUrl ?? "")
		.replaceAll("{deliveryMethod}", vars.deliveryMethod ?? "delivery");
}

function getDefault(locale: Locale, key: TemplateKey, vars: CopyVars): string {
	const c = waCopy[locale];
	return key === "confirm" ? c.confirm(vars) : c.unknownFallback();
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
// Payment instructions (ticket 86ey98ju1)
//
// Raw bank details (account number / bank name / recipient name) and QR images
// are NOT sent in the WhatsApp chat — they created friction and a
// security/compliance surface (a copyable account number sitting in chat
// history). Instead every payment message points the buyer to their own order
// page (`/track/<token>`) — via the intro's own "pay here: <url>" line + the
// "Make payment" CTA button — where the "How to pay" section lists all
// seller-configured methods (bank with one-tap copy + QR) and carries the
// "I've paid" confirm. The seller manages payment info from the dashboard; the
// chat only links to it. No separate "see how to pay" block is appended — the
// intro already carries the link, so the buyer sees it exactly once.
// ---------------------------------------------------------------------------

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
	zh: {
		self_collect: "📍 自取详情",
		drop_off: "📍 交收点",
	},
};

// Fee line under the pickup address — tells the buyer the charge is already
// inside the total they're being asked to pay, so the amount never reads as a
// surprise markup.
const pickupFeeLabels: Record<Locale, string> = {
	en: "Pickup fee (included in total)",
	ms: "Caj ambilan (termasuk dalam jumlah)",
	zh: "自取费（已包含在总额内）",
};

/**
 * Render the pickup-location block appended to the confirm message for
 * self-collect orders. Returns "" when the snapshot is missing so the caller
 * can string-concat unconditionally — mirrors `renderDeliveryFeeLine`.
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
// Delivery-fee line under the confirm intro (delivery orders) — same "already
// inside the total" framing as the pickup-fee line so the charge never reads
// as a surprise markup.
const deliveryFeeLabels: Record<Locale, string> = {
	en: "Delivery fee (included in total)",
	ms: "Caj penghantaran (termasuk dalam jumlah)",
	zh: "配送费（已包含在总额内）",
};

/**
 * Render the delivery-charge line appended to the confirm / payment messages
 * for delivery orders that carry a fee. Returns "" when there's no fee (or no
 * currency to format with) so callers can string-concat unconditionally.
 * Starts with its own "\n" — it joins an existing intro line.
 */
export function renderDeliveryFeeLine(
	locale: Locale,
	snapshot: { fee: number } | undefined,
	currency?: string,
): string {
	if (!snapshot || !(snapshot.fee > 0) || !currency) return "";
	return `\n🚚 ${deliveryFeeLabels[locale]}: ${currency} ${(snapshot.fee / 100).toFixed(2)}`;
}

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

