import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PauseCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { useCreditLock } from "../../hooks/useCreditLock";
import { useDashboardRetailer } from "../../hooks/useDashboardRetailer";
import { useStoreRole } from "../../hooks/usePermission";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
import {
	lockCta,
	ordersBalanceLabel,
	ordersWaitingLabel,
} from "../../lib/credits-ui";
import { formatPrice } from "../../lib/format";
import {
	resolveBannerState,
	type SubscriptionView,
} from "../../lib/subscription";

/**
 * Dashboard subscription banner (app shell). Escalates by urgency:
 *  - `past_due` → red, non-dismissable: the dashboard is VIEW-ONLY (z8r3fdeub2,
 *    19 Sep 2026 — every seller action is refused server-side, not just store
 *    edits), so this bar is where that constraint is surfaced before the seller
 *    taps anything. When the lock came from an admin turning the store's comp
 *    upgrade off it names that instead of an unpaid bill, and points at
 *    choosing a plan.
 *  - a pending invoice due within 5 days → amber warning, dismissable.
 *  - Off-Season Hold → calm accent strip, persistent: ordering is paused and
 *    the seller must not forget it (z8r3fday24).
 *  - the first invoice is out (start-when-you-sell) → amber, dismissable,
 *    keyed by its due date: "your first order is in / free period ended — pay
 *    from Billing, or switch plan first".
 *  - free period's backstop within 5 days → amber warning, dismissable (red +
 *    persistent only if the period ended and no invoice is on file).
 *  - out of credits (Credits T3) → red, persistent, ranked right under
 *    past-due: accepting/updating orders and editing products are paused
 *    while orders keep arriving; one button to the way back (top up / pick a
 *    plan / pay the invoice), or "ask the owner" for a teammate.
 *  - credits running low (the last fifth of the month's grant) → amber,
 *    dismissable for the month. Replaces the soft order-cap nudge.
 * Nothing for active/comped with nothing due. Warnings are dismissable for the
 * session only (sessionStorage, keyed by the deadline) so they return next login
 * and a new deadline re-shows. See docs/manual-subscription.md.
 */
export function SubscriptionBanner({
	subscription,
	slug,
}: {
	subscription?: SubscriptionView;
	slug: string;
}) {
	// Who is reading this banner decides what it can ask them to do.
	const isMember = useStoreRole() === "member";
	const retailer = useDashboardRetailer();
	const creditLock = useCreditLock();
	// The balance is `credits`-area data: null for a teammate without the grant,
	// which simply means no "running low" nudge for them.
	const balance = useQuery(
		convexQuery(
			api.credits.getBalance,
			retailer
				? {
						retailerId: retailer.actingAsAdmin ? retailer._id : undefined,
					}
				: "skip",
		),
	).data;
	const skipInvoice =
		!subscription || subscription.comped || subscription.status === "past_due";
	const pending = useQuery(
		convexQuery(api.invoices.myNextDueInvoice, skipInvoice ? "skip" : {}),
	).data;

	const now = Date.now();
	const state = resolveBannerState(
		subscription,
		pending?.dueDate,
		now,
		undefined,
		{
			locked: creditLock.locked,
			route: creditLock.route,
			ordersWaiting: creditLock.ordersWaiting,
			total: balance?.total,
			periodGrant: balance?.periodGrant,
			customGrant: balance?.customGrant,
		},
	);

	// Dismiss key: only the soft (amber) warnings are dismissable, keyed by their
	// deadline (or month, for the cap nudge) so the next deadline re-surfaces.
	const dismissKey =
		state.kind === "invoiceWarn"
			? `subwarn:inv:${pending?.dueDate}`
			: state.kind === "firstInvoice"
				? `subwarn:first:${pending?.dueDate}`
				: state.kind === "trialWarn" && !state.ended
					? `subwarn:trial:${subscription?.trialEndsAt}`
					: state.kind === "creditsLow"
						? `subwarn:credits:${balance?.periodKey ?? ""}`
						: null;
	const [dismissed, dismiss] = useDismissed(dismissKey);
	// Read above the early returns — the past-due CTA that uses it is built inside
	// a branch, where a hook can't go.
	const supportWa = useSupportWaNumber();

	if (state.kind === "none") return null;

	// Off-Season Hold: not a warning — the seller chose this — but ordering is
	// off, which is exactly the kind of state that gets forgotten. Persistent,
	// calm, one tap to the switch.
	if (state.kind === "held") {
		return (
			<div className="flex items-center gap-3 border-b border-accent/30 bg-accent/10 px-5 py-3 lg:px-8">
				<PauseCircle className="size-5 shrink-0 text-accent" aria-hidden />
				<p className="flex-1 text-sm text-foreground/90">
					<span className="font-medium">
						Ordering is paused — you're on Off-Season Hold.
					</span>{" "}
					Buyers still see your store, with a seasonal-break note; your catalog,
					buyer list and orders stay live.
				</p>
				<Link
					to="/app/settings"
					search={{ tab: "billing" }}
					className="inline-flex h-9 w-fit shrink-0 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
				>
					Resume
				</Link>
			</div>
		);
	}

	// Out of credits (Credits T3): the seller can't work orders or edit
	// products until credits are added — orders keep arriving. Persistent.
	if (state.kind === "creditsLocked") {
		const waiting = ordersWaitingLabel(state.ordersWaiting);
		const cta = lockCta(state.route);
		return (
			<div className="flex flex-col gap-2 border-b border-red-200 bg-red-50 px-5 py-3 dark:border-red-900 dark:bg-red-950/40 sm:flex-row sm:items-center sm:justify-between lg:px-8">
				<p className="text-sm text-foreground/90">
					<span className="font-medium">
						{isMember
							? "This store is out of credits"
							: "You're out of credits"}
						{waiting ? ` · ${waiting}` : ""}.
					</span>{" "}
					{/* A teammate who may buy packs can take the way back
					    themselves (T2); one who can't is told who can. */}
					{creditLock.canAct
						? "Accepting and updating orders and editing products are paused. Orders keep coming in, and you can still view, cancel and refund them."
						: "Accepting and updating orders and editing products are paused until the owner adds credits. Orders keep coming in."}
				</p>
				{!creditLock.canAct ? null : (
					<Link
						to="/app/settings"
						search={cta.search}
						className="inline-flex h-9 w-fit shrink-0 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
					>
						{cta.label}
					</Link>
				)}
			</div>
		);
	}

	// Credits running low (amber) — dismissable for the month.
	if (state.kind === "creditsLow") {
		if (dismissed) return null;
		return (
			<div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 dark:border-amber-900 dark:bg-amber-950/40 lg:px-8">
				<p className="flex-1 text-sm text-foreground/90">
					<span className="font-medium">
						{ordersBalanceLabel(state.total)}.
					</span>{" "}
					When you run out, orders keep coming in but you can't work on them
					until you add credits.
				</p>
				<Link
					to="/app/settings"
					search={{ tab: "billing" }}
					hash="credits"
					className="inline-flex h-9 w-fit shrink-0 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
				>
					See credits
				</Link>
				{dismissKey ? (
					<button
						type="button"
						onClick={dismiss}
						aria-label="Dismiss"
						className="-mr-1 shrink-0 rounded-md p-1.5 text-foreground/50 hover:bg-foreground/5 hover:text-foreground"
					>
						<X className="size-4" />
					</button>
				) : null}
			</div>
		);
	}

	// A declined auto-charge: access is still on, but the saved method needs
	// attention — name the problem and land the seller on the fix. Persistent
	// (no dismiss): it disappears when the invoice settles or dunning resolves.
	if (state.kind === "autoRenewFailed") {
		return (
			<div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 dark:border-amber-900 dark:bg-amber-950/40 lg:px-8">
				<p className="flex-1 text-sm text-foreground/90">
					<span className="font-medium">
						We couldn't charge your saved payment method for your renewal.
					</span>{" "}
					Pay the invoice or update your method — your store stays live
					meanwhile.
				</p>
				<Link
					to="/app/settings"
					search={{ tab: "billing" }}
					className="inline-flex h-9 w-fit shrink-0 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
				>
					Fix payment
				</Link>
			</div>
		);
	}

	// Expired because the comp was turned off (z8r3fdeub2): the same lock as past-due, but
	// "pay your subscription" would be a lie — they never had one. Name what
	// happened and send them to the plan picker.
	if (state.kind === "compEnded") {
		const waUrl = buildWaContactLink(
			`Hi, my sponsored Kedaipal access has ended and I'd like to talk about a plan for my store (/${slug}).`,
			supportWa,
		);
		return (
			<div className="flex flex-col gap-2 border-b border-red-200 bg-red-50 px-5 py-3 dark:border-red-900 dark:bg-red-950/40 sm:flex-row sm:items-center sm:justify-between lg:px-8">
				<p className="text-sm text-foreground/90">
					<span className="font-medium">Your sponsored access has ended.</span>{" "}
					Your dashboard is view-only until you choose a plan — your storefront
					stays live and buyers can still order.
				</p>
				<div className="flex shrink-0 items-center gap-2">
					<a
						href={waUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3.5 text-sm font-medium"
					>
						Message us
					</a>
					<Link
						to="/app/settings"
						search={{ tab: "billing" }}
						className="inline-flex h-9 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
					>
						Choose a plan
					</Link>
				</div>
			</div>
		);
	}

	if (state.kind === "pastDue") {
		const waUrl = buildWaContactLink(
			`Hi, I'd like to settle my Kedaipal subscription for my store (/${slug}).`,
			supportWa,
		);
		return (
			<div className="flex flex-col gap-2 border-b border-red-200 bg-red-50 px-5 py-3 dark:border-red-900 dark:bg-red-950/40 sm:flex-row sm:items-center sm:justify-between lg:px-8">
				{/* A TEAMMATE cannot pay this bill — billing is the owner's (86exr91r4).
				    Telling them "view-only until you pay" and handing them a billing
				    link they can't open is an instruction they can't follow, so they
				    get the fact and who to ask instead. */}
				<p className="text-sm text-foreground/90">
					<span className="font-medium">
						{isMember
							? "This store's subscription is past due."
							: "Your subscription is past due."}
					</span>{" "}
					{isMember
						? "The dashboard is view-only until the owner renews — the storefront stays live and buyers can still order."
						: "Your dashboard is view-only until you pay — your storefront stays live and buyers can still order."}
				</p>
				<div
					className={`flex shrink-0 items-center gap-2 ${isMember ? "hidden" : ""}`}
				>
					<Link
						to="/app/settings"
						search={{ tab: "billing" }}
						className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3.5 text-sm font-medium"
					>
						View billing
					</Link>
					<a
						href={waUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex h-9 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
					>
						Message us to pay
					</a>
				</div>
			</div>
		);
	}

	// "Trial ended" is urgent + persistent (red, no dismiss) until the cron flips
	// it to past_due.
	const isEndedTrial = state.kind === "trialWarn" && state.ended;
	if (dismissed && !isEndedTrial) return null;

	const message =
		state.kind === "invoiceWarn"
			? `Your invoice is due in ${dayLabel(state.daysLeft)}${
					pending ? ` · ${formatPrice(pending.total, pending.currency)}` : ""
				}. Pay to keep your store active.`
			: state.kind === "firstInvoice"
				? `${
						state.reason === "first_order"
							? "Your first order is in — your first invoice is "
							: "Your free period has ended — your first invoice is "
					}${
						state.daysLeft === undefined
							? "on its way. It'll appear in Billing in a few minutes."
							: `ready${
									pending
										? ` · ${formatPrice(pending.total, pending.currency)}`
										: ""
								}, due in ${dayLabel(state.daysLeft)}. Pay it from Billing, or switch plan there first.`
					}`
				: isEndedTrial
					? "Your free period has ended. Choose a plan to continue — your storefront stays live."
					: `Your free period ends in ${dayLabel(state.kind === "trialWarn" ? state.daysLeft : 0)} — or sooner, with your first order. Your first invoice arrives then; nothing to do before that.`;

	return (
		<div
			className={`flex items-center gap-3 border-b px-5 py-3 lg:px-8 ${
				isEndedTrial
					? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
					: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
			}`}
		>
			<p className="flex-1 text-sm text-foreground/90">{message}</p>
			<Link
				to="/app/settings"
				search={{ tab: "billing" }}
				className="inline-flex h-9 w-fit shrink-0 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
			>
				View billing
			</Link>
			{dismissKey ? (
				<button
					type="button"
					onClick={dismiss}
					aria-label="Dismiss"
					className="-mr-1 shrink-0 rounded-md p-1.5 text-foreground/50 hover:bg-foreground/5 hover:text-foreground"
				>
					<X className="size-4" />
				</button>
			) : null}
		</div>
	);
}

function dayLabel(days: number): string {
	return `${days} day${days === 1 ? "" : "s"}`;
}

/** Session-scoped dismiss: snoozes for this browser session, returns next login;
 * a changed `key` (new deadline) re-shows. */
function useDismissed(key: string | null): [boolean, () => void] {
	const [dismissed, setDismissed] = useState(false);
	useEffect(() => {
		if (!key || typeof window === "undefined") {
			setDismissed(false);
			return;
		}
		setDismissed(window.sessionStorage.getItem(key) === "1");
	}, [key]);
	const dismiss = () => {
		if (key && typeof window !== "undefined") {
			window.sessionStorage.setItem(key, "1");
		}
		setDismissed(true);
	};
	return [dismissed, dismiss];
}
