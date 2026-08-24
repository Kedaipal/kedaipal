// Retailer-facing email copy catalog. Pure — no Convex imports — to keep testable.
// Trilingual (en / ms / zh) parity with the WhatsApp retailer alerts.

import type { Locale } from "./locale";

export type { Locale } from "./locale";

// Brand logo for email headers. Must be an absolute, publicly-reachable URL (email
// clients can't load localhost / app-relative assets), so it always points at the
// prod public asset — correct even when sent from a dev deployment.
export const LOGO_URL = "https://kedaipal.com/logo-2.png";

/** Left-aligned brand logo block for email headers. */
export function logoHeader(marginBottom = 16): string {
	return `<img src="${LOGO_URL}" alt="Kedaipal" width="132" style="display:block;border:0;outline:none;text-decoration:none;height:auto;margin:0 0 ${marginBottom}px 0;" />`;
}

export type DeliveryMethod = "delivery" | "self_collect";

export type RetailerEmailKey =
	| "newOrder"
	| "orderConfirmed"
	| "paymentClaimed"
	| "paymentReceived"
	| "mockupApproved"
	| "mockupChangesRequested"
	| "mockupDeclined"
	| "deliveryJobFailed"
	| "gatewayMismatch"
	| "gatewayPaidCancelled";

export type RetailerEmailVars = {
	shortId: string;
	itemCount: number;
	totalFormatted: string;
	customerName: string;
	deliveryMethod: DeliveryMethod;
	// The order's frozen trip direction (86eyg0n8e) — "collection" flips the
	// "Method:" label to collection wording (the rider collects FROM the
	// buyer's address). Undefined = standard delivery.
	deliveryDirection?: "standard" | "collection";
	storeName: string;
	dashboardUrl: string;
	// Optional — set on "paymentClaimed" (the reference the shopper typed into
	// the "I've paid" form, e.g. their bank transaction ID, plus a resolved
	// Convex storage URL for the screenshot) and on "paymentReceived" (the HitPay
	// payment id, which is what the seller looks the charge up by).
	paymentReference?: string;
	proofUrl?: string;
	// Optional — only set when key === "mockupChangesRequested".
	mockupChangeNote?: string;
	// Optional — only set when key === "gatewayMismatch" (86eyb6z3a). What the
	// buyer actually paid through HitPay ("MYR 45.00"), shown against
	// `totalFormatted`; `paymentReference` carries the HitPay payment id.
	gatewayPaidFormatted?: string;
	// Optional — only set when key === "deliveryJobFailed". Human-readable
	// reason the Lalamove booking ended without a rider (e.g. "No driver
	// accepted the order"). See docs/delivery-lalamove.md.
	jobFailureReason?: string;
	// True when the order has a made-to-order custom item that needs a mockup
	// approved before it can be packed (and before the buyer is asked to pay).
	// Surfaced on the newOrder / orderConfirmed alerts so the seller knows to act.
	requiresMockup?: boolean;
	// Delivery charge still to be confirmed by the seller (out-of-range
	// "arrange" order, 86extzdr8) — surfaces an action line on the newOrder /
	// orderConfirmed alerts so the seller knows the total isn't final and the
	// buyer's payment ask is held until they set the charge.
	deliveryFeePending?: boolean;
	// Pre-formatted fulfilment date ("Sat, 28 Jun 2026"), set on the newOrder /
	// orderConfirmed alerts when the buyer picked one. Lets the seller see "when
	// they need it" without opening the dashboard.
	fulfilmentDateLabel?: string;
	// Chosen pickup point, set on newOrder / orderConfirmed when the order is a
	// pickup (deliveryMethod === "self_collect") and a point was captured. Drives
	// the kind-aware "Method:" label + a pickup detail block so the seller knows
	// which spot — and, for a drop-off, which recurring slot — without opening the
	// dashboard. `pickupKind` undefined → self-collect (legacy orders).
	pickupKind?: "self_collect" | "drop_off";
	pickupLabel?: string;
	pickupAddress?: string;
	pickupScheduleNote?: string;
	pickupMapsUrl?: string;
};

const deliveryLabel: Record<Locale, Record<DeliveryMethod, string>> = {
	en: { delivery: "Delivery", self_collect: "Self-collect" },
	ms: { delivery: "Penghantaran", self_collect: "Ambil sendiri" },
	zh: { delivery: "配送", self_collect: "自取" },
};

// Collection service (86eyg0n8e): the rider collects FROM the customer — a
// "Delivery" method line next to the buyer's address would read backwards.
const collectionLabel: Record<Locale, string> = {
	en: "Collection (from customer)",
	ms: "Kutipan (dari pelanggan)",
	zh: "上门取件",
};

// Kind-aware pickup label. A drop-off meetup reads very differently from
// collecting at the seller's place, so the seller alert distinguishes them.
const pickupKindLabel: Record<
	Locale,
	Record<"self_collect" | "drop_off", string>
> = {
	en: { self_collect: "Self-collect", drop_off: "Drop-off" },
	ms: { self_collect: "Ambil sendiri", drop_off: "Penyerahan" },
	zh: { self_collect: "自取", drop_off: "交收" },
};

/** Collection service (86eyg0n8e) — the rider collects FROM the customer, so
 * the seller's next step is dispatching one, not packing a parcel. */
function isCollection(v: RetailerEmailVars): boolean {
	return v.deliveryDirection === "collection";
}

/**
 * Effective "Method:" label. Delivery is delivery; a pickup order resolves to
 * the kind-specific label ("Self-collect" / "Drop-off") so the seller sees the
 * real arrangement, not a generic "Self-collect" for every pickup.
 */
function methodLabel(locale: Locale, v: RetailerEmailVars): string {
	if (v.deliveryMethod === "delivery") {
		return v.deliveryDirection === "collection"
			? collectionLabel[locale]
			: deliveryLabel[locale].delivery;
	}
	return pickupKindLabel[locale][v.pickupKind ?? "self_collect"];
}

/**
 * Extra lines describing the chosen pickup point (label · address, schedule
 * note, maps link). Empty for delivery orders or when no point was captured.
 * `asHtml` toggles anchor vs raw-URL for the maps link and escaping.
 */
const OPEN_IN_MAPS_LABEL: Record<Locale, string> = {
	en: "Open in maps",
	ms: "Buka peta",
	zh: "在地图中打开",
};

function pickupDetailLines(
	locale: Locale,
	v: RetailerEmailVars,
	asHtml: boolean,
): string[] {
	if (v.deliveryMethod !== "self_collect" || !v.pickupLabel) return [];
	const esc = asHtml ? escapeHtml : (s: string) => s;
	const lines: string[] = [];
	const point = v.pickupAddress
		? `📍 ${esc(v.pickupLabel)} — ${esc(v.pickupAddress)}`
		: `📍 ${esc(v.pickupLabel)}`;
	lines.push(asHtml ? `<strong>${point}</strong>` : point);
	if (v.pickupScheduleNote) lines.push(`🗓️ ${esc(v.pickupScheduleNote)}`);
	if (v.pickupMapsUrl) {
		lines.push(
			asHtml
				? `<a href="${escapeHtml(v.pickupMapsUrl)}" style="color:#2563eb;text-decoration:underline;">${OPEN_IN_MAPS_LABEL[locale]}</a>`
				: v.pickupMapsUrl,
		);
	}
	return lines;
}

type RenderedEmail = {
	subject: string;
	html: string;
	text: string;
};

export function escapeHtml(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export function wrapHtml(headlineEmoji: string, headline: string, lines: string[], dashboardUrl: string, ctaLabel: string): string {
	const body = lines.map((l) => `<p style="margin:0 0 8px 0;font-size:14px;color:#1f2937;">${l}</p>`).join("");
	return `<!doctype html><html><body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:24px 16px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:24px;">
${logoHeader(16)}
<h1 style="margin:0 0 16px 0;font-size:18px;color:#111827;">${headlineEmoji} ${escapeHtml(headline)}</h1>
${body}
<p style="margin:24px 0 0 0;"><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px;">${escapeHtml(ctaLabel)}</a></p>
</td></tr></table>
<p style="margin:16px 0 0 0;font-size:12px;color:#9ca3af;">Sent by Kedaipal — your WhatsApp-first order hub.</p>
</td></tr></table></body></html>`;
}

const en = {
	newOrder: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🔔 New order ${v.shortId} · ${v.totalFormatted}`;
		const mockupHtml = `⚠️ <strong>Custom item</strong> — send a mockup for the buyer to approve. Payment is held until they do.`;
		const mockupText = `⚠️ Custom item — send a mockup for the buyer to approve. Payment is held until they do.`;
		const feePendingHtml = `🚚 <strong>Delivery charge to confirm</strong> — this address is outside your bands. Set the charge on the order page; the buyer's payment ask is held until you do.`;
		const feePendingText = `🚚 Delivery charge to confirm — this address is outside your bands. Set the charge on the order page; the buyer's payment ask is held until you do.`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} item(s) · ${escapeHtml(v.totalFormatted)}`,
			`Customer: ${escapeHtml(v.customerName)}`,
			`Method: ${methodLabel("en", v)}`,
			...pickupDetailLines("en", v, true),
			...(v.fulfilmentDateLabel
				? [`📅 Needed by: <strong>${escapeHtml(v.fulfilmentDateLabel)}</strong>`]
				: []),
			...(v.requiresMockup ? [mockupHtml] : []),
			...(v.deliveryFeePending ? [feePendingHtml] : []),
			`Open your dashboard to manage this order.`,
		];
		const html = wrapHtml("🔔", `New order ${v.shortId}`, lines, v.dashboardUrl, "Open dashboard");
		const dateText = v.fulfilmentDateLabel ? `\nNeeded by: ${v.fulfilmentDateLabel}` : "";
		const text = `🔔 New order ${v.shortId}\n${v.itemCount} item(s) · ${v.totalFormatted}\nCustomer: ${v.customerName}\nMethod: ${methodLabel("en", v)}${pickupDetailLines("en", v, false)
			.map((l) => `\n${l}`)
			.join("")}${dateText}\n${v.requiresMockup ? `\n${mockupText}\n` : ""}${v.deliveryFeePending ? `\n${feePendingText}\n` : ""}\nOpen your dashboard to manage this order.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	orderConfirmed: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `✅ Order ${v.shortId} confirmed · ${v.totalFormatted}`;
		const nextStepsHtml = v.requiresMockup
			? `⚠️ <strong>Custom item</strong> — send a mockup for the buyer to approve before packing. Payment is held until they approve.`
			: v.deliveryFeePending
				? `🚚 <strong>Delivery charge to confirm</strong> — this address is outside your bands. Set the charge on the order page; the buyer's payment ask is held until you do.`
				: (isCollection(v)
					? "Ready for next steps — send a rider to collect from your customer."
					: "Ready for next steps — pack and ship when payment lands.");
		const nextStepsText = v.requiresMockup
			? `⚠️ Custom item — send a mockup for the buyer to approve before packing. Payment is held until they approve.`
			: v.deliveryFeePending
				? `🚚 Delivery charge to confirm — this address is outside your bands. Set the charge on the order page; the buyer's payment ask is held until you do.`
				: (isCollection(v)
					? "Ready for next steps — send a rider to collect from your customer."
					: "Ready for next steps — pack and ship when payment lands.");
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} item(s) · ${escapeHtml(v.totalFormatted)}`,
			`Customer: ${escapeHtml(v.customerName)}`,
			`Method: ${methodLabel("en", v)}`,
			...pickupDetailLines("en", v, true),
			...(v.fulfilmentDateLabel
				? [`📅 Needed by: <strong>${escapeHtml(v.fulfilmentDateLabel)}</strong>`]
				: []),
			nextStepsHtml,
		];
		const html = wrapHtml("✅", `Order ${v.shortId} confirmed`, lines, v.dashboardUrl, "Open dashboard");
		const dateText = v.fulfilmentDateLabel ? `\nNeeded by: ${v.fulfilmentDateLabel}` : "";
		const text = `✅ Order ${v.shortId} confirmed\n${v.itemCount} item(s) · ${v.totalFormatted}\nCustomer: ${v.customerName}\nMethod: ${methodLabel("en", v)}${pickupDetailLines("en", v, false)
			.map((l) => `\n${l}`)
			.join("")}${dateText}\n\n${nextStepsText}\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	paymentClaimed: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🪙 Payment claimed for ${v.shortId} · ${v.totalFormatted}`;
		const refLine = v.paymentReference
			? `Reference: <strong>${escapeHtml(v.paymentReference)}</strong>`
			: `Reference: <em>not provided</em>`;
		const proofLine = v.proofUrl
			? `<a href="${escapeHtml(v.proofUrl)}" style="color:#2563eb;text-decoration:underline;">View receipt screenshot</a>`
			: `Screenshot: <em>not provided</em>`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} item(s) · ${escapeHtml(v.totalFormatted)}`,
			`Customer: ${escapeHtml(v.customerName)}`,
			refLine,
			proofLine,
			`Verify in your bank app, then confirm in your dashboard.`,
		];
		const html = wrapHtml(
			"🪙",
			`Payment claimed for ${v.shortId}`,
			lines,
			v.dashboardUrl,
			"Open dashboard",
		);
		const refTextLine = v.paymentReference
			? `Reference: ${v.paymentReference}`
			: `Reference: not provided`;
		const proofTextLine = v.proofUrl
			? `Screenshot: ${v.proofUrl}`
			: `Screenshot: not provided`;
		const text = `🪙 Payment claimed for ${v.shortId}\n${v.itemCount} item(s) · ${v.totalFormatted}\nCustomer: ${v.customerName}\n${refTextLine}\n${proofTextLine}\n\nVerify in your bank app, then confirm in your dashboard.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	paymentReceived: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `✅ Payment received for ${v.shortId} · ${v.totalFormatted}`;
		const refLine = v.paymentReference
			? `HitPay ref: <strong>${escapeHtml(v.paymentReference)}</strong>`
			: undefined;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} item(s) · ${escapeHtml(v.totalFormatted)}`,
			`Customer: ${escapeHtml(v.customerName)}`,
			...(refLine ? [refLine] : []),
			// The load-bearing difference from paymentClaimed: nothing is asked of
			// the seller. We verified this with HitPay ourselves and the order is
			// already confirmed — sending them to their bank app would invent work.
			`Paid online through HitPay. The order is confirmed — nothing to check.`,
		];
		const html = wrapHtml(
			"✅",
			`Payment received for ${v.shortId}`,
			lines,
			v.dashboardUrl,
			"Open dashboard",
		);
		const refTextLine = v.paymentReference
			? `\nHitPay ref: ${v.paymentReference}`
			: "";
		const text = `✅ Payment received for ${v.shortId}\n${v.itemCount} item(s) · ${v.totalFormatted}\nCustomer: ${v.customerName}${refTextLine}\n\nPaid online through HitPay. The order is confirmed — nothing to check.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	mockupApproved: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🎨 Mockup approved for ${v.shortId}`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> — ${escapeHtml(v.customerName)} approved the mockup.`,
			`You're clear to produce and pack this order.`,
		];
		const html = wrapHtml("🎨", `Mockup approved — ${v.shortId}`, lines, v.dashboardUrl, "Open dashboard");
		const text = `🎨 Mockup approved for ${v.shortId}\n${v.customerName} approved the mockup — you're clear to produce.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	mockupChangesRequested: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `✏️ Mockup changes requested for ${v.shortId}`;
		const noteLine = v.mockupChangeNote
			? `Requested changes: <em>${escapeHtml(v.mockupChangeNote)}</em>`
			: `No note provided.`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> — ${escapeHtml(v.customerName)} asked for changes to the mockup.`,
			noteLine,
			`Update the mockup and re-send it for approval.`,
		];
		const html = wrapHtml("✏️", `Changes requested — ${v.shortId}`, lines, v.dashboardUrl, "Open dashboard");
		const noteText = v.mockupChangeNote
			? `Requested changes: ${v.mockupChangeNote}`
			: `No note provided.`;
		const text = `✏️ Mockup changes requested for ${v.shortId}\n${v.customerName} asked for changes.\n${noteText}\nUpdate and re-send for approval.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	mockupDeclined: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🚫 Custom item declined for ${v.shortId}`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> — ${escapeHtml(v.customerName)} declined the custom item.`,
			`The custom line was removed; the order total is now <strong>${escapeHtml(v.totalFormatted)}</strong>.`,
			`Any remaining ready-made items can proceed as normal.`,
		];
		const html = wrapHtml("🚫", `Custom item declined — ${v.shortId}`, lines, v.dashboardUrl, "Open dashboard");
		const text = `🚫 Custom item declined for ${v.shortId}\n${v.customerName} declined the custom item.\nNew total: ${v.totalFormatted}. Remaining ready-made items can proceed.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	deliveryJobFailed: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🚨 Delivery booking failed for ${v.shortId}`;
		const reasonLine = v.jobFailureReason
			? `Reason: ${v.jobFailureReason}`
			: `The booking ended without a rider.`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> — the Lalamove booking did not go through.`,
			escapeHtml(reasonLine),
			`Your buyer has <strong>not</strong> been notified and the order is unchanged — open the order to rebook a rider.`,
		];
		const html = wrapHtml("🚨", `Delivery booking failed — ${v.shortId}`, lines, v.dashboardUrl, "Rebook delivery");
		const text = `🚨 Delivery booking failed for ${v.shortId}\n${reasonLine}\nYour buyer has not been notified and the order is unchanged — open the order to rebook a rider.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	gatewayMismatch: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `⚠️ Online payment doesn't match ${v.shortId}'s total`;
		const paid = v.gatewayPaidFormatted ?? "an unknown amount";
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${escapeHtml(v.customerName)}`,
			`The buyer paid <strong>${escapeHtml(paid)}</strong> through HitPay, but the order total is <strong>${escapeHtml(v.totalFormatted)}</strong>.`,
			`This usually means the total changed after their payment link was created.`,
			`The order was <strong>not</strong> auto-marked paid. Check the payment in your HitPay dashboard (reference: ${escapeHtml(v.paymentReference ?? "—")}), then settle it on the order page — mark it received if the amount is fine, or refund via HitPay.`,
		];
		const html = wrapHtml("⚠️", `Online payment mismatch — ${v.shortId}`, lines, v.dashboardUrl, "Open the order");
		const text = `⚠️ Online payment doesn't match ${v.shortId}'s total\nThe buyer paid ${paid} through HitPay, but the order total is ${v.totalFormatted}.\nThis usually means the total changed after their payment link was created.\nThe order was NOT auto-marked paid. Check the payment in your HitPay dashboard (reference: ${v.paymentReference ?? "—"}), then settle it on the order page — mark it received if the amount is fine, or refund via HitPay.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	gatewayPaidCancelled: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `⚠️ Buyer paid the CANCELLED order ${v.shortId}`;
		const paid = v.gatewayPaidFormatted ?? "an unknown amount";
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${escapeHtml(v.customerName)}`,
			`The buyer paid <strong>${escapeHtml(paid)}</strong> through HitPay — but this order was already cancelled when the payment came in (their payment link stays open for up to an hour).`,
			`The order was <strong>not</strong> reopened and the buyer was <strong>not</strong> messaged.`,
			`Refund the payment in your HitPay dashboard (reference: ${escapeHtml(v.paymentReference ?? "—")}) and let the buyer know.`,
		];
		const html = wrapHtml("⚠️", `Paid after cancel — ${v.shortId}`, lines, v.dashboardUrl, "Open the order");
		const text = `⚠️ Buyer paid the CANCELLED order ${v.shortId}\nThe buyer paid ${paid} through HitPay — but this order was already cancelled when the payment came in (their payment link stays open for up to an hour).\nThe order was NOT reopened and the buyer was NOT messaged.\nRefund the payment in your HitPay dashboard (reference: ${v.paymentReference ?? "—"}) and let the buyer know.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
};

const ms = {
	newOrder: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🔔 Pesanan baru ${v.shortId} · ${v.totalFormatted}`;
		const mockupHtml = `⚠️ <strong>Item custom</strong> — hantar mockup untuk kelulusan pembeli. Bayaran ditahan sehingga mereka luluskan.`;
		const mockupText = `⚠️ Item custom — hantar mockup untuk kelulusan pembeli. Bayaran ditahan sehingga mereka luluskan.`;
		const feePendingHtml = `🚚 <strong>Caj penghantaran perlu disahkan</strong> — alamat ini di luar zon anda. Tetapkan caj pada halaman pesanan; permintaan bayaran pembeli ditahan sehingga anda berbuat demikian.`;
		const feePendingText = `🚚 Caj penghantaran perlu disahkan — alamat ini di luar zon anda. Tetapkan caj pada halaman pesanan; permintaan bayaran pembeli ditahan sehingga anda berbuat demikian.`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} item · ${escapeHtml(v.totalFormatted)}`,
			`Pelanggan: ${escapeHtml(v.customerName)}`,
			`Kaedah: ${methodLabel("ms", v)}`,
			...pickupDetailLines("ms", v, true),
			...(v.fulfilmentDateLabel
				? [`📅 Diperlukan menjelang: <strong>${escapeHtml(v.fulfilmentDateLabel)}</strong>`]
				: []),
			...(v.requiresMockup ? [mockupHtml] : []),
			...(v.deliveryFeePending ? [feePendingHtml] : []),
			`Buka dashboard anda untuk menguruskan pesanan ini.`,
		];
		const html = wrapHtml("🔔", `Pesanan baru ${v.shortId}`, lines, v.dashboardUrl, "Buka dashboard");
		const dateText = v.fulfilmentDateLabel ? `\nDiperlukan menjelang: ${v.fulfilmentDateLabel}` : "";
		const text = `🔔 Pesanan baru ${v.shortId}\n${v.itemCount} item · ${v.totalFormatted}\nPelanggan: ${v.customerName}\nKaedah: ${methodLabel("ms", v)}${pickupDetailLines("ms", v, false)
			.map((l) => `\n${l}`)
			.join("")}${dateText}\n${v.requiresMockup ? `\n${mockupText}\n` : ""}${v.deliveryFeePending ? `\n${feePendingText}\n` : ""}\nBuka dashboard anda untuk menguruskan pesanan ini.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	orderConfirmed: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `✅ Pesanan ${v.shortId} disahkan · ${v.totalFormatted}`;
		const nextStepsHtml = v.requiresMockup
			? `⚠️ <strong>Item custom</strong> — hantar mockup untuk kelulusan pembeli sebelum membungkus. Bayaran ditahan sehingga mereka luluskan.`
			: v.deliveryFeePending
				? `🚚 <strong>Caj penghantaran perlu disahkan</strong> — alamat ini di luar zon anda. Tetapkan caj pada halaman pesanan; permintaan bayaran pembeli ditahan sehingga anda berbuat demikian.`
				: `Sedia untuk langkah seterusnya.`;
		const nextStepsText = v.requiresMockup
			? `⚠️ Item custom — hantar mockup untuk kelulusan pembeli sebelum membungkus. Bayaran ditahan sehingga mereka luluskan.`
			: v.deliveryFeePending
				? `🚚 Caj penghantaran perlu disahkan — alamat ini di luar zon anda. Tetapkan caj pada halaman pesanan; permintaan bayaran pembeli ditahan sehingga anda berbuat demikian.`
				: `Sedia untuk langkah seterusnya.`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} item · ${escapeHtml(v.totalFormatted)}`,
			`Pelanggan: ${escapeHtml(v.customerName)}`,
			`Kaedah: ${methodLabel("ms", v)}`,
			...pickupDetailLines("ms", v, true),
			...(v.fulfilmentDateLabel
				? [`📅 Diperlukan menjelang: <strong>${escapeHtml(v.fulfilmentDateLabel)}</strong>`]
				: []),
			nextStepsHtml,
		];
		const html = wrapHtml("✅", `Pesanan ${v.shortId} disahkan`, lines, v.dashboardUrl, "Buka dashboard");
		const dateText = v.fulfilmentDateLabel ? `\nDiperlukan menjelang: ${v.fulfilmentDateLabel}` : "";
		const text = `✅ Pesanan ${v.shortId} telah disahkan\n${v.itemCount} item · ${v.totalFormatted}\nPelanggan: ${v.customerName}\nKaedah: ${methodLabel("ms", v)}${pickupDetailLines("ms", v, false)
			.map((l) => `\n${l}`)
			.join("")}${dateText}\n\n${nextStepsText}\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	paymentClaimed: (v: RetailerEmailVars): RenderedEmail => {
		// "Pelanggan kata dah bayar", not "Pembayaran diterima" — this is a CLAIM
		// the seller still has to verify, and the money-really-landed sibling
		// (paymentReceived) now owns "diterima". Fixed in passing; the old wording
		// promised settlement the seller hadn't confirmed yet.
		const subject = `🪙 Pelanggan kata dah bayar — ${v.shortId} · ${v.totalFormatted}`;
		const refLine = v.paymentReference
			? `Rujukan: <strong>${escapeHtml(v.paymentReference)}</strong>`
			: `Rujukan: <em>tidak dinyatakan</em>`;
		const proofLine = v.proofUrl
			? `<a href="${escapeHtml(v.proofUrl)}" style="color:#2563eb;text-decoration:underline;">Lihat tangkapan resit</a>`
			: `Tangkapan resit: <em>tidak dinyatakan</em>`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} item · ${escapeHtml(v.totalFormatted)}`,
			`Pelanggan: ${escapeHtml(v.customerName)}`,
			refLine,
			proofLine,
			`Sahkan di aplikasi bank anda, kemudian sahkan di dashboard.`,
		];
		const html = wrapHtml(
			"🪙",
			`Pelanggan kata dah bayar — ${v.shortId}`,
			lines,
			v.dashboardUrl,
			"Buka dashboard",
		);
		const refTextLine = v.paymentReference
			? `Rujukan: ${v.paymentReference}`
			: `Rujukan: tidak dinyatakan`;
		const proofTextLine = v.proofUrl
			? `Tangkapan resit: ${v.proofUrl}`
			: `Tangkapan resit: tidak dinyatakan`;
		const text = `🪙 Pelanggan kata dah bayar — ${v.shortId}\n${v.itemCount} item · ${v.totalFormatted}\nPelanggan: ${v.customerName}\n${refTextLine}\n${proofTextLine}\n\nSahkan di aplikasi bank anda, kemudian sahkan di dashboard.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	paymentReceived: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `✅ Pembayaran diterima untuk ${v.shortId} · ${v.totalFormatted}`;
		const refLine = v.paymentReference
			? `Rujukan HitPay: <strong>${escapeHtml(v.paymentReference)}</strong>`
			: undefined;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} item · ${escapeHtml(v.totalFormatted)}`,
			`Pelanggan: ${escapeHtml(v.customerName)}`,
			...(refLine ? [refLine] : []),
			`Dibayar dalam talian melalui HitPay. Pesanan sudah disahkan — tiada apa perlu disemak.`,
		];
		const html = wrapHtml(
			"✅",
			`Pembayaran diterima untuk ${v.shortId}`,
			lines,
			v.dashboardUrl,
			"Buka dashboard",
		);
		const refTextLine = v.paymentReference
			? `\nRujukan HitPay: ${v.paymentReference}`
			: "";
		const text = `✅ Pembayaran diterima untuk ${v.shortId}\n${v.itemCount} item · ${v.totalFormatted}\nPelanggan: ${v.customerName}${refTextLine}\n\nDibayar dalam talian melalui HitPay. Pesanan sudah disahkan — tiada apa perlu disemak.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	mockupApproved: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🎨 Mockup diluluskan untuk ${v.shortId}`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> — ${escapeHtml(v.customerName)} telah meluluskan mockup.`,
			`Anda boleh teruskan pengeluaran dan pembungkusan.`,
		];
		const html = wrapHtml("🎨", `Mockup diluluskan — ${v.shortId}`, lines, v.dashboardUrl, "Buka dashboard");
		const text = `🎨 Mockup diluluskan untuk ${v.shortId}\n${v.customerName} telah meluluskan mockup — anda boleh teruskan.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	mockupChangesRequested: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `✏️ Pindaan mockup diminta untuk ${v.shortId}`;
		const noteLine = v.mockupChangeNote
			? `Pindaan diminta: <em>${escapeHtml(v.mockupChangeNote)}</em>`
			: `Tiada nota diberikan.`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> — ${escapeHtml(v.customerName)} meminta pindaan pada mockup.`,
			noteLine,
			`Kemas kini mockup dan hantar semula untuk kelulusan.`,
		];
		const html = wrapHtml("✏️", `Pindaan diminta — ${v.shortId}`, lines, v.dashboardUrl, "Buka dashboard");
		const noteText = v.mockupChangeNote
			? `Pindaan diminta: ${v.mockupChangeNote}`
			: `Tiada nota diberikan.`;
		const text = `✏️ Pindaan mockup diminta untuk ${v.shortId}\n${v.customerName} meminta pindaan.\n${noteText}\nKemas kini dan hantar semula.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	mockupDeclined: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🚫 Item custom ditolak untuk ${v.shortId}`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> — ${escapeHtml(v.customerName)} menolak item custom.`,
			`Baris custom telah dibuang; jumlah pesanan kini <strong>${escapeHtml(v.totalFormatted)}</strong>.`,
			`Item sedia-ada yang lain boleh diteruskan seperti biasa.`,
		];
		const html = wrapHtml("🚫", `Item custom ditolak — ${v.shortId}`, lines, v.dashboardUrl, "Buka dashboard");
		const text = `🚫 Item custom ditolak untuk ${v.shortId}\n${v.customerName} menolak item custom.\nJumlah baru: ${v.totalFormatted}. Item sedia-ada lain boleh diteruskan.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	deliveryJobFailed: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🚨 Tempahan penghantaran gagal untuk ${v.shortId}`;
		const reasonLine = v.jobFailureReason
			? `Sebab: ${v.jobFailureReason}`
			: `Tempahan tamat tanpa rider.`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> — tempahan Lalamove tidak berjaya.`,
			escapeHtml(reasonLine),
			`Pembeli anda <strong>tidak</strong> dimaklumkan dan pesanan tidak berubah — buka pesanan untuk tempah rider semula.`,
		];
		const html = wrapHtml("🚨", `Tempahan penghantaran gagal — ${v.shortId}`, lines, v.dashboardUrl, "Tempah semula");
		const text = `🚨 Tempahan penghantaran gagal untuk ${v.shortId}\n${reasonLine}\nPembeli anda tidak dimaklumkan dan pesanan tidak berubah — buka pesanan untuk tempah rider semula.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	gatewayMismatch: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `⚠️ Bayaran online tidak sepadan dengan jumlah ${v.shortId}`;
		const paid = v.gatewayPaidFormatted ?? "jumlah tidak diketahui";
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${escapeHtml(v.customerName)}`,
			`Pembeli membayar <strong>${escapeHtml(paid)}</strong> melalui HitPay, tetapi jumlah pesanan ialah <strong>${escapeHtml(v.totalFormatted)}</strong>.`,
			`Ini biasanya bermakna jumlah berubah selepas pautan bayaran mereka dibuat.`,
			`Pesanan <strong>tidak</strong> ditanda berbayar secara automatik. Semak bayaran dalam dashboard HitPay anda (rujukan: ${escapeHtml(v.paymentReference ?? "—")}), kemudian selesaikan pada halaman pesanan — tanda diterima jika jumlahnya OK, atau buat refund melalui HitPay.`,
		];
		const html = wrapHtml("⚠️", `Bayaran online tidak sepadan — ${v.shortId}`, lines, v.dashboardUrl, "Buka pesanan");
		const text = `⚠️ Bayaran online tidak sepadan dengan jumlah ${v.shortId}\nPembeli membayar ${paid} melalui HitPay, tetapi jumlah pesanan ialah ${v.totalFormatted}.\nIni biasanya bermakna jumlah berubah selepas pautan bayaran mereka dibuat.\nPesanan TIDAK ditanda berbayar secara automatik. Semak bayaran dalam dashboard HitPay anda (rujukan: ${v.paymentReference ?? "—"}), kemudian selesaikan pada halaman pesanan — tanda diterima jika jumlahnya OK, atau buat refund melalui HitPay.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	gatewayPaidCancelled: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `⚠️ Pembeli membayar pesanan yang DIBATALKAN ${v.shortId}`;
		const paid = v.gatewayPaidFormatted ?? "jumlah tidak diketahui";
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${escapeHtml(v.customerName)}`,
			`Pembeli membayar <strong>${escapeHtml(paid)}</strong> melalui HitPay — tetapi pesanan ini sudah dibatalkan semasa bayaran masuk (pautan bayaran mereka kekal aktif sehingga sejam).`,
			`Pesanan <strong>tidak</strong> dibuka semula dan pembeli <strong>tidak</strong> dihubungi.`,
			`Buat refund dalam dashboard HitPay anda (rujukan: ${escapeHtml(v.paymentReference ?? "—")}) dan maklumkan kepada pembeli.`,
		];
		const html = wrapHtml("⚠️", `Bayaran selepas batal — ${v.shortId}`, lines, v.dashboardUrl, "Buka pesanan");
		const text = `⚠️ Pembeli membayar pesanan yang DIBATALKAN ${v.shortId}\nPembeli membayar ${paid} melalui HitPay — tetapi pesanan ini sudah dibatalkan semasa bayaran masuk (pautan bayaran mereka kekal aktif sehingga sejam).\nPesanan TIDAK dibuka semula dan pembeli TIDAK dihubungi.\nBuat refund dalam dashboard HitPay anda (rujukan: ${v.paymentReference ?? "—"}) dan maklumkan kepada pembeli.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
};

const zh = {
	newOrder: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🔔 新订单 ${v.shortId} · ${v.totalFormatted}`;
		const mockupHtml = `⚠️ <strong>客制化商品</strong> —— 请发送设计稿给顾客确认。顾客确认前先不收款。`;
		const mockupText = `⚠️ 客制化商品 —— 请发送设计稿给顾客确认。顾客确认前先不收款。`;
		const feePendingHtml = `🚚 <strong>配送费待确认</strong> —— 这个地址超出您的配送范围。请在订单页面设置配送费；设置前不会向顾客要求付款。`;
		const feePendingText = `🚚 配送费待确认 —— 这个地址超出您的配送范围。请在订单页面设置配送费；设置前不会向顾客要求付款。`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} 件商品 · ${escapeHtml(v.totalFormatted)}`,
			`顾客：${escapeHtml(v.customerName)}`,
			`方式：${methodLabel("zh", v)}`,
			...pickupDetailLines("zh", v, true),
			...(v.fulfilmentDateLabel
				? [`📅 需要日期：<strong>${escapeHtml(v.fulfilmentDateLabel)}</strong>`]
				: []),
			...(v.requiresMockup ? [mockupHtml] : []),
			...(v.deliveryFeePending ? [feePendingHtml] : []),
			`请打开您的后台管理这张订单。`,
		];
		const html = wrapHtml("🔔", `新订单 ${v.shortId}`, lines, v.dashboardUrl, "打开后台");
		const dateText = v.fulfilmentDateLabel ? `\n需要日期：${v.fulfilmentDateLabel}` : "";
		const text = `🔔 新订单 ${v.shortId}\n${v.itemCount} 件商品 · ${v.totalFormatted}\n顾客：${v.customerName}\n方式：${methodLabel("zh", v)}${pickupDetailLines("zh", v, false)
			.map((l) => `\n${l}`)
			.join("")}${dateText}\n${v.requiresMockup ? `\n${mockupText}\n` : ""}${v.deliveryFeePending ? `\n${feePendingText}\n` : ""}\n请打开您的后台管理这张订单。\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	orderConfirmed: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `✅ 订单 ${v.shortId} 已确认 · ${v.totalFormatted}`;
		const nextStepsHtml = v.requiresMockup
			? `⚠️ <strong>客制化商品</strong> —— 打包前请发送设计稿给顾客确认。顾客确认前先不收款。`
			: v.deliveryFeePending
				? `🚚 <strong>配送费待确认</strong> —— 这个地址超出您的配送范围。请在订单页面设置配送费；设置前不会向顾客要求付款。`
				: (isCollection(v)
					? "可以进行下一步了 —— 安排骑手上门向顾客取件。"
					: "可以进行下一步了 —— 收到付款后打包发货。");
		const nextStepsText = v.requiresMockup
			? `⚠️ 客制化商品 —— 打包前请发送设计稿给顾客确认。顾客确认前先不收款。`
			: v.deliveryFeePending
				? `🚚 配送费待确认 —— 这个地址超出您的配送范围。请在订单页面设置配送费；设置前不会向顾客要求付款。`
				: (isCollection(v)
					? "可以进行下一步了 —— 安排骑手上门向顾客取件。"
					: "可以进行下一步了 —— 收到付款后打包发货。");
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} 件商品 · ${escapeHtml(v.totalFormatted)}`,
			`顾客：${escapeHtml(v.customerName)}`,
			`方式：${methodLabel("zh", v)}`,
			...pickupDetailLines("zh", v, true),
			...(v.fulfilmentDateLabel
				? [`📅 需要日期：<strong>${escapeHtml(v.fulfilmentDateLabel)}</strong>`]
				: []),
			nextStepsHtml,
		];
		const html = wrapHtml("✅", `订单 ${v.shortId} 已确认`, lines, v.dashboardUrl, "打开后台");
		const dateText = v.fulfilmentDateLabel ? `\n需要日期：${v.fulfilmentDateLabel}` : "";
		const text = `✅ 订单 ${v.shortId} 已确认\n${v.itemCount} 件商品 · ${v.totalFormatted}\n顾客：${v.customerName}\n方式：${methodLabel("zh", v)}${pickupDetailLines("zh", v, false)
			.map((l) => `\n${l}`)
			.join("")}${dateText}\n\n${nextStepsText}\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	paymentClaimed: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🪙 已收到 ${v.shortId} 的付款提交 · ${v.totalFormatted}`;
		const refLine = v.paymentReference
			? `备注：<strong>${escapeHtml(v.paymentReference)}</strong>`
			: `备注：<em>未提供</em>`;
		const proofLine = v.proofUrl
			? `<a href="${escapeHtml(v.proofUrl)}" style="color:#2563eb;text-decoration:underline;">查看收据截图</a>`
			: `截图：<em>未提供</em>`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} 件商品 · ${escapeHtml(v.totalFormatted)}`,
			`顾客：${escapeHtml(v.customerName)}`,
			refLine,
			proofLine,
			`请在银行 App 核实，然后在后台确认。`,
		];
		const html = wrapHtml(
			"🪙",
			`已收到 ${v.shortId} 的付款提交`,
			lines,
			v.dashboardUrl,
			"打开后台",
		);
		const refTextLine = v.paymentReference
			? `备注：${v.paymentReference}`
			: `备注：未提供`;
		const proofTextLine = v.proofUrl
			? `截图：${v.proofUrl}`
			: `截图：未提供`;
		const text = `🪙 已收到 ${v.shortId} 的付款提交\n${v.itemCount} 件商品 · ${v.totalFormatted}\n顾客：${v.customerName}\n${refTextLine}\n${proofTextLine}\n\n请在银行 App 核实，然后在后台确认。\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	paymentReceived: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `✅ ${v.shortId} 款项已入账 · ${v.totalFormatted}`;
		const refLine = v.paymentReference
			? `HitPay 单号：<strong>${escapeHtml(v.paymentReference)}</strong>`
			: undefined;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} 件商品 · ${escapeHtml(v.totalFormatted)}`,
			`顾客：${escapeHtml(v.customerName)}`,
			...(refLine ? [refLine] : []),
			`已通过 HitPay 在线支付，订单已确认 — 无需核实。`,
		];
		const html = wrapHtml(
			"✅",
			`${v.shortId} 款项已入账`,
			lines,
			v.dashboardUrl,
			"打开后台",
		);
		const refTextLine = v.paymentReference
			? `\nHitPay 单号：${v.paymentReference}`
			: "";
		const text = `✅ ${v.shortId} 款项已入账\n${v.itemCount} 件商品 · ${v.totalFormatted}\n顾客：${v.customerName}${refTextLine}\n\n已通过 HitPay 在线支付，订单已确认 — 无需核实。\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	mockupApproved: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🎨 ${v.shortId} 的设计稿已确认`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> —— ${escapeHtml(v.customerName)} 已确认设计稿。`,
			`可以开始制作和打包这张订单了。`,
		];
		const html = wrapHtml("🎨", `设计稿已确认 —— ${v.shortId}`, lines, v.dashboardUrl, "打开后台");
		const text = `🎨 ${v.shortId} 的设计稿已确认\n${v.customerName} 已确认设计稿 —— 可以开始制作了。\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	mockupChangesRequested: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `✏️ ${v.shortId} 的设计稿需要修改`;
		const noteLine = v.mockupChangeNote
			? `要求修改：<em>${escapeHtml(v.mockupChangeNote)}</em>`
			: `没有留言。`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> —— ${escapeHtml(v.customerName)} 要求修改设计稿。`,
			noteLine,
			`请更新设计稿并重新发送给顾客确认。`,
		];
		const html = wrapHtml("✏️", `设计稿需要修改 —— ${v.shortId}`, lines, v.dashboardUrl, "打开后台");
		const noteText = v.mockupChangeNote
			? `要求修改：${v.mockupChangeNote}`
			: `没有留言。`;
		const text = `✏️ ${v.shortId} 的设计稿需要修改\n${v.customerName} 要求修改。\n${noteText}\n请更新并重新发送确认。\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	mockupDeclined: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🚫 ${v.shortId} 的客制化商品已取消`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> —— ${escapeHtml(v.customerName)} 取消了客制化商品。`,
			`客制化项目已移除；订单总额现在是 <strong>${escapeHtml(v.totalFormatted)}</strong>。`,
			`其余现货商品可以照常处理。`,
		];
		const html = wrapHtml("🚫", `客制化商品已取消 —— ${v.shortId}`, lines, v.dashboardUrl, "打开后台");
		const text = `🚫 ${v.shortId} 的客制化商品已取消\n${v.customerName} 取消了客制化商品。\n新总额：${v.totalFormatted}。其余现货商品可以照常处理。\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	deliveryJobFailed: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🚨 ${v.shortId} 的配送预订失败`;
		const reasonLine = v.jobFailureReason
			? `原因：${v.jobFailureReason}`
			: `预订没有配对到骑士。`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> —— Lalamove 预订没有成功。`,
			escapeHtml(reasonLine),
			`顾客<strong>还没有</strong>收到通知，订单也没有变化 —— 请打开订单重新预订骑士。`,
		];
		const html = wrapHtml("🚨", `配送预订失败 —— ${v.shortId}`, lines, v.dashboardUrl, "重新预订");
		const text = `🚨 ${v.shortId} 的配送预订失败\n${reasonLine}\n顾客还没有收到通知，订单也没有变化 —— 请打开订单重新预订骑士。\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	gatewayMismatch: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `⚠️ 线上付款金额与订单 ${v.shortId} 不符`;
		const paid = v.gatewayPaidFormatted ?? "未知金额";
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${escapeHtml(v.customerName)}`,
			`顾客通过 HitPay 支付了 <strong>${escapeHtml(paid)}</strong>，但订单总额是 <strong>${escapeHtml(v.totalFormatted)}</strong>。`,
			`这通常表示付款链接生成后订单总额发生了变化。`,
			`订单<strong>没有</strong>自动标记为已付款。请在您的 HitPay 后台核对这笔付款（参考号：${escapeHtml(v.paymentReference ?? "—")}），然后在订单页处理 —— 金额没问题就标记为已收款，否则通过 HitPay 退款。`,
		];
		const html = wrapHtml("⚠️", `线上付款金额不符 —— ${v.shortId}`, lines, v.dashboardUrl, "打开订单");
		const text = `⚠️ 线上付款金额与订单 ${v.shortId} 不符\n顾客通过 HitPay 支付了 ${paid}，但订单总额是 ${v.totalFormatted}。\n这通常表示付款链接生成后订单总额发生了变化。\n订单没有自动标记为已付款。请在您的 HitPay 后台核对这笔付款（参考号：${v.paymentReference ?? "—"}），然后在订单页处理 —— 金额没问题就标记为已收款，否则通过 HitPay 退款。\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	gatewayPaidCancelled: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `⚠️ 顾客支付了已取消的订单 ${v.shortId}`;
		const paid = v.gatewayPaidFormatted ?? "未知金额";
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${escapeHtml(v.customerName)}`,
			`顾客通过 HitPay 支付了 <strong>${escapeHtml(paid)}</strong> —— 但付款到账时这笔订单已被取消（付款链接最长会保持一小时有效）。`,
			`订单<strong>没有</strong>重新打开，顾客也<strong>没有</strong>收到消息。`,
			`请在您的 HitPay 后台退款（参考号：${escapeHtml(v.paymentReference ?? "—")}），并通知顾客。`,
		];
		const html = wrapHtml("⚠️", `取消后付款 —— ${v.shortId}`, lines, v.dashboardUrl, "打开订单");
		const text = `⚠️ 顾客支付了已取消的订单 ${v.shortId}\n顾客通过 HitPay 支付了 ${paid} —— 但付款到账时这笔订单已被取消（付款链接最长会保持一小时有效）。\n订单没有重新打开，顾客也没有收到消息。\n请在您的 HitPay 后台退款（参考号：${v.paymentReference ?? "—"}），并通知顾客。\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
};

const catalog: Record<Locale, Record<RetailerEmailKey, (v: RetailerEmailVars) => RenderedEmail>> = {
	en,
	ms,
	zh,
};

export function renderRetailerEmail(
	locale: Locale,
	key: RetailerEmailKey,
	vars: RetailerEmailVars,
): RenderedEmail {
	return catalog[locale][key](vars);
}
