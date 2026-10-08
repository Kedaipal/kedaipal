// Kedaipal Credits balance-notice emails (Credits T3, ClickUp z8r3fdf8hy), in
// the seller's locale. Five notices, each sent at most once per its trigger:
// `low` (into the last 20% of the month's credits, once a period), `locked` (out
// of credits), `stillLocked`
// (a monthly refresh left the store below zero), `unlocked` (back above zero)
// and `expiring` (bought credits expire in 14 days).
//
// Rules the copy keeps (register item 7): order counts only — never an RM
// balance, "wallet", "fee", "commission", a percentage or "pay as you go"; a
// debt reads "N orders owed". Every lock notice says what is paused AND what
// still works, and names the one way back for the store's situation.

import type { CreditUnlockRoute } from "./credits";
import { escapeHtml, type Locale, wrapHtml } from "./emailCopy";

export type CreditEmailKey =
	| "low"
	| "locked"
	| "stillLocked"
	| "unlocked"
	| "expiring";

export type CreditEmailVars = {
	storeName: string;
	billingUrl: string;
	/** What puts credits back for this store (decides the action line). */
	route: CreditUnlockRoute;
	/** Total balance — positive = orders left, negative = orders owed. */
	balance: number;
	/** Top-up packs are sold on this deployment (HitPay billing creds set). */
	topUpAvailable: boolean;
	/** A plan with more included orders, when upgrading beats topping up. */
	upgrade?: { planName: string; included: number };
	/** `expiring` only. */
	expiring?: { credits: number; onFormatted: string };
};

type Rendered = { subject: string; html: string; text: string };

const owed = (balance: number) => Math.max(0, -balance);
const left = (balance: number) => Math.max(0, balance);

/** The balance as the `credits_locked_utility` WhatsApp template's {{2}} —
 * "0 orders left" / "15 orders owed". zh rides the EN template (no approved
 * zh variant), so it gets the English phrase (TEMPLATE_LANGUAGE rule). */
export function creditBalancePhrase(balance: number, locale: Locale): string {
	if (locale === "ms")
		return balance < 0
			? `${owed(balance)} pesanan tertunggak`
			: `${left(balance)} pesanan lagi`;
	return balance < 0
		? `${owed(balance)} orders owed`
		: `${left(balance)} orders left`;
}

const copy: Record<
	Locale,
	{
		action: (v: CreditEmailVars) => string;
		cta: Record<CreditUnlockRoute | "open", string>;
		render: Record<CreditEmailKey, (v: CreditEmailVars) => Rendered>;
	}
> = {
	en: {
		action: (v) => {
			switch (v.route) {
				case "pick_plan":
					return "Your trial includes 200 orders. Pick a plan to keep working once they're used.";
				case "pay_invoice":
					return "Pay your invoice and this month's credits land straight away.";
				case "resume":
					return "Resume your plan and this month's credits land straight away.";
				case "subscribe":
					return "Choose a plan to get this month's credits.";
				case "topup":
					return `Add credits any time in Billing${v.topUpAvailable ? " with a credit pack" : ""}${v.upgrade ? ` — or move to ${escapeHtml(v.upgrade.planName)}, which includes ${v.upgrade.included} orders a month` : ""}.`;
			}
		},
		cta: {
			topup: "Add credits",
			pick_plan: "Choose a plan",
			pay_invoice: "Pay your invoice",
			resume: "Resume your plan",
			subscribe: "Choose a plan",
			open: "Open Billing",
		},
		render: {
			low: (v) => {
				const n = left(v.balance);
				const subject = `🔔 ${n} orders left on Kedaipal`;
				const lines = [
					`Hi ${escapeHtml(v.storeName)}, you have <strong>${n} orders left</strong>.`,
					"If you run out, your storefront stays open and new orders keep coming in — but you won't be able to open the new ones until credits land. Everything you've already paid a credit for carries on, as do your products and settings.",
					copy.en.action(v),
				];
				return {
					subject,
					html: wrapHtml("🔔", `${n} orders left`, lines, v.billingUrl, copy.en.cta[v.route]),
					text: `🔔 You have ${n} orders left on Kedaipal.\nIf you run out, new orders keep coming in, but you won't be able to open them until credits land. Your existing orders, products and settings carry on.\n\n${v.billingUrl}`,
				};
			},
			locked: (v) => {
				const debt = owed(v.balance);
				const subject = "⚠️ New orders are waiting on credits";
				const lines = [
					`Hi ${escapeHtml(v.storeName)}, you've used all your Kedaipal credits${debt > 0 ? ` (${debt} orders owed)` : ""}, so the orders arriving now are <strong>waiting on credits</strong>.`,
					"Your storefront stays open and new orders keep coming in — you just can't open a waiting one until credits land, and they open <strong>oldest first</strong>. <strong>Carrying on as normal:</strong> every order you've already paid a credit for, your products, and your settings. You can also cancel a waiting order to release the buyer.",
					copy.en.action(v),
				];
				return {
					subject,
					html: wrapHtml("⚠️", "New orders are waiting on credits", lines, v.billingUrl, copy.en.cta[v.route]),
					text: `⚠️ You're out of Kedaipal credits${debt > 0 ? ` (${debt} orders owed)` : ""}, so new orders are waiting on credits.\nThey open oldest first once credits land. Your existing orders, products and settings carry on, and cancelling always works.\n\n${v.billingUrl}`,
				};
			},
			stillLocked: (v) => {
				const debt = owed(v.balance);
				// A refresh can land exactly on 0 — still locked (the lock lifts
				// above zero), but "0 orders short" would read as a bug.
				const where = debt > 0 ? `still ${debt} orders short` : "at 0 orders left";
				const subject = `Your credits refreshed — you're ${where}`;
				const lines = [
					debt > 0
						? `Hi ${escapeHtml(v.storeName)}, this month's credits have arrived, but the orders you took after running out last month were more than they cover, so you're still <strong>${debt} orders short</strong>.`
						: `Hi ${escapeHtml(v.storeName)}, this month's credits have arrived, but they only just covered the orders you took after running out last month, so you're at <strong>0 orders left</strong>.`,
					"Until you're back above zero, the orders that arrived after you ran out stay waiting — they open oldest first as credits land. New orders keep coming in, your products and settings are untouched, and cancelling always works.",
					copy.en.action(v),
				];
				return {
					subject,
					html: wrapHtml("⚠️", debt > 0 ? `Still ${debt} orders short` : "Still at 0 orders left", lines, v.billingUrl, copy.en.cta[v.route]),
					text: `Your credits refreshed, but you're ${where}.\nThe orders that arrived after you ran out stay waiting until you're back above zero — oldest first.\n\n${v.billingUrl}`,
				};
			},
			unlocked: (v) => {
				const n = left(v.balance);
				const subject = `✅ Your waiting orders are open — ${n} orders left`;
				const lines = [
					`Hi ${escapeHtml(v.storeName)}, credits have been added and you have <strong>${n} orders left</strong>.`,
					"The orders that were waiting are open again — oldest first — and you can work them as normal.",
				];
				return {
					subject,
					html: wrapHtml("✅", "Your waiting orders are open", lines, v.billingUrl, copy.en.cta.open),
					text: `✅ Your waiting orders are open — ${n} orders left.\nThey opened oldest first, and you can work them as normal.\n\n${v.billingUrl}`,
				};
			},
			expiring: (v) => {
				const c = v.expiring?.credits ?? 0;
				const on = escapeHtml(v.expiring?.onFormatted ?? "soon");
				const subject = `⏳ ${c} bought credits expire on ${v.expiring?.onFormatted ?? "soon"}`;
				const lines = [
					`Hi ${escapeHtml(v.storeName)}, <strong>${c} of the credits you bought expire on ${on}</strong>.`,
					"Credits you buy last 12 months. Your plan's monthly credits are always used first, then your oldest bought credits — so these are next in line once this month's plan credits run out.",
				];
				return {
					subject,
					html: wrapHtml("⏳", `${c} credits expire on ${on}`, lines, v.billingUrl, copy.en.cta.open),
					text: `⏳ ${c} of the credits you bought expire on ${v.expiring?.onFormatted ?? "soon"}.\nBought credits last 12 months; plan credits are used first, then your oldest bought credits.\n\n${v.billingUrl}`,
				};
			},
		},
	},
	ms: {
		action: (v) => {
			switch (v.route) {
				case "pick_plan":
					return "Percubaan anda termasuk 200 pesanan. Pilih pelan untuk terus bekerja selepas ia habis.";
				case "pay_invoice":
					return "Bayar bil anda dan kredit bulan ini masuk serta-merta.";
				case "resume":
					return "Sambung semula pelan anda dan kredit bulan ini masuk serta-merta.";
				case "subscribe":
					return "Pilih pelan untuk mendapat kredit bulan ini.";
				case "topup":
					return `Tambah kredit bila-bila masa di Billing${v.topUpAvailable ? " dengan pek kredit" : ""}${v.upgrade ? ` — atau tukar ke ${escapeHtml(v.upgrade.planName)}, yang termasuk ${v.upgrade.included} pesanan sebulan` : ""}.`;
			}
		},
		cta: {
			topup: "Tambah kredit",
			pick_plan: "Pilih pelan",
			pay_invoice: "Bayar bil",
			resume: "Sambung pelan",
			subscribe: "Pilih pelan",
			open: "Buka Billing",
		},
		render: {
			low: (v) => {
				const n = left(v.balance);
				const subject = `🔔 ${n} pesanan lagi di Kedaipal`;
				const lines = [
					`Hai ${escapeHtml(v.storeName)}, anda ada <strong>${n} pesanan lagi</strong>.`,
					"Jika kredit habis, kedai online anda tetap dibuka dan pesanan baharu terus masuk — tetapi anda tidak boleh membuka pesanan baharu itu sehingga kredit masuk. Pesanan yang sudah berkredit, produk dan tetapan anda tidak terjejas.",
					copy.ms.action(v),
				];
				return {
					subject,
					html: wrapHtml("🔔", `${n} pesanan lagi`, lines, v.billingUrl, copy.ms.cta[v.route]),
					text: `🔔 Anda ada ${n} pesanan lagi di Kedaipal.\nJika kredit habis, pesanan baharu terus masuk, tetapi anda tidak boleh membukanya sehingga kredit masuk. Pesanan yang sudah berkredit, produk dan tetapan anda tidak terjejas.\n\n${v.billingUrl}`,
				};
			},
			locked: (v) => {
				const debt = owed(v.balance);
				const subject = "⚠️ Pesanan baharu menunggu kredit";
				const lines = [
					`Hai ${escapeHtml(v.storeName)}, anda telah menggunakan semua kredit Kedaipal${debt > 0 ? ` (${debt} pesanan tertunggak)` : ""}, jadi pesanan yang masuk sekarang <strong>menunggu kredit</strong>.`,
					"Kedai online anda tetap dibuka dan pesanan baharu terus masuk — anda cuma tidak boleh membuka pesanan yang menunggu sehingga kredit masuk, dan ia dibuka <strong>yang paling lama dahulu</strong>. <strong>Tidak terjejas:</strong> semua pesanan yang sudah berkredit, produk anda, dan tetapan anda. Anda juga boleh membatalkan pesanan yang menunggu untuk melepaskan pembeli.",
					copy.ms.action(v),
				];
				return {
					subject,
					html: wrapHtml("⚠️", "Pesanan baharu menunggu kredit", lines, v.billingUrl, copy.ms.cta[v.route]),
					text: `⚠️ Kredit Kedaipal anda telah habis${debt > 0 ? ` (${debt} pesanan tertunggak)` : ""}, jadi pesanan baharu menunggu kredit.\nIa dibuka yang paling lama dahulu sebaik kredit masuk. Pesanan lama, produk dan tetapan anda tidak terjejas, dan pembatalan sentiasa boleh.\n\n${v.billingUrl}`,
				};
			},
			stillLocked: (v) => {
				const debt = owed(v.balance);
				const where =
					debt > 0 ? `anda masih kurang ${debt} pesanan` : "baki anda kini 0 pesanan";
				const subject = `Kredit anda telah diperbaharui — ${where}`;
				const lines = [
					debt > 0
						? `Hai ${escapeHtml(v.storeName)}, kredit bulan ini telah masuk, tetapi pesanan yang anda terima selepas kredit habis bulan lepas melebihi jumlahnya, jadi anda masih <strong>kurang ${debt} pesanan</strong>.`
						: `Hai ${escapeHtml(v.storeName)}, kredit bulan ini telah masuk, tetapi hanya cukup untuk pesanan yang anda terima selepas kredit habis bulan lepas, jadi baki anda kini <strong>0 pesanan</strong>.`,
					"Selagi baki belum melebihi sifar, pesanan yang masuk selepas kredit habis kekal menunggu — ia dibuka yang paling lama dahulu sebaik kredit masuk. Pesanan baharu terus masuk, produk dan tetapan anda tidak terjejas, dan pembatalan sentiasa boleh.",
					copy.ms.action(v),
				];
				return {
					subject,
					html: wrapHtml("⚠️", debt > 0 ? `Masih kurang ${debt} pesanan` : "Baki anda 0 pesanan", lines, v.billingUrl, copy.ms.cta[v.route]),
					text: `Kredit anda telah diperbaharui, tetapi ${where}.\nPesanan yang masuk selepas kredit habis kekal menunggu sehingga baki melebihi sifar — yang paling lama dahulu.\n\n${v.billingUrl}`,
				};
			},
			unlocked: (v) => {
				const n = left(v.balance);
				const subject = `✅ Pesanan yang menunggu kini dibuka — ${n} pesanan lagi`;
				const lines = [
					`Hai ${escapeHtml(v.storeName)}, kredit telah ditambah dan anda ada <strong>${n} pesanan lagi</strong>.`,
					"Pesanan yang menunggu kini dibuka — yang paling lama dahulu — dan anda boleh menguruskannya seperti biasa.",
				];
				return {
					subject,
					html: wrapHtml("✅", "Pesanan yang menunggu kini dibuka", lines, v.billingUrl, copy.ms.cta.open),
					text: `✅ Pesanan yang menunggu kini dibuka — ${n} pesanan lagi.\nIa dibuka yang paling lama dahulu, dan anda boleh menguruskannya seperti biasa.\n\n${v.billingUrl}`,
				};
			},
			expiring: (v) => {
				const c = v.expiring?.credits ?? 0;
				const on = escapeHtml(v.expiring?.onFormatted ?? "tidak lama lagi");
				const subject = `⏳ ${c} kredit yang dibeli tamat tempoh pada ${v.expiring?.onFormatted ?? "tidak lama lagi"}`;
				const lines = [
					`Hai ${escapeHtml(v.storeName)}, <strong>${c} kredit yang anda beli akan tamat tempoh pada ${on}</strong>.`,
					"Kredit yang dibeli sah selama 12 bulan. Kredit bulanan pelan anda sentiasa digunakan dahulu, kemudian kredit yang dibeli paling awal — jadi kredit ini yang seterusnya digunakan sebaik kredit pelan bulan ini habis.",
				];
				return {
					subject,
					html: wrapHtml("⏳", `${c} kredit tamat tempoh pada ${on}`, lines, v.billingUrl, copy.ms.cta.open),
					text: `⏳ ${c} kredit yang anda beli tamat tempoh pada ${v.expiring?.onFormatted ?? "tidak lama lagi"}.\nKredit yang dibeli sah 12 bulan; kredit pelan digunakan dahulu, kemudian kredit yang dibeli paling awal.\n\n${v.billingUrl}`,
				};
			},
		},
	},
	zh: {
		// Vocabulary (docs/credits.md): credits = 点数 (unit 点, 1 点 = 1 张订单),
		// top up = 充值 — the same words /pricing and the receipts use.
		action: (v) => {
			switch (v.route) {
				case "pick_plan":
					return "您的试用包含 200 张订单。用完后请选择套餐以继续处理订单。";
				case "pay_invoice":
					return "支付账单后，本月点数立即到账。";
				case "resume":
					return "恢复套餐后，本月点数立即到账。";
				case "subscribe":
					return "选择套餐即可获得本月点数。";
				case "topup":
					return `您可随时在 Billing 页面${v.topUpAvailable ? "购买点数配套" : "充值"}${v.upgrade ? `，或升级到 ${escapeHtml(v.upgrade.planName)}（每月含 ${v.upgrade.included} 点）` : ""}。`;
			}
		},
		cta: {
			topup: "充值点数",
			pick_plan: "选择套餐",
			pay_invoice: "支付账单",
			resume: "恢复套餐",
			subscribe: "选择套餐",
			open: "打开 Billing",
		},
		render: {
			low: (v) => {
				const n = left(v.balance);
				const subject = `🔔 Kedaipal 还剩 ${n} 点`;
				const lines = [
					`${escapeHtml(v.storeName)} 您好，您还剩 <strong>${n} 点</strong>（每张订单用 1 点）。`,
					"点数用完后，您的网店仍然开放，新订单照常进来 —— 但在点数到账之前，您无法打开这些新订单。已经用过点数的订单、您的商品和设置都不受影响。",
					copy.zh.action(v),
				];
				return {
					subject,
					html: wrapHtml("🔔", `还剩 ${n} 点`, lines, v.billingUrl, copy.zh.cta[v.route]),
					text: `🔔 您在 Kedaipal 还剩 ${n} 点（每张订单用 1 点）。\n点数用完后新订单照常进来，但在点数到账之前您无法打开它们。已经用过点数的订单、您的商品和设置都不受影响。\n\n${v.billingUrl}`,
				};
			},
			locked: (v) => {
				const debt = owed(v.balance);
				const subject = "⚠️ 新订单正在等待点数";
				const lines = [
					`${escapeHtml(v.storeName)} 您好，您的 Kedaipal 点数已全部用完${debt > 0 ? `（欠 ${debt} 点）` : ""}，所以现在进来的订单<strong>正在等待点数</strong>。`,
					"您的网店仍然开放，新订单照常进来 —— 只是在点数到账之前无法打开等待中的订单，而且会<strong>按最早的先打开</strong>。<strong>不受影响：</strong>所有已经用过点数的订单、您的商品和设置。您也可以取消等待中的订单，让买家不必再等。",
					copy.zh.action(v),
				];
				return {
					subject,
					html: wrapHtml("⚠️", "新订单正在等待点数", lines, v.billingUrl, copy.zh.cta[v.route]),
					text: `⚠️ 您的 Kedaipal 点数已用完${debt > 0 ? `（欠 ${debt} 点）` : ""}，所以新订单正在等待点数。\n点数到账后会按最早的先打开。旧订单、商品和设置都不受影响，取消随时可用。\n\n${v.billingUrl}`,
				};
			},
			stillLocked: (v) => {
				const debt = owed(v.balance);
				// A refresh can land exactly on 0 — still locked (the lock lifts
				// above zero), but "欠 0 点" would read as a bug.
				const where = debt > 0 ? `您仍欠 ${debt} 点` : "您的点数为 0";
				const subject = `点数已更新 —— ${where}`;
				const lines = [
					debt > 0
						? `${escapeHtml(v.storeName)} 您好，本月点数已到账，但上个月点数用完后收到的订单超过了本月点数，因此您仍欠 <strong>${debt} 点</strong>。`
						: `${escapeHtml(v.storeName)} 您好，本月点数已到账，但刚好抵消上个月点数用完后收到的订单，因此您的点数为 <strong>0</strong>。`,
					"在点数回到零以上之前，点数用完后进来的订单会继续等待 —— 点数到账后按最早的先打开。新订单照常进来，您的商品和设置不受影响，取消随时可用。",
					copy.zh.action(v),
				];
				return {
					subject,
					html: wrapHtml("⚠️", debt > 0 ? `仍欠 ${debt} 点` : "点数为 0", lines, v.billingUrl, copy.zh.cta[v.route]),
					text: `点数已更新，但${where}。\n在点数回到零以上之前，点数用完后进来的订单会继续等待 —— 按最早的先打开。\n\n${v.billingUrl}`,
				};
			},
			unlocked: (v) => {
				const n = left(v.balance);
				const subject = `✅ 等待中的订单已打开 —— 还剩 ${n} 点`;
				const lines = [
					`${escapeHtml(v.storeName)} 您好，点数已到账，您还剩 <strong>${n} 点</strong>。`,
					"等待中的订单已经打开 —— 按最早的先打开 —— 您可以照常处理。",
				];
				return {
					subject,
					html: wrapHtml("✅", "等待中的订单已打开", lines, v.billingUrl, copy.zh.cta.open),
					text: `✅ 等待中的订单已打开 —— 还剩 ${n} 点。\n按最早的先打开，您可以照常处理。\n\n${v.billingUrl}`,
				};
			},
			expiring: (v) => {
				const c = v.expiring?.credits ?? 0;
				const on = escapeHtml(v.expiring?.onFormatted ?? "即将");
				const subject = `⏳ 您购买的 ${c} 点将于 ${v.expiring?.onFormatted ?? "即将"} 到期`;
				const lines = [
					`${escapeHtml(v.storeName)} 您好，<strong>您购买的 ${c} 点将于 ${on} 到期</strong>。`,
					"购买的点数有效期为 12 个月。系统总是先使用套餐的每月点数，再使用最早购买的点数 —— 因此本月套餐点数用完后，会先使用这部分。",
				];
				return {
					subject,
					html: wrapHtml("⏳", `${c} 点将于 ${on} 到期`, lines, v.billingUrl, copy.zh.cta.open),
					text: `⏳ 您购买的 ${c} 点将于 ${v.expiring?.onFormatted ?? "即将"} 到期。\n购买的点数有效期 12 个月；先用套餐点数，再用最早购买的点数。\n\n${v.billingUrl}`,
				};
			},
		},
	},
};

export function renderCreditEmail(
	locale: Locale,
	key: CreditEmailKey,
	vars: CreditEmailVars,
): Rendered {
	return copy[locale].render[key](vars);
}
