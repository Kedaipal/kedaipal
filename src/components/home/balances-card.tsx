/**
 * Home → Balances (Arif's artboard 1, z8r3fdx34j): the one card that answers
 * "can I take and ship today's orders?" — Kedaipal credits (orders) on top,
 * the courier wallets (money at each courier) under them, each under its own
 * label so the two are never read as one balance.
 *
 * WHERE it sits is the urgency, before a word is read (decision 6 of the
 * credits home work): out of credits → top of the page; credits running low
 * OR any booking courier's wallet needing a top-up → under the today strip;
 * everything healthy → down in "Your store". A healthy wallet is still
 * listed — it is part of the answer — it just doesn't move the card.
 *
 * Either half can be absent: a teammate without the credits grant, or an
 * unmetered store, has no credits section; a store with no courier connected
 * has no wallets section. With neither, the card isn't drawn.
 */

import type { FunctionReturnType } from "convex/server";
import { Scale } from "lucide-react";
import type { api } from "../../../convex/_generated/api";
import { DEFAULT_COUNTRY } from "../../../convex/lib/country";
import { walletNeedsTopUp } from "../../../convex/lib/courierWallet";
import type { CourierWalletView } from "../../lib/courier-wallets";
import {
	type CreditPlacement,
	type CreditTone,
	creditPlacement,
} from "../../lib/credits-ui";
import { CreditMeter } from "../credits/credit-meter";
import {
	COURIER_WALLETS_HELPER,
	CourierWalletList,
} from "../deliveries/courier-wallets-section";

type Retailer = NonNullable<
	FunctionReturnType<typeof api.retailers.getMyRetailer>
>;

/** Where Home draws the card: the more urgent half decides. */
export function balancesPlacement(
	creditTone: CreditTone | null,
	wallets: readonly CourierWalletView[],
): CreditPlacement {
	const credit = creditTone ? creditPlacement(creditTone) : "store";
	if (credit === "top") return "top";
	const walletUrgent = wallets.some(
		(w) => w.armed && w.isTest !== true && walletNeedsTopUp(w.state),
	);
	return walletUrgent ? "under-strip" : credit;
}

export function BalancesCard({
	retailer,
	wallets,
	showCredits,
}: {
	retailer: Retailer;
	wallets: readonly CourierWalletView[];
	/** The credits half has a balance to show (not unmetered, reader has the
	 * grant) — decided by the caller from the same cached read. */
	showCredits: boolean;
}) {
	if (!showCredits && wallets.length === 0) return null;
	return (
		<article
			className="flex flex-col gap-4 rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_41/0.04)] lg:p-5"
			aria-labelledby="home-balances-title"
		>
			<div className="flex items-center gap-2">
				<span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-emphasis">
					<Scale className="size-3.5" aria-hidden="true" />
				</span>
				<h2
					id="home-balances-title"
					className="font-heading text-[17px] font-extrabold tracking-tight"
				>
					Balances
				</h2>
			</div>
			{showCredits ? (
				<CreditMeter variant="section" retailer={retailer} />
			) : null}
			{showCredits && wallets.length > 0 ? (
				<hr className="border-t-2 border-dashed border-border" />
			) : null}
			{wallets.length > 0 ? (
				<section className="flex flex-col gap-3" aria-label="Courier wallets">
					<div className="flex flex-col gap-0.5">
						<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Courier wallets
						</p>
						<p className="text-xs leading-relaxed text-muted-foreground">
							{COURIER_WALLETS_HELPER}
						</p>
					</div>
					<CourierWalletList
						wallets={[...wallets]}
						retailerId={retailer._id}
						country={retailer.country ?? DEFAULT_COUNTRY}
						editable={false}
					/>
				</section>
			) : null}
		</article>
	);
}
