// Referral reward emails (Referral T2, ClickUp 86ey82hke, docs/referrals.md),
// in the seller's locale. Two moments, both at the referee's first paid plan
// invoice: the REFEREE hears their bonus landed and who sent them; the
// REFERRER hears the store they sent has started its plan and their credits
// landed. Email only — no WhatsApp (Meta bills every send since 1 Oct 2026).
//
// Rules the copy keeps (the credits register): credits are counted in orders,
// never as RM, "wallet", "commission" or a percentage; the 12-month life of
// bought credits is always stated, because a bonus that quietly expires is a
// broken promise.

import { escapeHtml, type Locale, wrapHtml } from "./emailCopy";
import { MYT_OFFSET_MS } from "./fulfilmentDate";

export type ReferralEmailKind = "referee" | "referrer";

export type ReferralEmailVars = {
	/** The store the email is TO. */
	storeName: string;
	/** The other side: the referrer (to a referee) or the referee (to a
	 * referrer). `null` = a referrer store since deleted. */
	otherStoreName: string | null;
	credits: number;
	/** When these credits expire (ms). */
	expiresAt: number;
	/** The billing page, where the balance and Credit activity live. */
	billingUrl: string;
	/** The referrer's own link, so the email can say "keep sharing". */
	referralLink?: string;
};

type Rendered = { subject: string; html: string; text: string };

const MONTHS: Record<Locale, string[]> = {
	en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
	ms: ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"],
	zh: [],
};

/** "16 Oct 2027" / "16 Okt 2027" / "2027年10月16日" on the MYT calendar. */
export function referralExpiryDate(ms: number, locale: Locale): string {
	const d = new Date(ms + MYT_OFFSET_MS);
	const day = d.getUTCDate();
	const month = d.getUTCMonth();
	const year = d.getUTCFullYear();
	if (locale === "zh") return `${year}年${month + 1}月${day}日`;
	return `${day} ${MONTHS[locale][month]} ${year}`;
}

type Renderer = (v: ReferralEmailVars, on: string) => Rendered;

const copy: Record<Locale, Record<ReferralEmailKind, Renderer>> = {
	en: {
		referee: (v, on) => {
			const who = v.otherStoreName ?? "a Kedaipal seller";
			const subject = `🎁 ${v.credits} bonus credits added — thanks to ${who}`;
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, your first invoice is paid, so your referral bonus has landed: <strong>${v.credits} bonus credits</strong>, on top of your plan's monthly credits.`,
				`You were referred by ${escapeHtml(who)}. 1 credit = 1 order. Your plan's monthly credits are used first, then these — and they last 12 months, until ${escapeHtml(on)}.`,
			];
			return {
				subject,
				html: wrapHtml("🎁", `${v.credits} bonus credits added`, lines, v.billingUrl, "See your credits"),
				text: `🎁 ${v.credits} bonus credits added — your referral bonus from ${who}.\n1 credit = 1 order. Plan credits are used first; these last until ${on}.\n\n${v.billingUrl}`,
			};
		},
		referrer: (v, on) => {
			const who = v.otherStoreName ?? "A store you referred";
			const subject = `🎁 ${v.credits} credits added — ${who} started their plan`;
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, <strong>${escapeHtml(who)}</strong> signed up through your referral link and has paid for their plan — so <strong>${v.credits} bonus credits</strong> have landed in your balance.`,
				`1 credit = 1 order. Your plan's monthly credits are used first, then these — and they last 12 months, until ${escapeHtml(on)}.`,
				...(v.referralLink
					? [`Know another kedai that sells on WhatsApp? Your link: ${escapeHtml(v.referralLink)}`]
					: []),
			];
			return {
				subject,
				html: wrapHtml("🎁", `${v.credits} referral credits added`, lines, v.billingUrl, "See your credits"),
				text: `🎁 ${who} started their plan, so ${v.credits} referral credits landed in your balance.\n1 credit = 1 order; they last until ${on}.${v.referralLink ? `\nYour link: ${v.referralLink}` : ""}\n\n${v.billingUrl}`,
			};
		},
	},
	ms: {
		referee: (v, on) => {
			const who = v.otherStoreName ?? "seorang penjual Kedaipal";
			const subject = `🎁 ${v.credits} kredit bonus ditambah — terima kasih kepada ${who}`;
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, invois pertama anda sudah dibayar, jadi bonus rujukan anda sudah masuk: <strong>${v.credits} kredit bonus</strong>, selain kredit bulanan pelan anda.`,
				`Anda dirujuk oleh ${escapeHtml(who)}. 1 kredit = 1 pesanan. Kredit bulanan pelan digunakan dahulu, kemudian kredit ini — sah selama 12 bulan, hingga ${escapeHtml(on)}.`,
			];
			return {
				subject,
				html: wrapHtml("🎁", `${v.credits} kredit bonus ditambah`, lines, v.billingUrl, "Lihat kredit anda"),
				text: `🎁 ${v.credits} kredit bonus ditambah — bonus rujukan daripada ${who}.\n1 kredit = 1 pesanan. Kredit pelan digunakan dahulu; kredit ini sah hingga ${on}.\n\n${v.billingUrl}`,
			};
		},
		referrer: (v, on) => {
			const who = v.otherStoreName ?? "Kedai yang anda rujuk";
			const subject = `🎁 ${v.credits} kredit ditambah — ${who} sudah mula pelan mereka`;
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, <strong>${escapeHtml(who)}</strong> mendaftar melalui pautan rujukan anda dan sudah membayar pelan mereka — jadi <strong>${v.credits} kredit bonus</strong> sudah masuk ke baki anda.`,
				`1 kredit = 1 pesanan. Kredit bulanan pelan digunakan dahulu, kemudian kredit ini — sah selama 12 bulan, hingga ${escapeHtml(on)}.`,
				...(v.referralLink
					? [`Kenal kedai lain yang jual di WhatsApp? Pautan anda: ${escapeHtml(v.referralLink)}`]
					: []),
			];
			return {
				subject,
				html: wrapHtml("🎁", `${v.credits} kredit rujukan ditambah`, lines, v.billingUrl, "Lihat kredit anda"),
				text: `🎁 ${who} sudah mula pelan mereka, jadi ${v.credits} kredit rujukan masuk ke baki anda.\n1 kredit = 1 pesanan; sah hingga ${on}.${v.referralLink ? `\nPautan anda: ${v.referralLink}` : ""}\n\n${v.billingUrl}`,
			};
		},
	},
	zh: {
		referee: (v, on) => {
			const who = v.otherStoreName ?? "一位 Kedaipal 卖家";
			const subject = `🎁 已添加 ${v.credits} 点奖励 —— 感谢 ${who}`;
			const lines = [
				`${escapeHtml(v.storeName)} 您好，您的第一张账单已付款，推荐奖励已到账：<strong>${v.credits} 点奖励</strong>，另加您方案的每月点数。`,
				`推荐您的是 ${escapeHtml(who)}。1 点 = 1 张订单。先用方案的每月点数，再用这些点数 —— 有效期 12 个月，至 ${escapeHtml(on)}。`,
			];
			return {
				subject,
				html: wrapHtml("🎁", `已添加 ${v.credits} 点奖励`, lines, v.billingUrl, "查看您的点数"),
				text: `🎁 已添加 ${v.credits} 点奖励 —— 来自 ${who} 的推荐。\n1 点 = 1 张订单。先用方案点数；这些点数有效至 ${on}。\n\n${v.billingUrl}`,
			};
		},
		referrer: (v, on) => {
			const who = v.otherStoreName ?? "您推荐的店铺";
			const subject = `🎁 已添加 ${v.credits} 点 —— ${who} 已开始使用方案`;
			const lines = [
				`${escapeHtml(v.storeName)} 您好，<strong>${escapeHtml(who)}</strong> 通过您的推荐链接注册并已为方案付款 —— <strong>${v.credits} 点奖励</strong> 已存入您的余额。`,
				`1 点 = 1 张订单。先用方案的每月点数，再用这些点数 —— 有效期 12 个月，至 ${escapeHtml(on)}。`,
				...(v.referralLink
					? [`认识其他在 WhatsApp 上卖货的店家？您的链接：${escapeHtml(v.referralLink)}`]
					: []),
			];
			return {
				subject,
				html: wrapHtml("🎁", `已添加 ${v.credits} 点推荐奖励`, lines, v.billingUrl, "查看您的点数"),
				text: `🎁 ${who} 已开始使用方案，${v.credits} 点推荐奖励已到账。\n1 点 = 1 张订单；有效至 ${on}。${v.referralLink ? `\n您的链接：${v.referralLink}` : ""}\n\n${v.billingUrl}`,
			};
		},
	},
};

export function renderReferralEmail(
	locale: Locale,
	kind: ReferralEmailKind,
	vars: ReferralEmailVars,
): Rendered {
	return copy[locale][kind](vars, referralExpiryDate(vars.expiresAt, locale));
}

/**
 * The referral invitation that rides the paid-invoice receipt (the push, 28
 * Oct 2026, docs/referrals.md): a seller who just paid is the one most ready
 * to say "worth it" to a friend, and the receipt is the one email every
 * paying store gets every month. One author for the line, in the seller's
 * locale; the receipt renderer places it under its CTA. `html` is escaped
 * for the `afterCta` slot, `text` goes in the plain-text body. The offer is
 * said in ORDERS, like every other share surface — "bonus credits" stays
 * only where a balance is counted (Billing, the reward emails).
 */
export function referralReceiptFooter(
	locale: Locale,
	args: { link: string; proCredits: number },
): { html: string; text: string } {
	const link = args.link;
	const n = args.proCredits;
	const lines: Record<Locale, { lead: string; offer: string }> = {
		en: {
			lead: "Know a kedai still taking orders by hand in WhatsApp?",
			offer: `Send them your link — when they start Pro, you both get ${n} free orders.`,
		},
		ms: {
			lead: "Kenal kedai yang masih ambil pesanan secara manual di WhatsApp?",
			offer: `Hantar pautan anda — bila mereka mula Pro, anda berdua dapat ${n} pesanan percuma.`,
		},
		zh: {
			lead: "认识还在 WhatsApp 上手动接单的店家？",
			offer: `把您的链接发给他们 —— 他们开始使用 Pro 后，你们双方各得 ${n} 笔免费订单。`,
		},
	};
	const l = lines[locale];
	return {
		html: `<strong>${escapeHtml(l.lead)}</strong> ${escapeHtml(l.offer)}<br><a href="${escapeHtml(link)}" style="color:#047857;">${escapeHtml(link)}</a>`,
		text: `${l.lead} ${l.offer}\n${link}`,
	};
}
