import { cn } from "../../lib/utils";

export type OrderStatus =
	| "pending"
	| "confirmed"
	| "packed"
	| "shipped"
	| "delivered"
	| "cancelled";

const STATUS_STYLES: Record<OrderStatus, string> = {
	pending:
		"bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
	confirmed: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
	packed: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
	shipped:
		"bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
	delivered:
		"bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
	cancelled: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export function StatusBadge({
	status,
	label,
}: {
	status: OrderStatus;
	/**
	 * Resolved display text. Defaults to the raw status (capitalized) when
	 * omitted; pass a resolved label from `resolveStatusLabel` to honour a
	 * retailer's custom stage names. Custom labels keep their own casing, so the
	 * `capitalize` class is only applied to the raw-status fallback.
	 */
	label?: string;
}) {
	const text = label ?? status;
	return (
		<span
			className={cn(
				// A pill is ONE box or it is nothing. As a plain inline span, a label
				// too long for its container ("Ready for Pickup" in a table cell, any
				// long custom stage name on a narrow card) wraps mid-phrase and the
				// rounded background breaks into two ragged fragments. `inline-block`
				// + `truncate` keeps it a single rounded box that ellipsises instead,
				// capped by `max-w-full` so it only ever gives way when it genuinely
				// cannot fit — with the full text on hover.
				"inline-block max-w-full truncate rounded-full px-2.5 py-1 align-middle text-[11px] font-semibold",
				label ? "" : "capitalize",
				STATUS_STYLES[status],
			)}
			title={text}
		>
			{text}
		</span>
	);
}
