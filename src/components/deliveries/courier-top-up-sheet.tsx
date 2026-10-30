/**
 * The courier top-up hand-off (Arif's artboard 7, z8r3fdx34j). No courier we
 * book through exposes a top-up API, and Kedaipal never holds a seller's
 * delivery money, so "Top up" can only ever be a guided trip to the
 * courier's own account. This sheet makes that trip obvious: what the wallet
 * holds now, the three steps at the courier, the link out — and, for the one
 * courier we can ASK (EasyParcel), a way to confirm the new balance landed.
 *
 * Lalamove pushes its balance on every top-up, so it needs no "I've topped
 * up" button (there is nothing to re-ask). Delyva never shares it, so the
 * sheet says the number here stays what Delyva last showed us.
 */

import { useAction } from "convex/react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Country } from "../../../convex/lib/country";
import type { CourierProviderId } from "../../../convex/lib/courierProviders";
import { useActAsRetailerId } from "../../hooks/useActAs";
import {
	type CourierWalletView,
	presentWallet,
	walletLabel,
	walletProviderName,
	walletTopUpLinks,
} from "../../lib/courier-wallets";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";

/** The steps at each courier — what the seller does on THEIR screen. */
export function topUpSteps(provider: CourierProviderId): string[] {
	switch (provider) {
		case "lalamove":
			return [
				"Open Lalamove and sign in to the Business account your API keys belong to — not the personal app, which is a different wallet.",
				"Go to Wallet, tap Top up, pick an amount and pay.",
				"Come back here. Lalamove tells Kedaipal the new balance as soon as it lands.",
			];
		case "easyparcel":
			return [
				"Open EasyParcel and sign in to the account connected to this store.",
				"Tap Top Up under your profile name, pick a package and pay.",
				"Come back here and tap “I've topped up — check again”.",
			];
		case "delyva":
			return [
				"Open Delyva and sign in to the account connected to this store.",
				"Top up your Delyva wallet there.",
				"Your next booking uses the new balance. Delyva doesn't share it with Kedaipal, so Kedaipal only learns it when Delyva turns a booking down.",
			];
	}
}

export function CourierTopUpSheet({
	open,
	onOpenChange,
	view,
	country,
	now,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	view: CourierWalletView;
	country: Country;
	now: number;
}) {
	const name = walletProviderName(view);
	const { appUrl, guideUrl } = walletTopUpLinks(view, country);
	const p = presentWallet(view, now);
	const steps = topUpSteps(view.provider);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						{view.state === "unshared"
							? `Check your ${walletLabel(view)}`
							: `Top up your ${walletLabel(view)}`}
					</DialogTitle>
					<DialogDescription>
						{name} holds this money, not Kedaipal — top-ups happen in your{" "}
						{name} account.
					</DialogDescription>
				</DialogHeader>

				{/* What it holds now — a receipt line, the house shorthand for money. */}
				<div className="flex items-baseline justify-between gap-3 border-y-2 border-dashed py-3 font-mono text-sm">
					<span className="text-muted-foreground">Now</span>
					<span
						aria-hidden
						className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-muted-foreground/40"
					/>
					<span className="text-right font-semibold tabular-nums text-foreground">
						{p.figure}
					</span>
				</div>
				{/* An unshared wallet's sentence is step 3 below — once is enough. */}
				{view.state !== "unshared" ? (
					<p className="-mt-2 text-xs leading-5 text-muted-foreground">
						{p.detail}
					</p>
				) : null}

				<ol className="flex flex-col gap-3">
					{steps.map((step, i) => (
						<li key={step} className="flex gap-3 text-sm leading-6">
							<span
								aria-hidden
								className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-semibold text-foreground"
							>
								{i + 1}
							</span>
							<span className="min-w-0 text-foreground">{step}</span>
						</li>
					))}
				</ol>

				{guideUrl ? (
					<a
						href={guideUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-accent-emphasis hover:underline"
					>
						{name}'s own top-up guide
						<ExternalLink className="size-3.5" aria-hidden />
					</a>
				) : null}

				<DialogFooter>
					{view.provider === "easyparcel" ? (
						<RecheckButton
							currency={view.currency}
							onLanded={() => onOpenChange(false)}
						/>
					) : (
						<Button
							type="button"
							variant="outline"
							className="tap-target"
							onClick={() => onOpenChange(false)}
						>
							Close
						</Button>
					)}
					{appUrl ? (
						<Button asChild className="tap-target">
							<a href={appUrl} target="_blank" rel="noopener noreferrer">
								Open {name}
								<ExternalLink className="size-4" aria-hidden />
							</a>
						</Button>
					) : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** EasyParcel is the wallet we can ASK, so "I've topped up" means something. */
function RecheckButton({
	currency,
	onLanded,
}: {
	currency: string;
	onLanded: () => void;
}) {
	const actAsRetailerId = useActAsRetailerId();
	const refresh = useAction(api.easyparcel.refreshBalance);
	const [busy, setBusy] = useState(false);
	return (
		<Button
			type="button"
			variant="outline"
			className="tap-target"
			disabled={busy}
			onClick={async () => {
				setBusy(true);
				try {
					const result = await refresh({ retailerId: actAsRetailerId });
					if (!result.ok) {
						toast.error(result.message);
						return;
					}
					toast.success(
						`EasyParcel wallet: ${formatPrice(result.balanceMinor, result.currency || currency)}`,
					);
					onLanded();
				} catch (err) {
					toast.error(convexErrorMessage(err));
				} finally {
					setBusy(false);
				}
			}}
		>
			<RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
			{busy ? "Checking…" : "I've topped up — check again"}
		</Button>
	);
}
