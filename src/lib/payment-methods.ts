/**
 * The payment rails a Malaysian buyer can use on a Kedaipal storefront, as one
 * config array (ClickUp 86eye3p6z §G). Adding or pulling a method is a data
 * edit here, never a design pass in the component.
 *
 * SCOPE — this is the LANDING catalogue: HitPay's full Malaysian capability,
 * advertised as a fact about the gateway. It is deliberately NOT shared with
 * the storefront checkout or Settings → Payments, which must render only the
 * rails that individual seller has switched on in their own HitPay account
 * (BYO accounts, so it varies per store — see `online-payments-card.tsx`'s
 * `METHOD_ICONS`). One list promising more than a seller enabled would be a
 * lie on the surface where a buyer is about to pay.
 *
 * Marks are third-party trademarks used to state a fact ("your customers can
 * pay with X"), never to imply endorsement or partnership.
 *
 * SOURCE — every mark under `public/img/payment/` comes from Shopify's
 * MIT-licensed `payment_icons` set (via HitPay's fork, `hit-pay/payment_icons`,
 * which is also where the Settings chips came from). Take marks from there, not
 * from a search result: the set is drawn on one artboard, and a stray logo off
 * the web is how a row turns into the ransom note the brand rules warn about.
 *
 * A mark from that set is only usable if it is a REAL vector. Several entries
 * upstream (MayBank QRPay, PromptPay, and the old ShopeePay and PayNow files we
 * held) are base64 PNGs wrapped in an `<svg>` shell — rasters in disguise, which
 * the landing's no-raster rule rejects. `payment-methods.test.ts` now parses
 * every referenced file and fails on one, so this is enforced rather than
 * remembered. A rail with no usable vector renders as a neutral wordmark chip.
 */

export type PaymentGroupId =
	| "bank"
	| "cards"
	| "wallets"
	| "bnpl"
	| "crossborder";

/**
 * Every mark we hold is drawn on the same 38×24 card artboard (the payment-icon
 * convention), so ONE height is what actually normalises them — per-mark heights
 * scale identical artboards to different sizes and produce the ransom-note row
 * the brand rules warn about. A future mark on a different artboard sets its own
 * `markClass` instead of using these.
 */
const CARD_MARK = "h-7 w-auto";
const CARD_MARK_COMPACT = "h-[18px] w-auto";

export interface PaymentMethod {
	/** Stable handle — also the React key and the test anchor. */
	id: string;
	/**
	 * Brand name. A proper noun, so it is NOT a translated message: it doubles
	 * as the accessible name in every locale, which is what a BM or ZH screen
	 * reader user actually needs to hear.
	 */
	name: string;
	group: PaymentGroupId;
	/**
	 * Official SVG mark under `public/img/payment/`. Absent when we don't hold a
	 * brand-approved SVG yet — those render as a neutral wordmark chip instead
	 * of a raster stand-in (no raster assets on the landing, per the design
	 * system). Drop the file in and add `src` to promote a chip to a mark.
	 */
	src?: string;
	/** Intrinsic-ratio classes for the full strip — normalises optical weight. */
	markClass?: string;
	/** Same mark, footer scale (~0.62×). */
	compactMarkClass?: string;
	/** Short qualifier rendered beside the mark (e.g. FPX's bank count). */
	noteKey?: "pay_fpx_banks";
	/** Also shown in the compact footer strip. */
	compact?: boolean;
	/**
	 * False keeps the row documented but off the page. Cross-border wallets are
	 * parked here on purpose: twenty logos is noise, not trust, until a seller
	 * actually serves tourists (86eye3p6z).
	 */
	visible: boolean;
}

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
	{
		id: "duitnow",
		name: "DuitNow QR",
		group: "bank",
		src: "/img/payment/duitnow.svg",
		markClass: CARD_MARK,
		compactMarkClass: CARD_MARK_COMPACT,
		compact: true,
		visible: true,
	},
	{
		id: "fpx",
		name: "FPX",
		group: "bank",
		src: "/img/payment/fpx.svg",
		markClass: CARD_MARK,
		compactMarkClass: CARD_MARK_COMPACT,
		noteKey: "pay_fpx_banks",
		compact: true,
		visible: true,
	},
	{
		id: "visa",
		name: "Visa",
		group: "cards",
		src: "/img/payment/visa.svg",
		markClass: CARD_MARK,
		compactMarkClass: CARD_MARK_COMPACT,
		compact: true,
		visible: true,
	},
	{
		id: "mastercard",
		name: "Mastercard",
		group: "cards",
		src: "/img/payment/master.svg",
		markClass: CARD_MARK,
		compactMarkClass: CARD_MARK_COMPACT,
		compact: true,
		visible: true,
	},
	// Apple Pay / Google Pay were wordmark chips while we held no vector we could
	// redistribute. Both now ship the official mark from Shopify's MIT-licensed
	// `payment_icons` set (see SOURCE above) — used as-is, never recoloured or
	// redrawn, which is what both brand guidelines actually require.
	//
	// Apple's mark is drawn on a 165.521×105.965 artboard rather than 38×24, so
	// it is the exception the CARD_MARK note anticipates — but its RATIO (1.562)
	// matches the card artboard's (1.583) to within a pixel at `h-7`, and ratio
	// is what `w-auto` sizing actually keys on. CARD_MARK is correct here; don't
	// "fix" it to a bespoke height.
	{
		id: "apple-pay",
		name: "Apple Pay",
		group: "cards",
		src: "/img/payment/applepay.svg",
		markClass: CARD_MARK,
		visible: true,
	},
	{
		id: "google-pay",
		name: "Google Pay",
		group: "cards",
		src: "/img/payment/googlepay.svg",
		markClass: CARD_MARK,
		visible: true,
	},
	{
		id: "touchngo",
		name: "Touch 'n Go eWallet",
		group: "wallets",
		src: "/img/payment/touchngo.svg",
		markClass: CARD_MARK,
		compactMarkClass: CARD_MARK_COMPACT,
		compact: true,
		visible: true,
	},
	{
		id: "grabpay",
		name: "GrabPay",
		group: "wallets",
		src: "/img/payment/grabpay.svg",
		markClass: CARD_MARK,
		compactMarkClass: CARD_MARK_COMPACT,
		compact: true,
		visible: true,
	},
	// Was a wordmark because the file we held was an SVG shell wrapping a base64
	// PNG. Replaced with the genuine vector from the same MIT set, so it can be a
	// real mark now. (The Settings card reads the same file and improves for free.)
	{
		id: "shopeepay",
		name: "ShopeePay",
		group: "wallets",
		src: "/img/payment/shopeepay.svg",
		markClass: CARD_MARK,
		compactMarkClass: CARD_MARK_COMPACT,
		compact: true,
		visible: true,
	},
	{
		id: "boost",
		name: "Boost",
		group: "wallets",
		src: "/img/payment/boost.svg",
		markClass: CARD_MARK,
		compactMarkClass: CARD_MARK_COMPACT,
		compact: true,
		visible: true,
	},
	// Still a chip: the only MayBank QRPay vector published upstream is another
	// base64 PNG in an SVG shell (verified 2026-08-14), so it fails the same rule
	// ShopeePay used to fail.
	{
		id: "maybank-qrpay",
		name: "MayBank QRPay",
		group: "wallets",
		visible: true,
	},
	{
		id: "atome",
		name: "Atome",
		group: "bnpl",
		src: "/img/payment/atome.svg",
		markClass: CARD_MARK,
		visible: true,
	},
	// SPayLater and GrabPay PayLater have no mark in the set at all — they are
	// lender brands rather than rails, and neither publishes a redistributable
	// vector. Chips until one does.
	{ id: "spaylater", name: "SPayLater", group: "bnpl", visible: true },
	{
		id: "grabpay-paylater",
		name: "GrabPay PayLater",
		group: "bnpl",
		visible: true,
	},
	// Cross-border (tourist) rails — HitPay supports them, we don't advertise
	// them yet. Flip `visible` when a seller needs them; the group renders
	// itself the moment one becomes visible.
	// Alipay+ deliberately keeps its chip: the set ships `alipay.svg`, but Alipay+
	// is the cross-border ACQUIRING network, not the Alipay wallet. Rendering the
	// wallet's mark here would name the wrong company — worse than a chip.
	{ id: "alipay-plus", name: "Alipay+", group: "crossborder", visible: false },
	{
		id: "wechat-pay",
		name: "WeChat Pay",
		group: "crossborder",
		src: "/img/payment/wechatpay.svg",
		markClass: CARD_MARK,
		visible: false,
	},
	// PayNow LOST its `src`: public/img/payment/paynow.svg is a base64 PNG in an
	// SVG shell — the ShopeePay defect, sitting behind `visible: false` where
	// nothing rendered it. Flipping that one word would have shipped a raster to
	// the landing, so the row is demoted to a chip until a real vector lands. The
	// file stays on disk because the Settings card still points at it.
	{ id: "paynow", name: "PayNow (SG)", group: "crossborder", visible: false },
	{
		id: "qris",
		name: "QRIS (ID)",
		group: "crossborder",
		src: "/img/payment/qris.svg",
		markClass: CARD_MARK,
		visible: false,
	},
	// PromptPay's upstream vector is a base64 PNG in a shell, same as MayBank's.
	{
		id: "promptpay",
		name: "PromptPay (TH)",
		group: "crossborder",
		visible: false,
	},
];

/** Display order of the groups on the landing strip. */
export const PAYMENT_GROUP_ORDER: readonly PaymentGroupId[] = [
	"bank",
	"cards",
	"wallets",
	"bnpl",
	"crossborder",
];

/** Visible methods of one group, in config order. Empty groups aren't rendered. */
export function methodsInGroup(group: PaymentGroupId): PaymentMethod[] {
	return PAYMENT_METHODS.filter((mth) => mth.visible && mth.group === group);
}

/** The short row repeated in the footer — a subset, so it stays one line-ish. */
export function compactMethods(): PaymentMethod[] {
	return PAYMENT_METHODS.filter((mth) => mth.visible && mth.compact);
}
