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
// The recipient is usually NEW to Kedaipal, so that sign-in page must create a
// login for an unknown address rather than refuse it — `<SignIn withSignUp>`
// (z8r3fdwdvq). The copy says so, so it never tells a new person to do
// something they can't.
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

// The address is the one thing the recipient must get right, so it sits in its
// own card rather than mid-sentence — the green of the billing emails' Pay-now
// panel, so a Kedaipal email has one "this is the part that matters" look.
// `display:block` spans, not divs: wrapHtml wraps every line in a <p>.
function keyCard(label: string, email: string, note: string): string {
	return `<span style="display:block;margin:4px 0 4px 0;padding:14px 16px;border:1px solid #a7f3d0;background:#ecfdf5;border-radius:12px;"><span style="display:block;font-size:12px;font-weight:600;letter-spacing:0.02em;color:#047857;">${label}</span><span style="display:block;margin:4px 0 0 0;font-size:16px;font-weight:700;color:#111827;word-break:break-all;">${email}</span><span style="display:block;margin:6px 0 0 0;font-size:12px;line-height:1.5;color:#047857;">${note}</span></span>`;
}

type Copy = {
	subject: string;
	headline: string;
	intro: (store: string) => string;
	keyLabel: string;
	keyNote: string;
	/** HTML points at the button; the plain-text part at the link under it. */
	firstTimer: { html: string; text: string };
	takeover: string;
	free: string;
	cta: string;
	ignore: string;
	/** ": " — full-width "：" in Chinese. */
	colon: string;
};

const copy: Record<Locale, (storeName: string) => Copy> = {
	en: (storeName) => ({
		subject: `${storeName} is ready for you on Kedaipal`,
		headline: `${storeName} is ready for you`,
		intro: (store) => `We've set up ${store} on Kedaipal, and it's waiting for you.`,
		keyLabel: "Sign in with",
		keyNote: "This address is the key — it has to be the one you use.",
		firstTimer: {
			html: "<strong>New to Kedaipal?</strong> The button below creates your login — there's no separate sign-up.",
			text: "New to Kedaipal? The link below creates your login — there's no separate sign-up.",
		},
		takeover: "The whole shop becomes yours on your first sign-in: your products, your settings, your storefront link.",
		free: "Nothing is charged today. You get 14 days on Pro from the day you take it over, and you can decide about a plan after that.",
		cta: "Take over my store",
		ignore: "If you weren't expecting this, you can ignore it — nothing happens until someone signs in with that address.",
		colon: ": ",
	}),
	ms: (storeName) => ({
		subject: `${storeName} sudah sedia untuk anda di Kedaipal`,
		headline: `${storeName} sudah sedia untuk anda`,
		intro: (store) => `Kami telah siapkan ${store} di Kedaipal, dan ia menunggu anda.`,
		keyLabel: "Log masuk dengan",
		keyNote: "Alamat inilah kuncinya — anda mesti guna yang ini.",
		firstTimer: {
			html: "<strong>Baru di Kedaipal?</strong> Butang di bawah akan terus mendaftarkan akaun anda — tiada langkah daftar berasingan.",
			text: "Baru di Kedaipal? Pautan di bawah akan terus mendaftarkan akaun anda — tiada langkah daftar berasingan.",
		},
		takeover: "Seluruh kedai menjadi milik anda pada log masuk pertama: produk, tetapan dan pautan kedai anda.",
		free: "Tiada bayaran hari ini. Anda dapat 14 hari Pro bermula hari anda mengambil alih, dan boleh pilih pelan selepas itu.",
		cta: "Ambil alih kedai saya",
		ignore: "Jika anda tidak menjangkakan e-mel ini, abaikan sahaja — tiada apa berlaku sehingga seseorang log masuk dengan alamat itu.",
		colon: ": ",
	}),
	zh: (storeName) => ({
		subject: `${storeName} 已在 Kedaipal 为您准备好`,
		headline: `${storeName} 已为您准备好`,
		intro: (store) => `我们已在 Kedaipal 建好 ${store}，正等着您。`,
		keyLabel: "请用这个邮箱登录",
		keyNote: "这个邮箱就是钥匙 —— 必须用它。",
		firstTimer: {
			html: "<strong>第一次用 Kedaipal？</strong>点下面的按钮就会为您创建账号，无需另外注册。",
			text: "第一次用 Kedaipal？点下面的链接就会为您创建账号，无需另外注册。",
		},
		takeover: "首次登录后整间店就是您的：商品、设置、店铺链接全都在。",
		free: "今天不收费。从您接手那天起有 14 天 Pro 使用期，之后再决定方案。",
		cta: "接手我的店铺",
		ignore: "如果您并不知情，忽略即可 —— 在有人用该邮箱登录之前，什么都不会发生。",
		colon: "：",
	}),
};

export function renderHandoverInvite(
	locale: Locale,
	vars: HandoverEmailVars,
): Rendered {
	const c = copy[locale](vars.storeName);
	// Order: who it's for → the address that unlocks it → what they get →
	// what it costs → "new here?" right above the button it refers to. The
	// "weren't expecting this" reassurance goes UNDER the button, as fine
	// print, so it never stands between the reader and the action.
	const lines = [
		c.intro(`<strong>${escapeHtml(vars.storeName)}</strong>`),
		keyCard(c.keyLabel, escapeHtml(vars.email), c.keyNote),
		c.takeover,
		c.free,
		c.firstTimer.html,
	];
	const text = [
		c.intro(vars.storeName),
		`${c.keyLabel}${c.colon}${vars.email}\n${c.keyNote}`,
		c.takeover,
		c.free,
		c.firstTimer.text,
		`${c.cta}${c.colon}${vars.appUrl}`,
		c.ignore,
	].join("\n\n");
	return {
		subject: c.subject,
		html: wrapHtml("🎁", c.headline, lines, vars.appUrl, c.cta, escapeHtml(c.ignore)),
		text,
	};
}
