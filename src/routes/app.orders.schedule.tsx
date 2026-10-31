// The Orders → Schedule view (`z8r3fdjv0d`): every dated programme — events
// and bookings — on one screen, with how many registered and how many paid per
// date. A read-only LENS over the orders the inbox lists, like the calendar:
// each row opens the inbox narrowed to exactly the orders it counted.
// See docs/schedule-view.md.

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardList, History } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { DAY_MS, todayMytMidnight } from "../../convex/lib/fulfilmentDate";
import {
	SCHEDULE_AHEAD_DAYS,
	SCHEDULE_PAST_DAYS,
} from "../../convex/lib/scheduleRows";
import { ProFeatureWall } from "../components/app/pro-gate";
import { PageHeader } from "../components/dashboard/page-header";
import { OrdersViewToggle } from "../components/order/orders-view-toggle";
import { isPastRow, ScheduleRows } from "../components/order/schedule-rows";
import { NewBookingLinks } from "../components/products/new-booking-links";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { usePermission } from "../hooks/usePermission";
import { hasFeature } from "../lib/subscription";
import { TONE_PANEL } from "../lib/tone";
import { cn } from "../lib/utils";

export const Route = createFileRoute("/app/orders/schedule")({
	// `past` is the one thing on this page worth a link: "show me how the last
	// month's programmes closed out". Returned even when absent — an omitted
	// key leaks its raw value (z8r3fdtk87, src/lib/search-params.ts).
	validateSearch: (search: Record<string, unknown>): { past?: true } => ({
		past: search.past === true || search.past === "true" ? true : undefined,
	}),
	component: OrdersSchedulePage,
});

function OrdersSchedulePage() {
	const retailer = useDashboardRetailer();
	const { past } = Route.useSearch();
	const navigate = Route.useNavigate();
	const canSeeHeadcount = usePermission("products").canRead;
	// Gated with the inbox — every row opens the inbox's listing view, which is
	// a Pro inbox filter. Admin act-as sees through it, as on the inbox.
	const inboxEnabled =
		retailer?.actingAsAdmin === true ||
		hasFeature(retailer?.subscription, "orderInbox");

	const today = todayMytMidnight();
	const fromMyt = past ? today - SCHEDULE_PAST_DAYS * DAY_MS : today;
	const toMyt = today + SCHEDULE_AHEAD_DAYS * DAY_MS;

	const hasBookings = useQuery(
		convexQuery(
			api.bookingBlocks.hasBookingListings,
			retailer ? { retailerId: retailer._id } : "skip",
		),
	).data;
	const hasDated = useQuery(
		convexQuery(
			api.schedule.hasDatedListings,
			retailer && inboxEnabled ? { retailerId: retailer._id } : "skip",
		),
	).data;
	const schedule = useQuery(
		convexQuery(
			api.schedule.byDate,
			retailer && inboxEnabled
				? { retailerId: retailer._id, fromMyt, toMyt }
				: "skip",
		),
	).data;

	const toggle = (
		<OrdersViewToggle
			active="schedule"
			showCalendar={hasBookings === true}
			showSchedule
		/>
	);
	const header = (
		<>
			<PageHeader
				title="Orders"
				subtitle="Schedule — registered vs paid, per date"
				actions={toggle}
			/>
			<div className="flex items-center justify-between gap-3 lg:hidden">
				<div className="min-w-0">
					<h2 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight">
						Orders
					</h2>
					<p className="text-[13px] text-muted-foreground">Schedule</p>
				</div>
				{toggle}
			</div>
		</>
	);

	if (!retailer) return <ScheduleSkeleton />;

	if (!inboxEnabled) {
		return (
			<div className="flex flex-col gap-4">
				{header}
				<ProFeatureWall
					slug={retailer.slug}
					icon={<ClipboardList className="size-6 text-muted-foreground" />}
					title="Schedule"
					blurb="Every event and booking date on one screen, with how many registered and how many have paid — so you know who to chase before the day."
					bullets={[
						"Seats taken against your cap, per date",
						"Paid, claimed and unpaid at a glance",
						"One tap to the orders behind each date",
					]}
				/>
			</div>
		);
	}

	if (schedule === undefined || hasDated === undefined) {
		return (
			<div className="flex flex-col gap-4">
				{header}
				<ScheduleSkeleton rowsOnly />
			</div>
		);
	}

	const upcoming = schedule.rows.filter((r) => !isPastRow(r, today));
	// Most recent first: the question about the past is "how did last week's
	// luncheon close out", not "what happened 30 days ago".
	const pastRows = schedule.rows.filter((r) => isPastRow(r, today)).reverse();
	const anyClaimed = schedule.rows.some((r) => r.claimed > 0);

	const pastToggle = (
		<Button
			variant="outline"
			className="tap-target self-start"
			onClick={() =>
				navigate({ search: { past: past ? undefined : true }, replace: true })
			}
		>
			<History className="size-4" aria-hidden="true" />
			{past ? "Hide past dates" : `Show past ${SCHEDULE_PAST_DAYS} days`}
		</Button>
	);

	return (
		<div className="flex flex-col gap-4">
			{header}

			{/* What this screen covers, said once — the 90-day horizon is a
			    constraint, and a constraint is surfaced, never silent. */}
			<p className="text-sm text-muted-foreground">
				Every event and booking date in the next {SCHEDULE_AHEAD_DAYS} days.
				Events count seats; bookings count bookings.
				{anyClaimed ? (
					<>
						{" "}
						<span className="font-medium text-foreground">Claimed</span> means
						the buyer says they paid — check your bank, then mark it paid.
					</>
				) : null}
			</p>

			{schedule.truncated ? (
				<p
					className={cn("rounded-xl border px-4 py-3 text-sm", TONE_PANEL.warn)}
				>
					This window holds more orders than the schedule can count at once, so
					some numbers are short. Open a date's orders for the full list.
				</p>
			) : null}

			{!hasDated && schedule.rows.length === 0 ? (
				<EmptyNoListings />
			) : upcoming.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
					<ClipboardList className="size-8 text-muted-foreground" aria-hidden />
					<p className="font-heading text-base font-bold">
						Nothing scheduled in the next {SCHEDULE_AHEAD_DAYS} days
					</p>
					<p className="max-w-sm text-sm text-muted-foreground">
						Dates appear here once an event is set or a booking comes in.
					</p>
				</div>
			) : (
				<ScheduleRows
					rows={upcoming}
					todayMyt={today}
					canSeeHeadcount={canSeeHeadcount}
				/>
			)}

			{/* A store with nothing dated has no past to show either. */}
			{hasDated || schedule.rows.length > 0 || past ? pastToggle : null}

			{past ? (
				pastRows.length > 0 ? (
					<section className="flex flex-col gap-3">
						<h2 className="font-heading text-base font-bold">
							Past {SCHEDULE_PAST_DAYS} days
						</h2>
						<ScheduleRows
							rows={pastRows}
							todayMyt={today}
							canSeeHeadcount={canSeeHeadcount}
							past
						/>
					</section>
				) : (
					<p className="text-sm text-muted-foreground">
						No dated programmes in the past {SCHEDULE_PAST_DAYS} days.
					</p>
				)
			) : null}
		</div>
	);
}

/** Deep-linked with nothing dated to sell — say what the page is for and
 * offer the three doors, named in the wizard's own words. */
function EmptyNoListings() {
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
			<ClipboardList className="size-8 text-muted-foreground" aria-hidden />
			<div>
				<p className="font-heading text-base font-bold">
					No dated programmes coming up
				</p>
				<p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
					Add an event or a booking listing — its dates show here with how many
					registered and how many paid.
				</p>
			</div>
			<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
				<Button asChild variant="outline" className="tap-target">
					<Link to="/app/products/new" search={{ card: "event" }}>
						Add an event
					</Link>
				</Button>
				<NewBookingLinks />
			</div>
		</div>
	);
}

function ScheduleSkeleton({ rowsOnly = false }: { rowsOnly?: boolean }) {
	return (
		<div className="flex flex-col gap-4">
			{rowsOnly ? null : (
				<Skeleton className="hidden h-16 w-full rounded-none lg:block" />
			)}
			<Skeleton className="h-4 w-2/3" />
			{[0, 1, 2].map((i) => (
				<Skeleton key={i} className="h-36 w-full rounded-2xl lg:h-16" />
			))}
		</div>
	);
}
