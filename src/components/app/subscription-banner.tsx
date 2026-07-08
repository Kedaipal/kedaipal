import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { formatPrice } from "../../lib/format";
import {
	resolveBannerState,
	type SubscriptionView,
} from "../../lib/subscription";

/**
 * Dashboard subscription banner (app shell). Escalates by urgency:
 *  - `past_due` → red, non-dismissable (the dashboard is soft-locked).
 *  - a pending invoice due within 5 days → amber warning, dismissable.
 *  - trial ending within 5 days → amber warning, dismissable (red + persistent
 *    once it's actually ended, before the cron flips it to past_due).
 *  - the SOFT monthly order cap → amber upgrade nudge: dismissable at ≥80%
 *    (keyed by month, so it returns next month), persistent once the cap is
 *    passed. Orders are NEVER blocked — this is the upsell lever, not a lock.
 * Nothing for active/comped with nothing due. Warnings are dismissable for the
 * session only (sessionStorage, keyed by the deadline) so they return next login
 * and a new deadline re-shows. See docs/manual-subscription.md.
 */
export function SubscriptionBanner({
	subscription,
	ordersThisMonth,
	slug,
}: {
	subscription?: SubscriptionView;
	ordersThisMonth?: number;
	slug: string;
}) {
	const skipInvoice =
		!subscription || subscription.comped || subscription.status === "past_due";
	const pending = useQuery(
		api.invoices.myNextDueInvoice,
		skipInvoice ? "skip" : {},
	);
	// WA "message us to pay" CTA only needed on the past-due banner.
	const instructions = useQuery(
		api.billing.paymentInstructions,
		subscription?.status === "past_due" ? {} : "skip",
	);

	const now = Date.now();
	const state = resolveBannerState(
		subscription,
		pending?.dueDate,
		now,
		undefined,
		ordersThisMonth,
	);

	// Dismiss key: only the soft (amber) warnings are dismissable, keyed by their
	// deadline (or month, for the cap nudge) so the next deadline re-surfaces.
	const dismissKey =
		state.kind === "invoiceWarn"
			? `subwarn:inv:${pending?.dueDate}`
			: state.kind === "trialWarn" && !state.ended
				? `subwarn:trial:${subscription?.trialEndsAt}`
				: state.kind === "orderCapNear"
					? `subwarn:cap:${new Date(now).toISOString().slice(0, 7)}`
					: null;
	const [dismissed, dismiss] = useDismissed(dismissKey);

	if (state.kind === "none") return null;

	// Soft order-cap nudge (amber) — upsell, not a lock. "Near" is dismissable
	// for the month; "over" stays until the month rolls or they upgrade.
	if (state.kind === "orderCapNear" || state.kind === "orderCapOver") {
		if (dismissed && state.kind === "orderCapNear") return null;
		const over = state.kind === "orderCapOver";
		return (
			<div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 dark:border-amber-900 dark:bg-amber-950/40 lg:px-8">
				<p className="flex-1 text-sm text-foreground/90">
					<span className="font-medium">
						{over
							? `You've passed your plan's ${state.cap} orders this month (${state.used} so far).`
							: `${state.used} of ${state.cap} plan orders used this month.`}
					</span>{" "}
					Orders keep flowing as normal — upgrade for more headroom.
				</p>
				<Link
					to="/app/settings"
					search={{ tab: "billing" }}
					className="inline-flex h-9 w-fit shrink-0 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
				>
					Upgrade
				</Link>
				{!over && dismissKey ? (
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

	if (state.kind === "pastDue") {
		const phone = instructions?.whatsappPhone;
		const waUrl = phone
			? `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(
					`Hi, I'd like to settle my Kedaipal subscription for my store (/${slug}).`,
				)}`
			: undefined;
		return (
			<div className="flex flex-col gap-2 border-b border-red-200 bg-red-50 px-5 py-3 dark:border-red-900 dark:bg-red-950/40 sm:flex-row sm:items-center sm:justify-between lg:px-8">
				<p className="text-sm text-foreground/90">
					<span className="font-medium">Your subscription is past due.</span>{" "}
					Your storefront and existing orders stay live — pay to resume editing
					your store.
				</p>
				<div className="flex shrink-0 items-center gap-2">
					<Link
						to="/app/settings"
						search={{ tab: "billing" }}
						className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3.5 text-sm font-medium"
					>
						View billing
					</Link>
					{waUrl ? (
						<a
							href={waUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex h-9 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
						>
							Message us to pay
						</a>
					) : null}
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
			: isEndedTrial
				? "Your free trial has ended. Choose a plan to continue — your storefront stays live."
				: `Your free trial ends in ${dayLabel(state.kind === "trialWarn" ? state.daysLeft : 0)}. Choose a plan to continue.`;

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
