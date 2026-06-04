// Retailer-facing email copy catalog. Pure — no Convex imports — to keep testable.
// Bilingual (en / ms) parity with the prior WhatsApp retailer alerts.

export type Locale = "en" | "ms";

export type DeliveryMethod = "delivery" | "self_collect";

export type RetailerEmailKey =
	| "newOrder"
	| "orderConfirmed"
	| "paymentClaimed"
	| "mockupApproved"
	| "mockupChangesRequested";

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
};

const deliveryLabel: Record<Locale, Record<DeliveryMethod, string>> = {
	en: { delivery: "Delivery", self_collect: "Self-collect" },
	ms: { delivery: "Penghantaran", self_collect: "Ambil sendiri" },
};

type RenderedEmail = {
	subject: string;
	html: string;
	text: string;
};

function escapeHtml(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function wrapHtml(headlineEmoji: string, headline: string, lines: string[], dashboardUrl: string, ctaLabel: string): string {
	const body = lines.map((l) => `<p style="margin:0 0 8px 0;font-size:14px;color:#1f2937;">${l}</p>`).join("");
	return `<!doctype html><html><body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:24px 16px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:24px;">
<p style="margin:0 0 4px 0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;">Kedaipal</p>
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
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} item(s) · ${escapeHtml(v.totalFormatted)}`,
			`Customer: ${escapeHtml(v.customerName)}`,
			`Method: ${deliveryLabel.en[v.deliveryMethod]}`,
			`Open your dashboard to manage this order.`,
		];
		const html = wrapHtml("🔔", `New order ${v.shortId}`, lines, v.dashboardUrl, "Open dashboard");
		const text = `🔔 New order ${v.shortId}\n${v.itemCount} item(s) · ${v.totalFormatted}\nCustomer: ${v.customerName}\nMethod: ${deliveryLabel.en[v.deliveryMethod]}\n\nOpen your dashboard to manage this order.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	orderConfirmed: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `✅ Order ${v.shortId} confirmed · ${v.totalFormatted}`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} item(s) · ${escapeHtml(v.totalFormatted)}`,
			`Customer: ${escapeHtml(v.customerName)}`,
			`Method: ${deliveryLabel.en[v.deliveryMethod]}`,
			`Ready for next steps — pack and ship when payment lands.`,
		];
		const html = wrapHtml("✅", `Order ${v.shortId} confirmed`, lines, v.dashboardUrl, "Open dashboard");
		const text = `✅ Order ${v.shortId} confirmed\n${v.itemCount} item(s) · ${v.totalFormatted}\nCustomer: ${v.customerName}\nMethod: ${deliveryLabel.en[v.deliveryMethod]}\n\nReady for next steps.\n${v.dashboardUrl}`;
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
};

const ms = {
	newOrder: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `🔔 Pesanan baru ${v.shortId} · ${v.totalFormatted}`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} item · ${escapeHtml(v.totalFormatted)}`,
			`Pelanggan: ${escapeHtml(v.customerName)}`,
			`Kaedah: ${deliveryLabel.ms[v.deliveryMethod]}`,
			`Buka dashboard anda untuk menguruskan pesanan ini.`,
		];
		const html = wrapHtml("🔔", `Pesanan baru ${v.shortId}`, lines, v.dashboardUrl, "Buka dashboard");
		const text = `🔔 Pesanan baru ${v.shortId}\n${v.itemCount} item · ${v.totalFormatted}\nPelanggan: ${v.customerName}\nKaedah: ${deliveryLabel.ms[v.deliveryMethod]}\n\nBuka dashboard anda untuk menguruskan pesanan ini.\n${v.dashboardUrl}`;
		return { subject, html, text };
	},
	orderConfirmed: (v: RetailerEmailVars): RenderedEmail => {
		const subject = `✅ Pesanan ${v.shortId} disahkan · ${v.totalFormatted}`;
		const lines = [
			`<strong>${escapeHtml(v.shortId)}</strong> · ${v.itemCount} item · ${escapeHtml(v.totalFormatted)}`,
			`Pelanggan: ${escapeHtml(v.customerName)}`,
			`Kaedah: ${deliveryLabel.ms[v.deliveryMethod]}`,
			`Sedia untuk langkah seterusnya.`,
		];
		const html = wrapHtml("✅", `Pesanan ${v.shortId} disahkan`, lines, v.dashboardUrl, "Buka dashboard");
		const text = `✅ Pesanan ${v.shortId} telah disahkan\n${v.itemCount} item · ${v.totalFormatted}\nPelanggan: ${v.customerName}\nKaedah: ${deliveryLabel.ms[v.deliveryMethod]}\n\nSedia untuk langkah seterusnya.\n${v.dashboardUrl}`;
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
