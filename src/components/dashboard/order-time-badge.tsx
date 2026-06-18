import { Clock } from "lucide-react";
import {
	formatStatusAge,
	type OrderStatus,
	statusAgeMs,
	statusAgeSeverity,
} from "../../../convex/lib/orderBuckets";
import { cn } from "../../lib/utils";

/**
 * "Time in status" badge for an order row — e.g. "2h". Pending orders escalate
 * (amber >4h, red >24h) since that's the missed-order risk window; other statuses
 * show their age in a neutral tone. See convex/lib/orderBuckets.ts.
 */
export function OrderTimeBadge({
	order,
	now,
}: {
	order: {
		status: string;
		statusChangedAt?: number;
		updatedAt?: number;
		createdAt: number;
	};
	now: number;
}) {
	const ms = statusAgeMs(order, now);
	const severity = statusAgeSeverity(order.status as OrderStatus, ms);
	const cls =
		severity === "urgent"
			? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
			: severity === "warn"
				? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
				: "text-muted-foreground";
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
				cls,
			)}
			title={`In this status for ${formatStatusAge(ms)}`}
		>
			<Clock className="size-3" aria-hidden="true" />
			{formatStatusAge(ms)}
		</span>
	);
}
