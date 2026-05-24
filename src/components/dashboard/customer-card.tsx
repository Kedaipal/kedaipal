import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { Doc } from "../../../convex/_generated/dataModel";
import { formatPhone, getDisplayName } from "../../lib/customer";
import { formatPrice, formatRelativeTime } from "../../lib/format";
import { cn } from "../../lib/utils";

/** First letter of the display name, or null when we only have a phone number. */
function nameInitial(customer: Doc<"customers">): string | null {
	const source = customer.name?.trim() || customer.waProfileName?.trim();
	if (!source) return null;
	const ch = source[0];
	return /[a-z0-9]/i.test(ch) ? ch.toUpperCase() : null;
}

export function CustomerCard({
	customer,
	currency,
}: {
	customer: Doc<"customers">;
	currency: string;
}) {
	const displayName = getDisplayName(customer);
	const initial = nameInitial(customer);
	const hasName = Boolean(
		customer.name?.trim() || customer.waProfileName?.trim(),
	);

	return (
		<Link
			to="/app/customers/$customerId"
			params={{ customerId: customer._id }}
			className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:border-ring hover:shadow-sm"
		>
			<div
				className={cn(
					"flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground",
				)}
				aria-hidden
			>
				{initial ?? "#"}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="truncate font-medium">{displayName}</span>
				{hasName ? (
					<span className="truncate font-mono text-xs text-muted-foreground">
						{formatPhone(customer.waPhone)}
					</span>
				) : null}
				<div className="mt-0.5 flex items-center justify-between gap-2">
					<span className="text-xs text-muted-foreground">
						{customer.orderCount} order{customer.orderCount === 1 ? "" : "s"}
						{" · "}
						<span className="font-semibold text-foreground tabular-nums">
							{formatPrice(customer.totalSpent, currency)}
						</span>
					</span>
					<span className="shrink-0 text-[11px] text-muted-foreground">
						{formatRelativeTime(customer.lastOrderAt)}
					</span>
				</div>
			</div>
			<ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
		</Link>
	);
}
