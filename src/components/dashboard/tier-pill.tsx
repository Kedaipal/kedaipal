import { Link } from "@tanstack/react-router";
import {
	PLAN_LABEL,
	type SubscriptionView,
	type TierTone,
	tierPill,
} from "../../lib/subscription";
import { cn } from "../../lib/utils";

// Shared chip shape. Font size lives here (text-[10px]) but a passed `className`
// can override it (the mobile header shrinks to text-[9px]).
const PILL_BASE =
	"inline-flex w-fit max-w-full items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide";

function toneClass(tone: TierTone): string {
	switch (tone) {
		case "warn":
			return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
		case "founding":
			return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
		case "admin":
			return "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300";
		case "trial":
			return "border border-accent/20 bg-accent/10 text-accent dark:bg-accent/15";
		default:
			return "bg-muted text-muted-foreground";
	}
}

/**
 * Small subscription-status pill shown under the store name in the sidebar +
 * mobile header. Always visible so tier/trial/past-due is never buried only on
 * the billing page. Links to the billing settings tab. For a Kedaipal admin on
 * their OWN store (`admin`), it reads "Admin" and links to the console instead —
 * admins run the app for free and are never soft-locked.
 *
 * Founding-10 members' status pill reads "Founding #N" (± trial/past-due), which
 * on its own hides their actual tier — so we render a second neutral **tier chip**
 * (Starter/Pro/Scale) next to it, both inside one link to billing. On mobile the
 * pair wraps as a unit and inherits the header's smaller text so it stays neat.
 * See docs/manual-subscription.md + docs/admin-console.md.
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

	// Admin pill points at the console; the seller-state pill points at billing.
	if (tone === "admin") {
		return (
			<Link
				to="/app/admin/sellers"
				className={cn(
					PILL_BASE,
					"transition-opacity hover:opacity-80",
					toneClass(tone),
					className,
				)}
			>
				{displayLabel}
			</Link>
		);
	}

	// Founding members: pair the "Founding #N" status chip with their tier chip so
	// the plan stays visible (the status chip alone would hide it). One link, two
	// chips; `className` (e.g. the mobile header's smaller text) reaches both, and
	// the pair wraps together rather than overflowing on a narrow screen.
	if (foundingRank) {
		return (
			<Link
				to="/app/settings"
				search={{ tab: "billing" }}
				className={cn(
					"inline-flex max-w-full flex-wrap items-center gap-1 transition-opacity hover:opacity-80",
					className,
				)}
			>
				<span className={cn(PILL_BASE, toneClass(tone), className)}>
					{displayLabel}
				</span>
				<span className={cn(PILL_BASE, toneClass("neutral"), className)}>
					{PLAN_LABEL[subscription.plan]}
				</span>
			</Link>
		);
	}

	return (
		<Link
			to="/app/settings"
			search={{ tab: "billing" }}
			className={cn(
				PILL_BASE,
				"transition-opacity hover:opacity-80",
				toneClass(tone),
				className,
			)}
		>
			{displayLabel}
		</Link>
	);
}
