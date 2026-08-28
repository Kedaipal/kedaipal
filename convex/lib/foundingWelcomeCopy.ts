/**
 * "Welcome, Founding Member #N of 10" — the one message a seller gets when a
 * Founding rank is claimed (`invoices.markPaid`).
 *
 * It lives here, channel-free, because it now goes out on TWO channels: the
 * WhatsApp send, and the email that covers for it when WhatsApp reaches nobody
 * (86eyrtz9t). Both read the SAME sentences from this module — a seller who
 * gets the fallback must not be told a different story from the one who didn't,
 * and a future copy edit must not be able to update only one of them.
 *
 * Pure (no Convex imports) so it unit-tests in isolation.
 */

import type { Locale } from "./locale";

/** The sentences, per locale, in the order both channels say them. */
const SENTENCES: Record<
	Locale,
	{
		greeting: (rank: number) => string;
		discount: string;
		onboarding: string;
		subject: (rank: number) => string;
		headline: (rank: number) => string;
		cta: string;
	}
> = {
	en: {
		greeting: (rank) => `🎉 Welcome, Founding Member #${rank} of 10!`,
		discount:
			"Thank you for backing Kedaipal early — your 30% lifetime discount is locked in for good.",
		onboarding:
			"We'll reach out to set up your white-glove onboarding call.",
		subject: (rank) => `🎉 You're Founding Member #${rank} of 10`,
		headline: (rank) => `Founding Member #${rank} of 10`,
		cta: "See your plan",
	},
	ms: {
		greeting: (rank) =>
			`🎉 Tahniah! Anda kini Founding Member #${rank} dari 10 di Kedaipal.`,
		discount:
			"Terima kasih kerana mempercayai kami awal — diskaun 30% seumur hidup anda kekal selamanya.",
		onboarding:
			"Pasukan kami akan hubungi anda untuk sesi white-glove.",
		subject: (rank) => `🎉 Anda Founding Member #${rank} dari 10`,
		headline: (rank) => `Founding Member #${rank} dari 10`,
		cta: "Lihat pelan anda",
	},
	zh: {
		greeting: (rank) =>
			`🎉 恭喜！您现在是 Kedaipal 10 位创始会员中的第 #${rank} 位。`,
		discount:
			"谢谢您这么早就信任我们 —— 您的终身 30% 折扣已经锁定，永久有效。",
		onboarding: "我们的团队会联系您安排专属的入驻协助。",
		subject: (rank) => `🎉 您是第 #${rank} 位创始会员（共 10 位）`,
		headline: (rank) => `创始会员 #${rank} / 10`,
		cta: "查看您的方案",
	},
};

/**
 * The WhatsApp body — one paragraph with the billing URL inline, because a
 * WhatsApp text has no button to put it on.
 */
export function foundingWelcomeBody(
	locale: Locale,
	rank: number,
	billingUrl: string,
): string {
	const s = SENTENCES[locale];
	const detailsLabel =
		locale === "ms" ? "Butiran" : locale === "zh" ? "详情" : "Details";
	return `${s.greeting(rank)} ${s.discount} ${s.onboarding} ${detailsLabel}: ${billingUrl}`;
}

/** The email fallback's parts — same sentences, laid out for the HTML shell. */
export function foundingWelcomeEmailParts(
	locale: Locale,
	rank: number,
): {
	subject: string;
	headline: string;
	ctaLabel: string;
	lines: string[];
} {
	const s = SENTENCES[locale];
	return {
		subject: s.subject(rank),
		headline: s.headline(rank),
		ctaLabel: s.cta,
		lines: [s.greeting(rank), s.discount, s.onboarding],
	};
}
