// Kedaipal Credits balance-notice emails (Credits T3, ClickUp z8r3fdf8hy), in
// the seller's locale. Five notices, each sent at most once per its trigger:
// `low` (10 orders left, once a period), `locked` (out of credits), `stillLocked`
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
					"If you run out, your storefront stays open and new orders keep coming in — but accepting and updating orders and editing products pause until you add credits.",
					copy.en.action(v),
				];
				return {
					subject,
					html: wrapHtml("🔔", `${n} orders left`, lines, v.billingUrl, copy.en.cta[v.route]),
					text: `🔔 You have ${n} orders left on Kedaipal.\nIf you run out, new orders keep coming in, but accepting and updating orders and editing products pause until you add credits.\n\n${v.billingUrl}`,
				};
			},
			locked: (v) => {
				const debt = owed(v.balance);
				const subject = "⚠️ You're out of credits — orders are still coming in";
				const lines = [
					`Hi ${escapeHtml(v.storeName)}, you've used all your Kedaipal credits${debt > 0 ? ` (${debt} orders owed)` : ""}.`,
					"Your storefront stays open and new orders keep coming in. <strong>Paused until you add credits:</strong> accepting and updating orders, and editing products. <strong>Still working:</strong> viewing every order, cancelling and refunding.",
					copy.en.action(v),
				];
				return {
					subject,
					html: wrapHtml("⚠️", "You're out of credits", lines, v.billingUrl, copy.en.cta[v.route]),
					text: `⚠️ You're out of Kedaipal credits${debt > 0 ? ` (${debt} orders owed)` : ""}.\nNew orders keep coming in. Accepting and updating orders and editing products are paused until you add credits; viewing, cancelling and refunding still work.\n\n${v.billingUrl}`,
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
					"Until you're back above zero, accepting and updating orders and editing products stay paused. New orders keep coming in, and you can still view, cancel and refund them.",
					copy.en.action(v),
				];
				return {
					subject,
					html: wrapHtml("⚠️", debt > 0 ? `Still ${debt} orders short` : "Still at 0 orders left", lines, v.billingUrl, copy.en.cta[v.route]),
					text: `Your credits refreshed, but you're ${where}.\nAccepting and updating orders and editing products stay paused until you're back above zero.\n\n${v.billingUrl}`,
				};
			},
			unlocked: (v) => {
				const n = left(v.balance);
				const subject = `✅ You're back in action — ${n} orders left`;
				const lines = [
					`Hi ${escapeHtml(v.storeName)}, credits have been added and you have <strong>${n} orders left</strong>.`,
					"Accepting and updating orders and editing products work again.",
				];
				return {
					subject,
					html: wrapHtml("✅", "You're back in action", lines, v.billingUrl, copy.en.cta.open),
					text: `✅ You're back in action — ${n} orders left.\nAccepting and updating orders and editing products work again.\n\n${v.billingUrl}`,
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
					"Jika kredit habis, kedai online anda tetap dibuka dan pesanan baharu terus masuk — tetapi menerima dan mengemas kini pesanan serta mengubah produk akan dijeda sehingga anda menambah kredit.",
					copy.ms.action(v),
				];
				return {
					subject,
					html: wrapHtml("🔔", `${n} pesanan lagi`, lines, v.billingUrl, copy.ms.cta[v.route]),
					text: `🔔 Anda ada ${n} pesanan lagi di Kedaipal.\nJika kredit habis, pesanan baharu terus masuk, tetapi menerima dan mengemas kini pesanan serta mengubah produk dijeda sehingga anda menambah kredit.\n\n${v.billingUrl}`,
				};
			},
			locked: (v) => {
				const debt = owed(v.balance);
				const subject = "⚠️ Kredit anda telah habis — pesanan masih masuk";
				const lines = [
					`Hai ${escapeHtml(v.storeName)}, anda telah menggunakan semua kredit Kedaipal${debt > 0 ? ` (${debt} pesanan tertunggak)` : ""}.`,
					"Kedai online anda tetap dibuka dan pesanan baharu terus masuk. <strong>Dijeda sehingga anda menambah kredit:</strong> menerima dan mengemas kini pesanan, serta mengubah produk. <strong>Masih boleh:</strong> melihat semua pesanan, membatalkan dan membuat bayaran balik.",
					copy.ms.action(v),
				];
				return {
					subject,
					html: wrapHtml("⚠️", "Kredit anda telah habis", lines, v.billingUrl, copy.ms.cta[v.route]),
					text: `⚠️ Kredit Kedaipal anda telah habis${debt > 0 ? ` (${debt} pesanan tertunggak)` : ""}.\nPesanan baharu terus masuk. Menerima dan mengemas kini pesanan serta mengubah produk dijeda sehingga anda menambah kredit; melihat, membatalkan dan bayaran balik masih boleh.\n\n${v.billingUrl}`,
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
					"Selagi baki belum melebihi sifar, menerima dan mengemas kini pesanan serta mengubah produk kekal dijeda. Pesanan baharu terus masuk, dan anda masih boleh melihat, membatalkan dan membuat bayaran balik.",
					copy.ms.action(v),
				];
				return {
					subject,
					html: wrapHtml("⚠️", debt > 0 ? `Masih kurang ${debt} pesanan` : "Baki anda 0 pesanan", lines, v.billingUrl, copy.ms.cta[v.route]),
					text: `Kredit anda telah diperbaharui, tetapi ${where}.\nMenerima dan mengemas kini pesanan serta mengubah produk kekal dijeda sehingga baki melebihi sifar.\n\n${v.billingUrl}`,
				};
			},
			unlocked: (v) => {
				const n = left(v.balance);
				const subject = `✅ Anda kembali aktif — ${n} pesanan lagi`;
				const lines = [
					`Hai ${escapeHtml(v.storeName)}, kredit telah ditambah dan anda ada <strong>${n} pesanan lagi</strong>.`,
					"Menerima dan mengemas kini pesanan serta mengubah produk boleh dibuat semula.",
				];
				return {
					subject,
					html: wrapHtml("✅", "Anda kembali aktif", lines, v.billingUrl, copy.ms.cta.open),
					text: `✅ Anda kembali aktif — ${n} pesanan lagi.\nMenerima dan mengemas kini pesanan serta mengubah produk boleh dibuat semula.\n\n${v.billingUrl}`,
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
		action: (v) => {
			switch (v.route) {
				case "pick_plan":
					return "您的试用包含 200 笔订单。用完后请选择套餐以继续处理订单。";
				case "pay_invoice":
					return "支付账单后，本月额度立即到账。";
				case "resume":
					return "恢复套餐后，本月额度立即到账。";
				case "subscribe":
					return "选择套餐即可获得本月额度。";
				case "topup":
					return `您可随时在 Billing 页面${v.topUpAvailable ? "购买额度包" : "补充额度"}${v.upgrade ? `，或升级到 ${escapeHtml(v.upgrade.planName)}（每月含 ${v.upgrade.included} 笔订单）` : ""}。`;
			}
		},
		cta: {
			topup: "补充额度",
			pick_plan: "选择套餐",
			pay_invoice: "支付账单",
			resume: "恢复套餐",
			subscribe: "选择套餐",
			open: "打开 Billing",
		},
		render: {
			low: (v) => {
				const n = left(v.balance);
				const subject = `🔔 Kedaipal 还剩 ${n} 笔订单额度`;
				const lines = [
					`${escapeHtml(v.storeName)} 您好，您还剩 <strong>${n} 笔订单</strong>的额度。`,
					"额度用完后，您的网店仍然开放，新订单照常进来 —— 但在您补充额度之前，接单、更新订单和编辑商品都会暂停。",
					copy.zh.action(v),
				];
				return {
					subject,
					html: wrapHtml("🔔", `还剩 ${n} 笔订单`, lines, v.billingUrl, copy.zh.cta[v.route]),
					text: `🔔 您在 Kedaipal 还剩 ${n} 笔订单额度。\n额度用完后新订单照常进来，但接单、更新订单和编辑商品会暂停，直到您补充额度。\n\n${v.billingUrl}`,
				};
			},
			locked: (v) => {
				const debt = owed(v.balance);
				const subject = "⚠️ 您的额度已用完 —— 新订单仍在进来";
				const lines = [
					`${escapeHtml(v.storeName)} 您好，您的 Kedaipal 额度已全部用完${debt > 0 ? `（欠 ${debt} 笔订单）` : ""}。`,
					"您的网店仍然开放，新订单照常进来。<strong>补充额度前暂停：</strong>接单、更新订单、编辑商品。<strong>仍可使用：</strong>查看所有订单、取消订单和退款。",
					copy.zh.action(v),
				];
				return {
					subject,
					html: wrapHtml("⚠️", "您的额度已用完", lines, v.billingUrl, copy.zh.cta[v.route]),
					text: `⚠️ 您的 Kedaipal 额度已用完${debt > 0 ? `（欠 ${debt} 笔订单）` : ""}。\n新订单照常进来。接单、更新订单和编辑商品已暂停，直到您补充额度；查看、取消和退款仍可使用。\n\n${v.billingUrl}`,
				};
			},
			stillLocked: (v) => {
				const debt = owed(v.balance);
				const where = debt > 0 ? `您仍欠 ${debt} 笔订单` : "您的余额为 0 笔订单";
				const subject = `额度已更新 —— ${where}`;
				const lines = [
					debt > 0
						? `${escapeHtml(v.storeName)} 您好，本月额度已到账，但上个月额度用完后收到的订单超过了本月额度，因此您仍欠 <strong>${debt} 笔订单</strong>。`
						: `${escapeHtml(v.storeName)} 您好，本月额度已到账，但刚好抵消上个月额度用完后收到的订单，因此您的余额为 <strong>0 笔订单</strong>。`,
					"在余额回到零以上之前，接单、更新订单和编辑商品仍然暂停。新订单照常进来，您仍可查看、取消订单和退款。",
					copy.zh.action(v),
				];
				return {
					subject,
					html: wrapHtml("⚠️", debt > 0 ? `仍欠 ${debt} 笔订单` : "余额为 0 笔订单", lines, v.billingUrl, copy.zh.cta[v.route]),
					text: `额度已更新，但${where}。\n在余额回到零以上之前，接单、更新订单和编辑商品仍然暂停。\n\n${v.billingUrl}`,
				};
			},
			unlocked: (v) => {
				const n = left(v.balance);
				const subject = `✅ 已恢复 —— 还剩 ${n} 笔订单额度`;
				const lines = [
					`${escapeHtml(v.storeName)} 您好，额度已补充，您还剩 <strong>${n} 笔订单</strong>的额度。`,
					"接单、更新订单和编辑商品已恢复正常。",
				];
				return {
					subject,
					html: wrapHtml("✅", "已恢复正常", lines, v.billingUrl, copy.zh.cta.open),
					text: `✅ 已恢复 —— 还剩 ${n} 笔订单额度。\n接单、更新订单和编辑商品已恢复正常。\n\n${v.billingUrl}`,
				};
			},
			expiring: (v) => {
				const c = v.expiring?.credits ?? 0;
				const on = escapeHtml(v.expiring?.onFormatted ?? "即将");
				const subject = `⏳ 您购买的 ${c} 笔额度将于 ${v.expiring?.onFormatted ?? "即将"} 到期`;
				const lines = [
					`${escapeHtml(v.storeName)} 您好，<strong>您购买的 ${c} 笔额度将于 ${on} 到期</strong>。`,
					"购买的额度有效期为 12 个月。系统总是先使用套餐的每月额度，再使用最早购买的额度 —— 因此本月套餐额度用完后，会先使用这部分。",
				];
				return {
					subject,
					html: wrapHtml("⏳", `${c} 笔额度将于 ${on} 到期`, lines, v.billingUrl, copy.zh.cta.open),
					text: `⏳ 您购买的 ${c} 笔额度将于 ${v.expiring?.onFormatted ?? "即将"} 到期。\n购买的额度有效期 12 个月；先用套餐额度，再用最早购买的额度。\n\n${v.billingUrl}`,
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
