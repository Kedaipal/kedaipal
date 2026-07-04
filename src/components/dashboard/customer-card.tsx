import { Link } from "@tanstack/react-router";
import type { Doc } from "../../../convex/_generated/dataModel";
import { formatPhone, getDisplayName } from "../../lib/customer";
import {
	formatPrice,
	formatPriceCompact,
	formatRelativeTime,
} from "../../lib/format";
import { cn } from "../../lib/utils";

/** Two-letter initials from the display name, or null when phone-only. */
function nameInitials(customer: Doc<"customers">): string | null {
	const source = customer.name?.trim() || customer.waProfileName?.trim();
	if (!source || !/[a-z0-9]/i.test(source[0])) return null;
	const parts = source.split(/\s+/);
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Rotating avatar tints (deterministic by name hash) so a list of customers
// scans faster than uniform grey circles. Dark-mode pairs included.
const AVATAR_TINTS = [
	"bg-foreground text-background",
	"bg-accent/15 text-accent-emphasis",
	"bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
	"bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
	"bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
];

function avatarTint(seed: string): string {
	let h = 0;
	for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
	return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

export function CustomerCard({
	customer,
	currency,
}: {
	customer: Doc<"customers">;
	currency: string;
}) {
	const displayName = getDisplayName(customer);
	const initials = nameInitials(customer);
	const hasName = Boolean(
		customer.name?.trim() || customer.waProfileName?.trim(),
	);

	return (
		<Link
			to="/app/customers/$customerId"
			params={{ customerId: customer._id }}
			className="group flex items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3 transition-all hover:border-ring hover:shadow-sm"
		>
			<div
				className={cn(
					"flex size-11 shrink-0 items-center justify-center rounded-full font-heading text-sm font-extrabold",
					initials ? avatarTint(displayName) : "bg-muted text-muted-foreground",
				)}
				aria-hidden
			>
				{initials ?? "#"}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-[14.5px] font-semibold">
					{displayName}
				</span>
				<span className="truncate text-[12.5px] text-muted-foreground">
					{customer.orderCount} order{customer.orderCount === 1 ? "" : "s"}
					{" · last "}
					{formatRelativeTime(customer.lastOrderAt)}
					{hasName ? ` · ${formatPhone(customer.waPhone)}` : ""}
				</span>
			</div>
			{/* Lifetime value on the right edge — "who is this returning customer?"
			    answered in the list, no tap needed. Compact so a whale's lifetime
			    figure never crushes the name column. */}
			<span
				title={formatPrice(customer.totalSpent, currency)}
				className="shrink-0 text-sm font-bold tabular-nums text-accent-emphasis"
			>
				{formatPriceCompact(customer.totalSpent, currency)}
			</span>
		</Link>
	);
}
