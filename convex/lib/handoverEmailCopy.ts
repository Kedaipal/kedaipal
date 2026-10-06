// The handover invitation — the one email Kedaipal sends to someone who is not
// a seller yet (z8r3fdmy7n).
//
// It is sent to `retailers.pendingOwnerEmail`, which is the SAME state whether
// the store was pre-built for them (`createUnclaimedStore`) or handed over from
// a previous owner (`transferStoreOwnership`). One email for both doors,
// because from the recipient's side they are the same event: a shop exists and
// it is theirs if they sign in.
//
// WHAT IT DELIBERATELY IS NOT: a magic link. Claiming is proved by Clerk
// verifying the address, never by holding a URL — so this carries an ordinary
// sign-in link and no token. A forwarded invite gets the next person a sign-in
// page and nothing else, which is exactly the property a token would destroy.
//
// Nothing about the store's contents is named beyond its name: the recipient
// has consented to nothing yet, so the email must not ship them a catalogue,
// a buyer's details or a phone number.

import { escapeHtml, type Locale, wrapHtml } from "./emailCopy";

export type HandoverEmailVars = {
	storeName: string;
	/** Where they sign in. An ordinary app URL — never a claim token. */
	appUrl: string;
	/** The address this invite was sent to, repeated in the body so the
	 * recipient knows WHICH of their addresses has to be the one they use. */
	email: string;
};

type Rendered = { subject: string; html: string; text: string };

const copy: Record<Locale, (v: HandoverEmailVars) => Rendered> = {
	en: (v) => {
		const store = escapeHtml(v.storeName);
		const email = escapeHtml(v.email);
		const subject = `${v.storeName} is ready for you on Kedaipal`;
		const lines = [
			`We've set up <strong>${store}</strong> on Kedaipal, and it's waiting for you.`,
			`Sign in with <strong>${email}</strong> — that address is the key, so it has to be the one you use. The whole shop becomes yours on your first sign-in: your products, your settings, your storefront link.`,
			"Nothing is charged today. You get 14 days on Pro from the day you take it over, and you can decide about a plan after that.",
			"If you weren't expecting this, you can ignore it — nothing happens until someone signs in with that address.",
		];
		return {
			subject,
			html: wrapHtml("🎁", `${v.storeName} is ready for you`, lines, v.appUrl, "Take over my store"),
			text: `We've set up ${v.storeName} on Kedaipal, and it's waiting for you.\n\nSign in with ${v.email} — that address is the key, so it has to be the one you use. The whole shop becomes yours on your first sign-in: your products, your settings, your storefront link.\n\nNothing is charged today. You get 14 days on Pro from the day you take it over, and you can decide about a plan after that.\n\nTake over my store: ${v.appUrl}\n\nIf you weren't expecting this, you can ignore it — nothing happens until someone signs in with that address.`,
		};
	},
	ms: (v) => {
		const store = escapeHtml(v.storeName);
		const email = escapeHtml(v.email);
		const subject = `${v.storeName} sudah sedia untuk anda di Kedaipal`;
		const lines = [
			`Kami telah siapkan <strong>${store}</strong> di Kedaipal, dan ia menunggu anda.`,
			`Log masuk dengan <strong>${email}</strong> — alamat itulah kuncinya, jadi anda mesti guna yang itu. Seluruh kedai menjadi milik anda pada log masuk pertama: produk, tetapan dan pautan kedai anda.`,
			"Tiada bayaran hari ini. Anda dapat 14 hari Pro bermula hari anda mengambil alih, dan boleh pilih pelan selepas itu.",
			"Jika anda tidak menjangkakan e-mel ini, abaikan sahaja — tiada apa berlaku sehingga seseorang log masuk dengan alamat itu.",
		];
		return {
			subject,
			html: wrapHtml("🎁", `${v.storeName} sudah sedia untuk anda`, lines, v.appUrl, "Ambil alih kedai saya"),
			text: `Kami telah siapkan ${v.storeName} di Kedaipal, dan ia menunggu anda.\n\nLog masuk dengan ${v.email} — alamat itulah kuncinya, jadi anda mesti guna yang itu. Seluruh kedai menjadi milik anda pada log masuk pertama: produk, tetapan dan pautan kedai anda.\n\nTiada bayaran hari ini. Anda dapat 14 hari Pro bermula hari anda mengambil alih, dan boleh pilih pelan selepas itu.\n\nAmbil alih kedai saya: ${v.appUrl}\n\nJika anda tidak menjangkakan e-mel ini, abaikan sahaja — tiada apa berlaku sehingga seseorang log masuk dengan alamat itu.`,
		};
	},
	zh: (v) => {
		const store = escapeHtml(v.storeName);
		const email = escapeHtml(v.email);
		const subject = `${v.storeName} 已在 Kedaipal 为您准备好`;
		const lines = [
			`我们已在 Kedaipal 建好 <strong>${store}</strong>，正等着您。`,
			`请用 <strong>${email}</strong> 登录 —— 这个邮箱就是钥匙，必须用它。首次登录后整间店就是您的：商品、设置、店铺链接全都在。`,
			"今天不收费。从您接手那天起有 14 天 Pro 使用期，之后再决定方案。",
			"如果您并不知情，忽略即可 —— 在有人用该邮箱登录之前，什么都不会发生。",
		];
		return {
			subject,
			html: wrapHtml("🎁", `${v.storeName} 已为您准备好`, lines, v.appUrl, "接手我的店铺"),
			text: `我们已在 Kedaipal 建好 ${v.storeName}，正等着您。\n\n请用 ${v.email} 登录 —— 这个邮箱就是钥匙，必须用它。首次登录后整间店就是您的：商品、设置、店铺链接全都在。\n\n今天不收费。从您接手那天起有 14 天 Pro 使用期，之后再决定方案。\n\n接手我的店铺：${v.appUrl}\n\n如果您并不知情，忽略即可 —— 在有人用该邮箱登录之前，什么都不会发生。`,
		};
	},
};

export function renderHandoverInvite(
	locale: Locale,
	vars: HandoverEmailVars,
): Rendered {
	return copy[locale](vars);
}
