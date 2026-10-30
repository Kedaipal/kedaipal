/**
 * The wallet line above Book, on every dispatch card (Arif's artboards 3 and
 * 4, z8r3fdx34j) — where the seller is about to SPEND, the most urgent place
 * a wallet can speak. One component for all three couriers; the verdict is
 * `walletVerdict` (convex/lib/courierWallet.ts):
 *  - covers / unknown — a quiet line: what the wallet holds and how fresh;
 *  - warn  — amber, how short, "<Courier> has the final say"; Book stays
 *            enabled, because a pushed or last-seen number may be stale;
 *  - block — red, on a balance pulled moments ago (EasyParcel); the card
 *            disables Book and points at this line as the reason.
 * Top up opens the same hand-off sheet as everywhere else.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Country } from "../../../convex/lib/country";
import type { CourierProviderId } from "../../../convex/lib/courierProviders";
import { useMinuteClock } from "../../hooks/useMinuteClock";
import {
	type CourierWalletView,
	dispatchWalletLine,
	LALAMOVE_BUSINESS_NOTE,
	walletProviderName,
} from "../../lib/courier-wallets";
import { TONE_ACCENT, TONE_PANEL } from "../../lib/tone";
import { cn } from "../../lib/utils";
import { CourierTopUpSheet } from "./courier-top-up-sheet";

export function DispatchWalletLine({
	provider,
	priceMinor,
	retailerId,
	country,
	id,
	fallback,
}: {
	provider: CourierProviderId;
	/** What this booking costs; null while there is no price yet. */
	priceMinor: number | null;
	retailerId: Id<"retailers">;
	country: Country;
	/** For `aria-describedby` on a Book button this line disables. */
	id?: string;
	/** The balance a quote just read, for the moment before the stored wallet
	 * catches up — a Book button that names this line as its reason must
	 * never point at nothing. */
	fallback?: CourierWalletView;
}) {
	const wallets = useQuery(
		convexQuery(api.courierWallets.list, { retailerId }),
	).data;
	const now = useMinuteClock();
	const [sheetOpen, setSheetOpen] = useState(false);
	const view = wallets?.find((w) => w.provider === provider) ?? fallback;
	if (!view) return null;
	const line = dispatchWalletLine(view, priceMinor ?? 0, now);
	const loud =
		priceMinor !== null &&
		line.verdict !== "covers" &&
		line.verdict !== "unknown";
	const canTopUp = view.isTest !== true;

	return (
		<div
			id={id}
			data-testid={`dispatch-wallet-${provider}`}
			data-verdict={priceMinor === null ? "unpriced" : line.verdict}
			className={cn(
				"flex flex-col gap-1 text-xs",
				loud && `rounded-lg border px-3 py-2 ${TONE_PANEL[line.tone]}`,
			)}
		>
			<p
				className={cn(
					"flex items-start gap-1.5",
					loud ? "font-medium" : "text-muted-foreground",
				)}
			>
				<Wallet
					aria-hidden
					className={cn(
						"mt-px size-3.5 shrink-0",
						loud && TONE_ACCENT[line.tone],
					)}
				/>
				<span className="min-w-0">
					{line.text}
					{canTopUp && (loud || view.state !== "ok") ? (
						<>
							{" "}
							<button
								type="button"
								className="-my-2 inline py-2 font-semibold text-accent-emphasis underline-offset-2 hover:underline"
								onClick={() => setSheetOpen(true)}
							>
								{view.state === "unshared"
									? `Check in ${walletProviderName(view)}`
									: "Top up"}
							</button>
						</>
					) : null}
				</span>
			</p>
			{loud && provider === "lalamove" ? (
				<p className="pl-5 opacity-80">{LALAMOVE_BUSINESS_NOTE}</p>
			) : null}
			<CourierTopUpSheet
				open={sheetOpen}
				onOpenChange={setSheetOpen}
				view={view}
				country={country}
				now={now}
			/>
		</div>
	);
}
