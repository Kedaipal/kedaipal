// The Orders view switch: Cards · Table · Calendar.
//
// These began as two separate controls — a Cards/Table switch (86eyrtz74) and
// an Inbox/Calendar one (booking S4) — which landed side by side in the same
// header cluster and read as two identical pills doing different jobs. From
// the seller's side there is only one question, "how do I want to look at my
// orders", with three answers, so it is one control.
//
// That Cards/Table change the current route's view while Calendar navigates is
// an implementation detail the seller never sees. It does mean the segments
// render as different elements: a real <Link> for anything that navigates
// (⌘-click, copy-link-address and crawlers all keep working) and a <button>
// only where the choice is local state.

import { Link } from "@tanstack/react-router";
import { CalendarRange, LayoutGrid, Rows3 } from "lucide-react";
import { cn } from "../../lib/utils";

export type OrdersView = "cards" | "table" | "calendar";

const segmentClass = (active: boolean) =>
	cn(
		"flex size-10 items-center justify-center rounded-[10px] transition-colors",
		active
			? "bg-background text-foreground shadow-sm"
			: "text-muted-foreground hover:text-foreground",
	);

export function OrdersViewToggle({
	active,
	showCalendar,
	onSelectView,
}: {
	active: OrdersView;
	/** Booking stores only — a store with no booking listings has no calendar
	 * to show, so it keeps the plain two-segment switch. */
	showCalendar: boolean;
	/** Supplied by the inbox, where Cards/Table are local view state. Omitted
	 * on the calendar page, where choosing either navigates back to the list. */
	onSelectView?: (view: "cards" | "table") => void;
}) {
	return (
		<div className="flex h-11 shrink-0 items-center rounded-xl border border-border bg-muted/60 p-0.5">
			<span className="sr-only">Orders view</span>
			{(
				[
					{ value: "cards", label: "Cards", Icon: LayoutGrid },
					{ value: "table", label: "Table", Icon: Rows3 },
				] as const
			).map(({ value, label, Icon }) =>
				onSelectView ? (
					<button
						key={value}
						type="button"
						aria-pressed={active === value}
						aria-label={`${label} view`}
						title={`${label} view`}
						onClick={() => onSelectView(value)}
						className={segmentClass(active === value)}
					>
						<Icon className="size-4.5" aria-hidden="true" />
					</button>
				) : (
					<Link
						key={value}
						to="/app/orders"
						search={value === "table" ? { view: "table" } : {}}
						aria-label={`${label} view`}
						title={`${label} view`}
						className={segmentClass(active === value)}
					>
						<Icon className="size-4.5" aria-hidden="true" />
					</Link>
				),
			)}
			{showCalendar ? (
				<Link
					to="/app/orders/calendar"
					aria-label="Calendar view"
					title="Calendar view"
					aria-current={active === "calendar" ? "page" : undefined}
					className={segmentClass(active === "calendar")}
				>
					<CalendarRange className="size-4.5" aria-hidden="true" />
				</Link>
			) : null}
		</div>
	);
}
