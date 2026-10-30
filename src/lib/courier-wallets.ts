/**
 * Courier wallets — what each state SAYS (z8r3fdrgxc + z8r3fdx34j). The read
 * model and the block-or-warn rule are the server's
 * (`convex/lib/courierWallet.ts`); this module turns one wallet view into the
 * words and tone every surface renders, so Home, the Deliveries page,
 * Settings → Integrations and the dispatch cards can never describe the same
 * wallet two ways.
 *
 * Copy rules: the money is the COURIER's — "<Provider> wallet", never
 * "credits" (Kedaipal Credits own that word); nothing implies Kedaipal holds
 * or can top up this balance; "not reported yet" is never RM 0.
 */

import type { Country } from "../../convex/lib/country";
import {
	type CourierWalletView,
	STALE_WALLET_MS,
	WALLET_PROVIDERS,
	type WalletVerdict,
	walletNeedsTopUp,
	walletVerdict,
} from "../../convex/lib/courierWallet";
import { formatPrice, formatRelativeTime, formatShortDate } from "./format";
import type { Tone } from "./tone";

export type { CourierWalletView } from "../../convex/lib/courierWallet";

export function walletProviderName(view: Pick<CourierWalletView, "provider">) {
	return WALLET_PROVIDERS[view.provider].name;
}

/** A whole amount without its ".00" — "RM 30", "S$ 15" — for thresholds,
 * which are round numbers; balances keep their cents. */
export function walletAmount(minor: number, currency: string): string {
	return formatPrice(minor, currency).replace(/\.00$/, "");
}

/** "Lalamove wallet". */
export function walletLabel(view: Pick<CourierWalletView, "provider">) {
	return `${walletProviderName(view)} wallet`;
}

export function walletIsStale(
	view: Pick<CourierWalletView, "at" | "balanceMinor">,
	now: number,
): boolean {
	return (
		view.balanceMinor !== null &&
		view.at !== null &&
		now - view.at > STALE_WALLET_MS
	);
}

/** What one wallet row shows. */
export type WalletPresentation = {
	/** The right-hand figure: an amount, or a word when there is none. */
	figure: string;
	/** The figure is a real amount (renders mono). */
	figureIsAmount: boolean;
	tone: Tone;
	/** One line under the label. */
	detail: string;
	/** A play-money account: TEST pill, never a top-up prompt. */
	isTest: boolean;
	/** Low / empty / short on a real wallet — the row leads with Top up. */
	needsTopUp: boolean;
	/** Older than a day — greyed, because spends outside Kedaipal move it. */
	stale: boolean;
};

/**
 * One wallet, as words. `now` is passed in (never read here) so a test can
 * pin it and a render can tick it.
 */
export function presentWallet(
	view: CourierWalletView,
	now: number,
	opts: {
		/** The row shows "Alert at RM 30" as its own control, so the low
		 * sentence needn't repeat the line. */
		alertShown?: boolean;
	} = {},
): WalletPresentation {
	const name = walletProviderName(view);
	const isTest = view.isTest === true;
	const stale = walletIsStale(view, now);
	const amount =
		view.balanceMinor !== null
			? formatPrice(view.balanceMinor, view.currency)
			: null;
	const updated =
		view.at !== null ? `updated ${formatRelativeTime(view.at, now)}` : null;
	const needsTopUp = !isTest && walletNeedsTopUp(view.state);

	if (isTest) {
		return {
			figure: amount ?? "—",
			figureIsAmount: amount !== null,
			tone: "neutral",
			detail: "Test account — play money. Nothing here needs a top-up.",
			isTest,
			needsTopUp: false,
			stale: false,
		};
	}

	switch (view.state) {
		case "unreported":
			return {
				figure: "Not reported yet",
				figureIsAmount: false,
				tone: "neutral",
				detail:
					WALLET_PROVIDERS[view.provider].model === "pull"
						? `${name} hasn't been asked yet — refresh to check.`
						: `${name} reports it after your next top-up or booking.`,
				isTest,
				needsTopUp,
				stale,
			};
		case "unshared":
			return {
				figure: "Not shared",
				figureIsAmount: false,
				tone: "neutral",
				detail: `${name} doesn't share your balance with Kedaipal — check it in ${name}.`,
				isTest,
				needsTopUp,
				stale,
			};
		case "short":
			return {
				figure: "Too low",
				figureIsAmount: false,
				tone: "danger",
				detail:
					view.refusedAt !== null
						? `${name} refused a booking ${formatRelativeTime(view.refusedAt, now)} — not enough in the wallet.`
						: `${name} refused a booking — not enough in the wallet.`,
				isTest,
				needsTopUp,
				stale: false,
			};
		default: {
			const lastSeen =
				view.source === "refusal" && view.at !== null
					? `last seen ${formatShortDate(view.at)}, when ${name} refused a booking`
					: null;
			const when = lastSeen ?? updated;
			const head =
				view.state === "empty"
					? "Empty — the next booking will fail"
					: view.state === "low"
						? opts.alertShown
							? "Low"
							: `Low — under your ${walletAmount(view.lowAlertMinor, view.currency)} alert`
						: stale
							? "May be out of date"
							: null;
			const detail = [head, when].filter(Boolean).join(" · ");
			return {
				figure: amount ?? "—",
				figureIsAmount: amount !== null,
				tone:
					view.state === "empty"
						? "danger"
						: view.state === "low"
							? "warn"
							: "neutral",
				detail: capitalise(detail),
				isTest,
				needsTopUp,
				stale,
			};
		}
	}
}

/** The Lalamove-only trap (86eypncfy): a top-up in the personal app credits a
 * different wallet. Said wherever a Lalamove wallet asks for money. */
export const LALAMOVE_BUSINESS_NOTE =
	"Top up the Lalamove Business account your keys belong to — the personal Lalamove app is a different wallet.";

/** What a dispatch card says about paying for THIS booking. */
export type DispatchWalletLine = {
	verdict: WalletVerdict;
	tone: Tone;
	text: string;
};

/**
 * The wallet line above Book. `covers` and `unknown` stay quiet; `warn` says
 * how short and that the courier has the final say (Book stays enabled);
 * `block` is a pulled balance read moments ago that can't pay — Book
 * disables with this sentence as its reason. A test wallet gets the same
 * verdict in sandbox words.
 */
export function dispatchWalletLine(
	view: CourierWalletView,
	priceMinor: number,
	now: number,
): DispatchWalletLine {
	const verdict = walletVerdict(view, priceMinor, now);
	const name = walletProviderName(view);
	const balance =
		view.balanceMinor !== null
			? formatPrice(view.balanceMinor, view.currency)
			: null;
	const p = presentWallet(view, now);
	if (verdict === "block" && view.balanceMinor !== null) {
		// A sandbox refuses too, so it blocks too — but its money is play
		// money, added in the sandbox, never "topped up".
		return {
			verdict,
			tone: "danger",
			text: `Your ${name} ${p.isTest ? "test wallet" : "wallet"} has ${balance}; this booking costs ${formatPrice(priceMinor, view.currency)}. ${p.isTest ? `Add test credit in your ${name} sandbox first.` : "Top up first."}`,
		};
	}
	if (verdict === "warn") {
		const short =
			view.balanceMinor !== null
				? `${formatPrice(priceMinor - view.balanceMinor, view.currency)} short of this booking`
				: "may not cover this booking";
		return {
			verdict,
			tone: "warn",
			text: `${walletLabel(view)}${balance ? ` ${balance}` : ""} — ${short}. ${name} has the final say.`,
		};
	}
	return {
		verdict,
		tone: "neutral",
		text: `${walletLabel(view)}: ${p.figure}${
			p.isTest
				? " · test account"
				: view.at !== null && view.balanceMinor !== null
					? ` · ${view.source === "refusal" ? `last seen ${formatShortDate(view.at)}` : `updated ${formatRelativeTime(view.at, now)}`}`
					: ""
		}`,
	};
}

/** Where the seller tops up this provider's wallet, for the store's country. */
export function walletTopUpLinks(
	view: Pick<CourierWalletView, "provider">,
	country: Country,
): { appUrl: string | null; guideUrl: string | null } {
	const p = WALLET_PROVIDERS[view.provider];
	return { appUrl: p.appUrl[country], guideUrl: p.guideUrl[country] };
}

function capitalise(s: string): string {
	return s ? s[0].toUpperCase() + s.slice(1) : s;
}
