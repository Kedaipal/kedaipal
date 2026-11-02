// The Orders → Calendar view (booking bundle S4, `86eyn4kdb`): the seller's
// month grid over booking nights. A LENS over the same orders the inbox lists —
// block/unblock is its one write; everything else taps through to the order.

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarRange } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { PageHeader } from "../components/dashboard/page-header";
import { OrdersViewToggle } from "../components/order/orders-view-toggle";
import { SellerBookingCalendar } from "../components/order/seller-booking-calendar";
import { NewBookingLinks } from "../components/products/new-booking-links";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { hasFeature } from "../lib/subscription";

export const Route = createFileRoute("/app/orders/calendar")({
	component: OrdersCalendarPage,
});

function OrdersCalendarPage() {
	const retailer = useDashboardRetailer();
	const hasBookings = useQuery(
		convexQuery(
			api.bookingBlocks.hasBookingListings,
			retailer ? { retailerId: retailer._id } : "skip",
		),
	).data;

	// The calendar is all-tier; Schedule is a Pro inbox lens, so a Starter
	// store's switch here stays Calendar-only, as it is on the inbox.
	const inboxEnabled =
		retailer?.actingAsAdmin === true ||
		hasFeature(retailer?.subscription, "orderInbox");
	const hasDatedListings = useQuery(
		convexQuery(
			api.schedule.hasDatedListings,
			retailer && inboxEnabled ? { retailerId: retailer._id } : "skip",
		),
	).data;

	if (!retailer || hasBookings === undefined) {
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="hidden h-16 w-full rounded-none lg:block" />
				<Skeleton className="h-96 w-full rounded-2xl" />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<PageHeader
				title="Orders"
				subtitle="Booking calendar"
				actions={
					<OrdersViewToggle
						active="calendar"
						showCalendar
						showSchedule={hasDatedListings === true}
					/>
				}
			/>
			<div className="flex items-center justify-between gap-3 lg:hidden">
				<div className="min-w-0">
					<h2 className="font-heading text-[22px] font-extrabold leading-tight tracking-tight">
						Orders
					</h2>
					<p className="text-[13px] text-muted-foreground">Booking calendar</p>
				</div>
				<OrdersViewToggle
					active="calendar"
					showCalendar
					showSchedule={hasDatedListings === true}
				/>
			</div>

			{hasBookings ? (
				<SellerBookingCalendar retailerId={retailer._id} />
			) : (
				// Deep-linked with no booking listings (e.g. the last one was
				// archived) — say what the page is for instead of an empty grid.
				<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
					<CalendarRange className="size-8 text-muted-foreground" aria-hidden />
					<div>
						<p className="font-heading text-base font-bold">
							No booking listings yet
						</p>
						<p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
							The calendar shows bookings for plans and stays sold by date. Add
							one to start taking requests — it opens with that type already
							picked.
						</p>
					</div>
					<NewBookingLinks />
				</div>
			)}
		</div>
	);
}
