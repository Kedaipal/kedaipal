// Courier-wallet low-balance email (z8r3fdrgxc), in the seller's locale. Sent
// to the owner once per crossing into a needs-top-up state (see
// `lowWalletNotice` in courierWallet.ts), never per webhook.
//
// Rules the copy keeps: the money is the COURIER's — "<Provider> wallet",
// never "credits" (Kedaipal Credits own that word), and nothing implies
// Kedaipal holds or can top up this balance. Every email says what fails if
// nothing is done and where the top-up happens.

import type { WalletState } from "./courierWallet";
import { escapeHtml, type Locale, wrapHtml } from "./emailCopy";

export type LowWalletEmailVars = {
	storeName: string;
	providerName: string;
	state: WalletState;
	/** The known balance, formatted; null when the provider refused without
	 * naming one (Lalamove `short`). */
	balanceFormatted: string | null;
	/** The "low" line, formatted ("RM 20.00"). */
	lowLineFormatted: string;
	/** The provider's own web app, when it has one for the store's country. */
	topUpUrl: string | null;
	integrationsUrl: string;
};

type Rendered = { subject: string; html: string; text: string };

type Copy = {
	subject: (v: LowWalletEmailVars) => string;
	headline: (v: LowWalletEmailVars) => string;
	status: (v: LowWalletEmailVars) => string;
	consequence: (v: LowWalletEmailVars) => string;
	how: (v: LowWalletEmailVars) => string;
	cta: (v: LowWalletEmailVars) => string;
	footer: string;
};

const copy: Record<Locale, Copy> = {
	en: {
		subject: (v) =>
			v.state === "low"
				? `${v.providerName} wallet running low — ${v.storeName}`
				: `${v.providerName} wallet can't pay for bookings — ${v.storeName}`,
		headline: (v) =>
			v.state === "low"
				? `Your ${v.providerName} wallet is running low`
				: `Your ${v.providerName} wallet needs a top-up`,
		status: (v) =>
			v.state === "short"
				? `${v.providerName} just refused a booking because the wallet didn't have enough in it.`
				: v.state === "empty"
					? `${v.providerName} says the wallet has ${v.balanceFormatted ?? "nothing"} left.`
					: `${v.providerName} says the wallet has ${v.balanceFormatted} left — under ${v.lowLineFormatted}.`,
		consequence: (v) =>
			`${v.providerName} charges each booking to this wallet, so the next one fails if it can't cover the trip. Kedaipal doesn't hold this money and can't top it up for you.`,
		how: (v) =>
			`Top up in the ${v.providerName} account your store is connected to. The new balance shows in Kedaipal after ${v.providerName}'s next update.`,
		cta: (v) => `Open ${v.providerName}`,
		footer:
			"You'll hear from us again only after this wallet has been topped up and runs low again.",
	},
	ms: {
		subject: (v) =>
			v.state === "low"
				? `Dompet ${v.providerName} hampir habis — ${v.storeName}`
				: `Dompet ${v.providerName} tidak cukup untuk tempahan — ${v.storeName}`,
		headline: (v) =>
			v.state === "low"
				? `Dompet ${v.providerName} anda hampir habis`
				: `Dompet ${v.providerName} anda perlu ditambah nilai`,
		status: (v) =>
			v.state === "short"
				? `${v.providerName} baru menolak satu tempahan kerana baki dompet tidak mencukupi.`
				: v.state === "empty"
					? `${v.providerName} melaporkan baki dompet ${v.balanceFormatted ?? "kosong"}.`
					: `${v.providerName} melaporkan baki dompet ${v.balanceFormatted} — bawah ${v.lowLineFormatted}.`,
		consequence: (v) =>
			`${v.providerName} mengenakan setiap tempahan pada dompet ini, jadi tempahan seterusnya akan gagal jika baki tidak cukup. Kedaipal tidak memegang wang ini dan tidak boleh menambah nilainya untuk anda.`,
		how: (v) =>
			`Tambah nilai dalam akaun ${v.providerName} yang disambungkan ke kedai anda. Baki baharu akan dipaparkan dalam Kedaipal selepas kemas kini seterusnya daripada ${v.providerName}.`,
		cta: (v) => `Buka ${v.providerName}`,
		footer:
			"Kami hanya akan menghubungi anda lagi selepas dompet ini ditambah nilai dan hampir habis semula.",
	},
	zh: {
		subject: (v) =>
			v.state === "low"
				? `${v.providerName} 钱包余额不足 — ${v.storeName}`
				: `${v.providerName} 钱包无法支付配送 — ${v.storeName}`,
		headline: (v) =>
			v.state === "low"
				? `您的 ${v.providerName} 钱包余额不足`
				: `您的 ${v.providerName} 钱包需要充值`,
		status: (v) =>
			v.state === "short"
				? `${v.providerName} 刚因钱包余额不足拒绝了一笔预订。`
				: v.state === "empty"
					? `${v.providerName} 显示钱包余额为 ${v.balanceFormatted ?? "0"}。`
					: `${v.providerName} 显示钱包余额为 ${v.balanceFormatted}，低于 ${v.lowLineFormatted}。`,
		consequence: (v) =>
			`${v.providerName} 每次预订都从这个钱包扣款，余额不足时下一笔预订将会失败。Kedaipal 不持有这笔钱，也无法替您充值。`,
		how: (v) =>
			`请在您店铺所连接的 ${v.providerName} 账户中充值。${v.providerName} 下次更新后，新余额会显示在 Kedaipal 中。`,
		cta: (v) => `打开 ${v.providerName}`,
		footer: "只有在此钱包充值后再次余额不足时，我们才会再次通知您。",
	},
};

export function renderLowWalletEmail(
	locale: Locale,
	vars: LowWalletEmailVars,
): Rendered {
	const c = copy[locale];
	const lines = [c.status(vars), c.consequence(vars), c.how(vars)];
	const url = vars.topUpUrl ?? vars.integrationsUrl;
	const html = wrapHtml(
		"⚠️",
		c.headline(vars),
		lines.map(escapeHtml),
		url,
		c.cta(vars),
		escapeHtml(c.footer),
	);
	const text = [c.headline(vars), "", ...lines, "", url, "", c.footer].join(
		"\n",
	);
	return { subject: c.subject(vars), html, text };
}
