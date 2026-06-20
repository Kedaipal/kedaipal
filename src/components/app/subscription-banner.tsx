import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { type SubscriptionView, trialDaysLeft } from "../../lib/subscription";

/**
 * Dashboard banner for subscription state. Renders in the app shell beside the
 * ConsentBanner. Trial countdown while `trialing`, a past-due upgrade CTA (with a
 * wa.me link to settle manually) while `past_due`. Nothing for active/comped — so
 * paying + pilot retailers see a clean shell. See docs/manual-subscription.md.
 */
export function SubscriptionBanner({
	subscription,
	slug,
}: {
	subscription?: SubscriptionView;
	slug: string;
}) {
	// WA number for the "message us to pay" CTA. Only the past-due banner needs it,
	// so skip the query (and its storage.getUrl) on the common active/trialing path.
	const instructions = useQuery(
		api.billing.paymentInstructions,
		subscription?.status === "past_due" ? {} : "skip",
	);

	if (!subscription || subscription.comped) return null;

	const now = Date.now();

	if (subscription.status === "trialing") {
		const days = trialDaysLeft(subscription.trialEndsAt, now);
		// Gentle: only nag in the final stretch of the trial, not all 14 days.
		if (days > 5) return null;
		const ended = days <= 0;
		return (
			<div
				className={`flex flex-col gap-2 border-b px-5 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-8 ${
					ended
						? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
						: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
				}`}
			>
				<p className="text-sm text-foreground/90">
					{ended
						? "Your free trial has ended. Pay your first invoice to keep growing your store."
						: `Your free trial ends in ${days} day${days === 1 ? "" : "s"}. Pay your first invoice to keep your store.`}
				</p>
				<Link
					to="/app/settings"
					search={{ tab: "billing" }}
					className="inline-flex h-9 w-fit shrink-0 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
				>
					View billing
				</Link>
			</div>
		);
	}

	if (subscription.status === "past_due") {
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
							rel="noreferrer"
							className="inline-flex h-9 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background"
						>
							Message us to pay
						</a>
					) : null}
				</div>
			</div>
		);
	}

	return null;
}
