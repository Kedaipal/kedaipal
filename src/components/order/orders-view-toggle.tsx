// Inbox · Calendar segmented toggle for the Orders header (booking bundle S4,
// design 86eym0pjg §3). Rendered only when the store has booking listings —
// non-booking stores never see a calendar they have nothing to put on. Links,
// not buttons: the two views are routes, so back/refresh/deep-links work.

import { Link } from "@tanstack/react-router";
import { cn } from "../../lib/utils";

const segmentClass = (active: boolean) =>
	cn(
		"flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-semibold transition-colors",
		active
			? "bg-card text-foreground shadow-sm"
			: "text-muted-foreground hover:text-foreground",
	);

export function OrdersViewToggle({ active }: { active: "inbox" | "calendar" }) {
	return (
		<div className="flex h-11 shrink-0 items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
			<span className="sr-only">Orders view</span>
			<Link
				to="/app/orders"
				className={segmentClass(active === "inbox")}
				aria-current={active === "inbox" ? "page" : undefined}
			>
				Inbox
			</Link>
			<Link
				to="/app/orders/calendar"
				className={segmentClass(active === "calendar")}
				aria-current={active === "calendar" ? "page" : undefined}
			>
				Calendar
			</Link>
		</div>
	);
}
