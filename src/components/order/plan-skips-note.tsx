import { CalendarX2 } from "lucide-react";
import { packageDaysLeft } from "../../../convex/lib/bookingPeriod";
import { describeNights, formatNight } from "../../lib/booking-dates";

/**
 * The buyer's half of "Skip a day" (z8r3fdh3ay), under the plan card on
 * `/track`: how many days are left, every day they skipped (the "Last day"
 * row above already shows where the plan now ends), and — because the
 * buyer is never messaged about a skip and there is no buyer button — that
 * skipping exists at all and how to ask for one. The seller does the skip;
 * this page is the record (no WhatsApp goes out, owner call 23 Sep).
 *
 * Only for an open-days plan (`bookingOpenDays`): an every-day pass or a gym
 * month has no skips, so promising one there would be false.
 */
export function PlanSkipsNote({
	order,
	maxSkips,
	storeName,
	ms,
	now = Date.now(),
}: {
	order: {
		status: string;
		bookingCheckIn?: number;
		bookingCheckOut?: number;
		bookingSkippedDays?: readonly number[];
		bookingCustomerSkips?: readonly number[];
		bookingOpenDays?: boolean;
	};
	maxSkips?: number;
	storeName: string;
	ms: boolean;
	now?: number;
}) {
	const skips = [...(order.bookingCustomerSkips ?? [])].sort((a, b) => a - b);
	const checkOut = order.bookingCheckOut;
	if (order.status === "cancelled" || checkOut === undefined) return null;
	// An older order has no frozen flag; a skip on it still proves it's one.
	const isOpenDaysPlan = order.bookingOpenDays === true || skips.length > 0;
	if (!isOpenDaysPlan) return null;

	const left = packageDaysLeft(order, now);
	const ended = now >= checkOut;
	const capReached = maxSkips !== undefined && skips.length >= maxSkips;
	const store = storeName.trim() || (ms ? "kedai" : "the store");
	const capText =
		maxSkips === undefined
			? ""
			: ms
				? ` (sehingga ${maxSkips} kali bagi setiap pakej)`
				: ` (up to ${maxSkips} per package)`;

	return (
		<div className="mt-1 flex flex-col gap-2 border-t border-border pt-3 text-xs leading-relaxed">
			{left !== null ? (
				<p className="text-sm font-semibold">
					{left === 1
						? ms
							? "Hari terakhir: hari ini"
							: "Last day: today"
						: ms
							? `${left} hari lagi, termasuk hari ini`
							: `${left} days left, today included`}
				</p>
			) : null}
			{skips.length > 0 ? (
				<p className="flex gap-2">
					<CalendarX2
						aria-hidden
						className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
					/>
					<span>
						{ms
							? "Dilangkau atas permintaan anda: "
							: "Skipped at your request: "}
						<span className="font-medium">
							{describeNights(skips, formatNight, "day")}
						</span>
						{maxSkips !== undefined
							? ms
								? ` (${skips.length} daripada ${maxSkips})`
								: ` (${skips.length} of ${maxSkips})`
							: ""}
						.
					</span>
				</p>
			) : null}
			{ended ? null : capReached ? (
				// At the cap the "ask for a skip" line would be a false promise
				// (found in the z8r3fdh3ay hands-on test) — say what's true.
				<p className="text-muted-foreground">
					{ms
						? `Anda telah menggunakan semua ${maxSkips} langkauan bagi pakej ini.`
						: `You've used all ${maxSkips} skip${maxSkips === 1 ? "" : "s"} on this package.`}
				</p>
			) : (
				<p className="text-muted-foreground">
					{ms
						? `Tak dapat hadir sehari? Mesej ${store} — mereka boleh langkau hari itu dan tambah sehari di hujung pakej anda${capText}.`
						: `Can't make a day? Message ${store} — they can skip it and add a day to the end of your package${capText}.`}
				</p>
			)}
		</div>
	);
}
