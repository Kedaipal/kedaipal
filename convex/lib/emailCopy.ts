// Retailer-facing email copy catalog. Pure — no Convex imports — to keep testable.
// Bilingual (en / ms) parity with the prior WhatsApp retailer alerts.

// Brand logo for email headers. Must be an absolute, publicly-reachable URL (email
// clients can't load localhost / app-relative assets), so it always points at the
// prod public asset — correct even when sent from a dev deployment.
export const LOGO_URL = "https://kedaipal.com/logo-2.png";

/** Left-aligned brand logo block for email headers. */
export function logoHeader(marginBottom = 16): string {
	return `<img src="${LOGO_URL}" alt="Kedaipal" width="132" style="display:block;border:0;outline:none;text-decoration:none;height:auto;margin:0 0 ${marginBottom}px 0;" />`;
}

export type Locale = "en" | "ms";

export type DeliveryMethod = "delivery" | "self_collect";

export type RetailerEmailKey =
	| "newOrder"
	| "orderConfirmed"
	| "paymentClaimed"
	| "mockupApproved"
	| "mockupChangesRequested"
	| "mockupDeclined";

export type RetailerEmailVars = {
	shortId: string;
	itemCount: number;
	totalFormatted: string;
	customerName: string;
	deliveryMethod: DeliveryMethod;
	storeName: string;
	dashboardUrl: string;
	// Optional — only set when key === "paymentClaimed". Reference the shopper
	// typed into the "I've paid" form (e.g. their bank transaction ID) and a
	// resolved Convex storage URL for the screenshot, if any.
	paymentReference?: string;
	proofUrl?: string;
	// Optional — only set when key === "mockupChangesRequested".
	mockupChangeNote?: string;
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
};

// Kind-aware pickup label. A drop-off meetup reads very differently from
// collecting at the seller's place, so the seller alert distinguishes them.
const pickupKindLabel: Record<
	Locale,
	Record<"self_collect" | "drop_off", string>
> = {
	en: { self_collect: "Self-collect", drop_off: "Drop-off" },
	ms: { self_collect: "Ambil sendiri", drop_off: "Penyerahan" },
};

/**
 * Effective "Method:" label. Delivery is delivery; a pickup order resolves to
 * the kind-specific label ("Self-collect" / "Drop-off") so the seller sees the
 * real arrangement, not a generic "Self-collect" for every pickup.
 */
function methodLabel(locale: Locale, v: RetailerEmailVars): string {
	if (v.deliveryMethod === "delivery") return deliveryLabel[locale].delivery;
	return pickupKindLabel[locale][v.pickupKind ?? "self_collect"];
}

/**
 * Extra lines describing the chosen pickup point (label · address, schedule
 * note, maps link). Empty for delivery orders or when no point was captured.
 * `asHtml` toggles anchor vs raw-URL for the maps link and escaping.
 */
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
				? `<a href="${escapeHtml(v.pickupMapsUrl)}" style="color:#2563eb;text-decoration:underline;">${locale === "ms" ? "Buka peta" : "Open in maps"}</a>`
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
				: `Ready for next steps — pack and ship when payment lands.`;
		const nextStepsText = v.requiresMockup
			? `⚠️ Custom item — send a mockup for the buyer to approve before packing. Payment is held until they approve.`
			: v.deliveryFeePending
				? `🚚 Delivery charge to confirm — this address is outside your bands. Set the charge on the order page; the buyer's payment ask is held until you do.`
				: `Ready for next steps — pack and ship when payment lands.`;
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
		const subject = `🪙 Pembayaran diterima untuk ${v.shortId} · ${v.totalFormatted}`;
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
			`Pembayaran diterima untuk ${v.shortId}`,
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
		const text = `🪙 Pembayaran diterima untuk ${v.shortId}\n${v.itemCount} item · ${v.totalFormatted}\nPelanggan: ${v.customerName}\n${refTextLine}\n${proofTextLine}\n\nSahkan di aplikasi bank anda, kemudian sahkan di dashboard.\n${v.dashboardUrl}`;
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
};

const catalog: Record<Locale, Record<RetailerEmailKey, (v: RetailerEmailVars) => RenderedEmail>> = {
	en,
	ms,
};

export function renderRetailerEmail(
	locale: Locale,
	key: RetailerEmailKey,
	vars: RetailerEmailVars,
): RenderedEmail {
	return catalog[locale][key](vars);
}
