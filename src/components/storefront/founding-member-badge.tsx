import { Award } from "lucide-react";

/**
 * Public storefront badge shown on kedaipal.com/<slug> for a Founding Member.
 * Reads the denormalized `isFoundingMember` flag (public-safe). Subscription
 * state is never exposed to shoppers. See docs/manual-subscription.md.
 */
export function FoundingMemberBadge({ rank }: { rank?: number }) {
	return (
		<span className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
			<Award className="size-3.5" aria-hidden="true" />
			Founding Member{rank ? ` #${rank}` : ""}
		</span>
	);
}
