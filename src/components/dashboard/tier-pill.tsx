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
	compact = false,
	className,
}: {
	subscription?: SubscriptionView;
	compact?: boolean;
	className?: string;
}) {
	if (!subscription) return null;
	const { label, tone } = tierPill(subscription, Date.now());
	const displayLabel =
		compact && subscription.status === "trialing"
			? label.replace(/(\d+) days? left/i, "$1d left")
			: label;
	const toneClass =
		tone === "warn"
			? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
			: tone === "trial"
				? "border border-accent/20 bg-accent/10 text-accent dark:bg-accent/15"
				: "bg-muted text-muted-foreground";
	return (
		<Link
			to="/app/settings"
			search={{ tab: "billing" }}
			className={cn(
				"inline-flex w-fit max-w-full items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-opacity hover:opacity-80",
				toneClass,
				className,
			)}
		>
			{displayLabel}
		</Link>
	);
}
