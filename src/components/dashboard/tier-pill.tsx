import { Link } from "@tanstack/react-router";
import { type SubscriptionView, tierPill } from "../../lib/subscription";
import { cn } from "../../lib/utils";

/**
 * Small subscription-status pill shown under the store name in the sidebar +
 * mobile header. Always visible so tier/trial/past-due is never buried only on
 * the billing page. Links to the billing settings tab. For a Kedaipal admin on
 * their OWN store (`admin`), it reads "Admin" and links to the console instead —
 * admins run the app for free and are never soft-locked. See
 * docs/manual-subscription.md + docs/admin-console.md.
 */
export function TierPill({
	subscription,
	foundingRank,
	admin = false,
	compact = false,
	className,
}: {
	subscription?: SubscriptionView;
	foundingRank?: number;
	admin?: boolean;
	compact?: boolean;
	className?: string;
}) {
	if (!subscription) return null;
	const { label, tone } = tierPill(
		subscription,
		Date.now(),
		foundingRank,
		admin,
	);
	const displayLabel =
		compact && subscription.status === "trialing"
			? label.replace(/(\d+) days? left/i, "$1d left")
			: label;
	const toneClass =
		tone === "warn"
			? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
			: tone === "founding"
				? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
				: tone === "admin"
					? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
					: tone === "trial"
						? "border border-accent/20 bg-accent/10 text-accent dark:bg-accent/15"
						: "bg-muted text-muted-foreground";
	const pillClass = cn(
		"inline-flex w-fit max-w-full items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-opacity hover:opacity-80",
		toneClass,
		className,
	);
	// Admin pill points at the console; the seller-state pill points at billing.
	if (tone === "admin") {
		return (
			<Link to="/app/admin/sellers" className={pillClass}>
				{displayLabel}
			</Link>
		);
	}
	return (
		<Link to="/app/settings" search={{ tab: "billing" }} className={pillClass}>
			{displayLabel}
		</Link>
	);
}
