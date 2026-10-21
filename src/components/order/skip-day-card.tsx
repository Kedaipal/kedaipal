import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { CalendarX2, Loader2, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	applyCustomerSkip,
	latestCustomerSkip,
	planSkipBlocker,
	type SkipPlan,
	skipDayIssue,
} from "../../../convex/lib/bookingSkips";
import {
	DAY_MS,
	formatFulfilmentDate,
	todayMytMidnight,
} from "../../../convex/lib/fulfilmentDate";
import { storeClosedOn } from "../../../convex/lib/openingHours";
import {
	calendarDateFromMytEpoch,
	formatNight,
	mytEpochFromCalendarDate,
} from "../../lib/booking-dates";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";
import {
	Calendar,
	TOUCH_CALENDAR_CLASSNAMES,
	TOUCH_CALENDAR_STYLES,
} from "../ui/calendar";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";

type SkipOrder = SkipPlan & {
	_id: Id<"orders">;
	customer: { name?: string };
};

/**
 * "Skip a day" on an open-days plan (z8r3fdh3ay) — the seller's side of a
 * meal plan's "skip tomorrow, carry it forward". Renders as a row inside the
 * order page's Fulfilment card, under the plan's dates, because a skip is a
 * change to THOSE dates; it is absent (not disabled) on every order that
 * isn't a skippable plan, which `bookings.skipPlan` decides.
 *
 * Everything the row and the dialog say — which days can be picked, why the
 * button is off, the new last day — comes from `convex/lib/bookingSkips`, the
 * module `skipPackageDay` runs, so the preview is the write.
 */
export function SkipDayCard({
	order,
	lockedReason,
}: {
	order: SkipOrder;
	/** Store-wide lock (credits, view-only) — the same sentence every other
	 * order control shows, and it outranks the plan's own reasons. */
	lockedReason?: string;
}) {
	const context = useQuery(
		convexQuery(api.bookings.skipPlan, { orderId: order._id }),
	).data;
	const unskip = useMutation(api.bookings.unskipPackageDay);
	const [open, setOpen] = useState(false);
	const [undoing, setUndoing] = useState(false);

	if (!context) return null;
	const { bookingCheckIn: checkIn, bookingCheckOut: checkOut } = order;
	if (checkIn === undefined || checkOut === undefined) return null;

	const skips = order.bookingCustomerSkips ?? [];
	const latest = latestCustomerSkip(order);
	const blocker =
		lockedReason ?? planSkipBlocker(order, { maxSkips: context.maxSkips });
	// Undo isn't capped (it frees a skip) but obeys every other gate.
	const undoBlocker = lockedReason ?? planSkipBlocker(order, {});
	const allowance =
		context.maxSkips === undefined
			? skips.length === 0
				? null
				: `${skips.length} used`
			: `${skips.length} of ${context.maxSkips} used`;

	async function undoLatest() {
		if (latest === undefined) return;
		setUndoing(true);
		try {
			const { lastDay } = await unskip({ orderId: order._id, day: latest });
			toast.success(
				`Skip undone — the last day is back to ${formatFulfilmentDate(lastDay)}`,
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setUndoing(false);
		}
	}

	return (
		<div className="flex flex-col gap-2 border-t border-border pt-3">
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium">
						Customer skips
						{allowance ? (
							<span className="font-normal text-muted-foreground">
								{" "}
								· {allowance}
							</span>
						) : null}
					</p>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{skips.length === 0
							? "Customer missing a day? Skip it here and the plan's last day moves to the next day you're open. No message is sent — their order page updates."
							: "Each skip moved the last day to the next day you're open. Their order page shows every skip."}
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					className="h-11 shrink-0"
					disabled={blocker !== null}
					onClick={() => setOpen(true)}
				>
					<CalendarX2 className="size-4" />
					Skip a day
				</Button>
			</div>
			{blocker !== null ? (
				<p className="text-xs leading-relaxed text-muted-foreground">
					{blocker}
				</p>
			) : null}
			{skips.length > 0 ? (
				<ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
					{[...skips].reverse().map((day) => {
						const isLatest = day === latest;
						return (
							<li
								key={day}
								className="flex min-h-11 items-center gap-2 px-3 py-1.5 text-sm"
							>
								<span className="flex-1 tabular-nums">
									{formatFulfilmentDate(day)}
								</span>
								{isLatest ? (
									<Button
										variant="ghost"
										size="sm"
										className="h-11 text-xs"
										disabled={undoing || undoBlocker !== null}
										onClick={undoLatest}
									>
										{undoing ? (
											<Loader2 className="size-3.5 animate-spin" />
										) : (
											<Undo2 className="size-3.5" />
										)}
										Undo
									</Button>
								) : (
									<span className="text-[11px] text-muted-foreground">
										Final
									</span>
								)}
							</li>
						);
					})}
				</ul>
			) : null}
			{open ? (
				<SkipDayDialog
					order={order}
					checkIn={checkIn}
					checkOut={checkOut}
					isClosed={storeClosedOn(context.closedWeekdays, context.closedDates)}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</div>
	);
}

/** The first day worth offering: the next skippable day from today, or the
 * plan's first one if it hasn't started (or every later day is spoken for). */
function defaultSkipDay(plan: SkipPlan, checkIn: number, checkOut: number) {
	const today = todayMytMidnight();
	const days: number[] = [];
	for (let day = checkIn; day < checkOut; day += DAY_MS) {
		if (skipDayIssue(plan, day) === null) days.push(day);
	}
	return days.find((day) => day >= today) ?? days.at(-1);
}

function SkipDayDialog({
	order,
	checkIn,
	checkOut,
	isClosed,
	onClose,
}: {
	order: SkipOrder;
	checkIn: number;
	checkOut: number;
	isClosed: (day: number) => boolean;
	onClose: () => void;
}) {
	const skip = useMutation(api.bookings.skipPackageDay);
	const [day, setDay] = useState<number | undefined>(() =>
		defaultSkipDay(order, checkIn, checkOut),
	);
	const [saving, setSaving] = useState(false);
	const [month, setMonth] = useState<Date>(() =>
		calendarDateFromMytEpoch(day ?? checkIn),
	);

	const lastDay = checkOut - DAY_MS;
	// The preview IS the write: the same pure function the mutation runs.
	let preview: { lastDay: number } | { error: string } | null = null;
	if (day !== undefined) {
		try {
			preview = applyCustomerSkip(order, day, isClosed);
		} catch (err) {
			preview = { error: (err as Error).message };
		}
	}
	const customerSkips = new Set(order.bookingCustomerSkips ?? []);
	const name = order.customer.name?.trim() || "The customer";

	async function confirm() {
		if (day === undefined) return;
		setSaving(true);
		try {
			const result = await skip({ orderId: order._id, day });
			if (result.alreadySkipped) {
				toast.info(`${formatFulfilmentDate(day)} was already skipped`);
			} else {
				toast.success(
					`Skipped ${formatFulfilmentDate(day)} — the last day is now ${formatFulfilmentDate(result.lastDay)}`,
				);
			}
			onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog open onOpenChange={(next) => (next ? null : onClose())}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Skip a day</DialogTitle>
					<DialogDescription>
						Pick the day {name} is missing. It stops counting, and the plan runs
						one open day longer. Past days in the plan are fine.
					</DialogDescription>
				</DialogHeader>
				<Calendar
					mode="single"
					selected={
						day === undefined ? undefined : calendarDateFromMytEpoch(day)
					}
					month={month}
					onMonthChange={setMonth}
					startMonth={calendarDateFromMytEpoch(checkIn)}
					endMonth={calendarDateFromMytEpoch(lastDay)}
					className="w-full"
					classNames={TOUCH_CALENDAR_CLASSNAMES}
					styles={TOUCH_CALENDAR_STYLES}
					disabled={(date) =>
						skipDayIssue(order, mytEpochFromCalendarDate(date)) !== null
					}
					onSelect={(date) => {
						if (date) setDay(mytEpochFromCalendarDate(date));
					}}
					modifiers={{
						skipped: (date) =>
							customerSkips.has(mytEpochFromCalendarDate(date)),
					}}
					modifiersClassNames={{
						selected:
							"!bg-primary !text-primary-foreground hover:!bg-primary font-semibold !rounded-lg",
						// On the BUTTON: a cell's text-decoration never reaches the
						// inline-block button inside it (seen rendered, 21 Oct).
						skipped: "[&>button]:line-through [&>button]:decoration-2",
					}}
				/>
				<p className="text-[11px] leading-snug text-muted-foreground">
					Greyed out: days outside the plan ({formatNight(checkIn)} –{" "}
					{formatNight(lastDay)}), days you're closed, and days already skipped
					(struck through).
				</p>
				{preview && "error" in preview ? (
					<p
						role="alert"
						className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
					>
						{preview.error}
					</p>
				) : preview ? (
					<p className="rounded-xl bg-muted px-3 py-2 text-sm">
						The last day moves from{" "}
						<span className="font-semibold">{formatNight(lastDay)}</span> to{" "}
						<span className="font-semibold">
							{formatNight(preview.lastDay)}
						</span>
						. Price and start date stay the same.
					</p>
				) : null}
				<p className="text-xs text-muted-foreground">
					Only your latest skip can be undone. No WhatsApp is sent —{" "}
					{name === "The customer" ? "the customer" : name} sees it on their
					order page.
				</p>
				<DialogFooter>
					<Button variant="outline" className="h-11" onClick={onClose}>
						Cancel
					</Button>
					<Button
						className="h-11"
						disabled={
							saving ||
							day === undefined ||
							preview === null ||
							"error" in preview
						}
						onClick={confirm}
					>
						{saving ? <Loader2 className="size-4 animate-spin" /> : null}
						{day === undefined ? "Pick a day" : `Skip ${formatNight(day)}`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
