import { Link } from "@tanstack/react-router";
import { type SubscriptionView, tierPill } from "../../lib/subscription";
import { cn } from "../../lib/utils";

/**
 * Small subscription-status pill shown under the store name in the sidebar +
 * mobile header. Always visible so tier/trial/past-due is never buried only on
 * the billing page. Links to the billing settings tab. See
 * docs/manual-subscription.md.
 */
export function TierPill({
	subscription,
}: {
	subscription?: SubscriptionView;
}) {
	if (!subscription) return null;
	const { label, tone } = tierPill(subscription, Date.now());
	const toneClass =
		tone === "warn"
			? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
			: tone === "trial"
				? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
				: "bg-muted text-muted-foreground";
	return (
		<Link
			to="/app/settings"
			search={{ tab: "billing" }}
			className={cn(
				"inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-opacity hover:opacity-80",
				toneClass,
			)}
		>
			{label}
		</Link>
	);
}
