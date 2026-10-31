/**
 * The courier top-up hand-off (Arif's artboard 7, z8r3fdx34j). No courier we
 * book through exposes a top-up API, and Kedaipal never holds a seller's
 * delivery money, so "Top up" can only ever be a guided trip to the
 * courier's own account. This sheet makes that trip obvious: what the wallet
 * holds now, the three steps at the courier, the link out — and, for the
 * couriers we can ASK (EasyParcel, Delyva), a way to confirm the new balance
 * landed.
 *
 * Lalamove pushes its balance on every top-up, so it needs no "I've topped
 * up" button (there is nothing to re-ask). EasyParcel and Delyva can be asked,
 * so the sheet re-reads them — for a reader with the integrations grant, which
 * is what `refreshBalance` checks; anyone else sees the button greyed with the
 * reason, never a "Not authorized" toast (PR #441 review).
 *
 * Arif's 24 Oct additions: a suggested amount from the store's own bookings
 * ("RM 130 · ~4 trips"), EasyParcel's own auto top-up as the way to never run
 * dry, and the trip out remembered — "Open <Courier>" marks the wallet as
 * waiting (src/lib/top-up-awaiting.ts) and, for EasyParcel, coming back to
 * this tab re-reads the balance by itself.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Country } from "../../../convex/lib/country";
import type { CourierProviderId } from "../../../convex/lib/courierProviders";
import { WALLET_PROVIDERS } from "../../../convex/lib/courierWallet";
import { useActAsRetailerId } from "../../hooks/useActAs";
import { usePermission } from "../../hooks/usePermission";
import { useWalletRefresh } from "../../hooks/useWalletRefresh";
import {
	type CourierWalletView,
	presentWallet,
	walletAmount,
	walletLabel,
	walletProviderName,
	walletTopUpLinks,
} from "../../lib/courier-wallets";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { TONE_ACCENT } from "../../lib/tone";
import {
	awaitingTopUp,
	markTopUpStarted,
	topUpLanded,
	topUpWaitingLine,
	useTopUpTrip,
} from "../../lib/top-up-awaiting";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";

/** Why a reader without the integrations grant can't re-read a wallet. */
export const RECHECK_NEEDS_INTEGRATIONS =
	"Ask the store owner for integrations access to re-read the balance.";

/** The last step of a pull wallet: the re-read, or what happens instead
 * for a reader who can't ask. */
function pullLastStep(canRecheck: boolean): string {
	return canRecheck
		? "Come back here and tap “I've topped up — check again”."
		: "Come back here. The new balance shows the next time the wallet is read — a booking quote, or a Refresh by someone with integrations access.";
}

/** The steps at each courier — what the seller does on THEIR screen.
 * `canRecheck` = this reader may ask the courier for its balance. */
export function topUpSteps(
	provider: CourierProviderId,
	opts: { canRecheck?: boolean } = {},
): string[] {
	const canRecheck = opts.canRecheck ?? true;
	switch (provider) {
		case "lalamove":
			return [
				"Open Lalamove's Partner Portal and sign in to the account your API keys come from — not the Lalamove app, which has a different wallet.",
				"Check the switch at the top right says Production, then go to Wallet and tap Top Up.",
				"Come back here. Lalamove tells Kedaipal the new balance as soon as it lands.",
			];
		case "easyparcel":
			return [
				"Open EasyParcel and sign in to the account connected to this store.",
				"Tap Top Up under your profile name, pick a package and pay.",
				pullLastStep(canRecheck),
			];
		case "delyva":
			return [
				"Open Delyva and sign in to the account connected to this store.",
				"Under Finance, open Top-up, choose a plan and pay.",
				pullLastStep(canRecheck),
			];
	}
}

export function CourierTopUpSheet({
	open,
	onOpenChange,
	view,
	country,
	now,
	retailerId,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	view: CourierWalletView;
	country: Country;
	now: number;
	retailerId: Id<"retailers">;
}) {
	const name = walletProviderName(view);
	const { appUrl, guideUrl, autoTopUpUrl } = walletTopUpLinks(view, country);
	const p = presentWallet(view, now);
	// Re-reading a balance is `refreshBalance`, an integrations READ — the same
	// grant the wallet row's Refresh hides behind. One rule for one action.
	const canRecheck = usePermission("integrations").canRead;
	const steps = topUpSteps(view.provider, { canRecheck });
	const trip = useTopUpTrip(view.provider);
	const waiting = awaitingTopUp(trip, view, now);
	// The wallets we can ASK — EasyParcel and Delyva — get the re-check.
	const pullable = WALLET_PROVIDERS[view.provider].model === "pull";
	const landed = topUpLanded(trip, view, now);
	const suggestion = useQuery(
		convexQuery(
			api.courierWallets.topUpSuggestion,
			open && view.isTest !== true && view.state !== "unshared"
				? { retailerId, provider: view.provider }
				: "skip",
		),
	).data;

	return (
		<>
			{waiting && pullable && canRecheck && view.isTest !== true ? (
				<RecheckOnReturn
					view={view}
					balanceBefore={trip?.balanceBefore ?? null}
				/>
			) : null}
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Top up your {walletLabel(view)}</DialogTitle>
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
					{waiting ? (
						<p
							className={`-mt-2 flex items-center gap-1.5 text-xs leading-5 font-medium ${TONE_ACCENT.info}`}
						>
							<Clock aria-hidden className="size-3.5 shrink-0" />
							{topUpWaitingLine(view)}
						</p>
					) : null}

					{landed ? (
						<p
							className={`-mt-2 flex items-center gap-1.5 text-xs leading-5 font-medium ${TONE_ACCENT.success}`}
							data-testid="top-up-landed"
						>
							<CheckCircle2 aria-hidden className="size-3.5 shrink-0" />
							{name} reported your top-up — the wallet holds {p.figure} now.
						</p>
					) : null}

					{suggestion ? (
						<div
							className="flex flex-col gap-2"
							data-testid="top-up-suggestion"
						>
							<p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
								Suggested top-up
							</p>
							<ul className="flex flex-wrap gap-2">
								{suggestion.options.map((o) => (
									<li
										key={o.label}
										className="flex items-baseline gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2"
									>
										<span className="font-mono text-sm font-semibold tabular-nums text-foreground">
											{walletAmount(o.minor, suggestion.currency)}
										</span>
										<span className="text-xs text-muted-foreground">
											{o.label}
										</span>
									</li>
								))}
							</ul>
							<p className="text-xs leading-5 text-muted-foreground">
								From your last {suggestion.bookings} {name} bookings — a guide,
								not a charge. You choose the amount in {name}.
							</p>
						</div>
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

					{autoTopUpUrl ? (
						<a
							href={autoTopUpUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="-mt-2 flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-accent/40 bg-accent/5 px-3 py-2 text-sm text-foreground hover:bg-accent/10"
						>
							<RefreshCw
								className="size-4 shrink-0 text-accent-emphasis"
								aria-hidden
							/>
							<span className="min-w-0 flex-1">
								<span className="font-medium">Never run dry</span> — switch on
								auto top-up in {name}, and it tops up by card when you run low.
							</span>
							<ExternalLink
								className="size-3.5 shrink-0 text-muted-foreground"
								aria-hidden
							/>
						</a>
					) : null}

					{pullable && !canRecheck ? (
						<p
							id={`recheck-reason-${view.provider}`}
							className="text-xs leading-5 text-muted-foreground"
							data-testid="recheck-reason"
						>
							{RECHECK_NEEDS_INTEGRATIONS}
						</p>
					) : null}
					<DialogFooter>
						{pullable && !canRecheck ? (
							<Button
								type="button"
								variant="outline"
								className="tap-target"
								disabled
								aria-describedby={`recheck-reason-${view.provider}`}
							>
								<RefreshCw className="size-4" />
								I've topped up — check again
							</Button>
						) : pullable ? (
							<RecheckButton view={view} onLanded={() => onOpenChange(false)} />
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
								<a
									href={appUrl}
									target="_blank"
									rel="noopener noreferrer"
									onClick={() =>
										markTopUpStarted(view.provider, view.balanceMinor)
									}
								>
									Open {name}
									<ExternalLink className="size-4" aria-hidden />
								</a>
							</Button>
						) : null}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

/** A wallet we can ASK (EasyParcel, Delyva), so "I've topped up" means
 * something. */
function RecheckButton({
	view,
	onLanded,
}: {
	view: CourierWalletView;
	onLanded: () => void;
}) {
	const actAsRetailerId = useActAsRetailerId();
	const refresh = useWalletRefresh(view.provider);
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
						`${walletLabel(view)}: ${formatPrice(result.balanceMinor, result.currency || view.currency)}`,
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

/** A pull wallet re-reads at most once a minute across every open surface. */
const RECHECK_GAP_MS = 60_000;
const lastRecheck = new Map<string, number>();

/**
 * Coming back to this tab after leaving for the courier's site re-reads the
 * balance by itself — for the wallets we can ask, EasyParcel and Delyva
 * (Arif, 24 Oct). Mounted only while a top-up is pending, so an idle sheet
 * does nothing; Lalamove pushes, so it just waits. The
 * newer observation ends "waiting" on its own (`awaitingTopUp`), whether or
 * not the money has landed yet; the toast says which.
 */
function RecheckOnReturn({
	view,
	balanceBefore,
}: {
	view: CourierWalletView;
	/** The balance the seller left at — what "topped up" is measured from. */
	balanceBefore: number | null;
}) {
	const actAsRetailerId = useActAsRetailerId();
	const refresh = useWalletRefresh(view.provider);
	const before = balanceBefore;
	useEffect(() => {
		const onVisible = async () => {
			if (document.visibilityState !== "visible") return;
			const last = lastRecheck.get(view.provider) ?? 0;
			if (Date.now() - last < RECHECK_GAP_MS) return;
			lastRecheck.set(view.provider, Date.now());
			try {
				const result = await refresh({ retailerId: actAsRetailerId });
				if (!result.ok) return;
				const amount = formatPrice(
					result.balanceMinor,
					result.currency || view.currency,
				);
				if (before !== null && result.balanceMinor > before)
					toast.success(`${walletLabel(view)} topped up: ${amount}`);
				else
					toast(`${walletLabel(view)}: ${amount} — no top-up yet`, {
						description: "Tap “I've topped up — check again” once it's paid.",
					});
			} catch {
				// A failed re-read leaves the row as it was; Refresh is right there.
			}
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, [refresh, actAsRetailerId, view, before]);
	return null;
}
