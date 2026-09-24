/**
 * Settings → Fulfilment → Closed dates (ClickUp `z8r3fdhpm7`) — the days a
 * store is shut on top of its weekly hours. It sits directly under Opening
 * hours because that is what it is: the schedule's exceptions.
 *
 * Every closure is one immediate write (add / reopen), never part of a draft:
 * there's nothing to "save" alongside it, and the booking calendar's "Mark the
 * store closed" opens the very same sheet (`AddClosedDatesSheet`), so the
 * store has ONE place a closure is written from, whichever door the seller
 * came in by.
 *
 * What it tells the seller, because a closure touches more than the date
 * picker: buyers can't pick those dates, the storefront shows them with the
 * reason, and nothing already placed is moved — the add sheet counts what is
 * already due or booked on those dates BEFORE the seller commits.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { CalendarOff, CalendarPlus } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	type ClosedDateRange,
	closedRangeDays,
	formatClosedRange,
	MAX_CLOSED_LABEL_CHARS,
	MAX_CLOSED_RANGE_DAYS,
	MAX_CLOSED_RANGES,
	upcomingClosures,
} from "../../../convex/lib/closedDates";
import { DAY_MS, todayMytMidnight } from "../../../convex/lib/fulfilmentDate";
import {
	calendarDateFromMytEpoch,
	mytEpochFromCalendarDate,
} from "../../lib/booking-dates";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { Input } from "../ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "../ui/sheet";
import { Card, SectionHeading } from "./settings-primitives";

function dayCount(days: number): string {
	return `${days} day${days === 1 ? "" : "s"}`;
}

/** The re-add an Undo performs. A closure that is already RUNNING began
 * before today, and "today or later" is the add rule — so its undo reopens
 * from today, which is everything the removal actually changed. */
function undoRange(range: ClosedDateRange, today: number): ClosedDateRange {
	return { ...range, startDate: Math.max(range.startDate, today) };
}

export function ClosedDatesCard({
	retailerId,
	closedDates,
}: {
	retailerId: Id<"retailers">;
	closedDates: ClosedDateRange[] | undefined;
}) {
	const add = useMutation(api.closedDates.add);
	const remove = useMutation(api.closedDates.remove);
	const [sheetOpen, setSheetOpen] = useState(false);
	const [reopening, setReopening] = useState<string | null>(null);

	const today = todayMytMidnight(Date.now());
	const closures = upcomingClosures(closedDates);
	const atCap = closures.length >= MAX_CLOSED_RANGES;

	async function reopen(range: ClosedDateRange) {
		const key = `${range.startDate}-${range.endDate}`;
		setReopening(key);
		try {
			await remove({
				retailerId,
				startDate: range.startDate,
				endDate: range.endDate,
			});
			// One tap, like the calendar's Unblock — with an Undo, because a
			// mis-tap here reopens Raya day to orders.
			toast.success(`Reopened ${formatClosedRange(range)}`, {
				action: {
					label: "Undo",
					onClick: () => {
						const back = undoRange(range, todayMytMidnight(Date.now()));
						add({ retailerId, ...back }).catch((err) =>
							toast.error(convexErrorMessage(err)),
						);
					},
				},
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setReopening(null);
		}
	}

	return (
		<Card id="closed-dates">
			<div className="flex items-start justify-between gap-4">
				<SectionHeading
					title="Closed dates"
					description="Days you're shut on top of your weekly hours — Raya, a balik-kampung week, a renovation. Buyers can't pick them for delivery or pickup, and your storefront shows the dates with your reason."
				/>
			</div>

			{closures.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-center">
					<CalendarOff
						className="size-5 text-muted-foreground"
						aria-hidden="true"
					/>
					<p className="text-sm font-semibold">No closed dates</p>
					<p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
						Closing for Raya or a break? Add the dates and buyers can't pick
						them. Orders already placed stay as they are.
					</p>
				</div>
			) : (
				<ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
					{closures.map((range) => {
						const key = `${range.startDate}-${range.endDate}`;
						const running = range.startDate <= today;
						return (
							<li
								key={key}
								className="flex items-center justify-between gap-3 px-4 py-3"
							>
								<div className="flex min-w-0 flex-col gap-0.5">
									<span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
										{formatClosedRange(range)}
										{running ? (
											<span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-emphasis">
												Closed now
											</span>
										) : null}
									</span>
									<span className="text-xs text-muted-foreground">
										{range.label ?? "No reason shown to buyers"} ·{" "}
										{dayCount(closedRangeDays(range))}
									</span>
								</div>
								<Button
									variant="outline"
									className="tap-target shrink-0"
									disabled={reopening === key}
									onClick={() => reopen(range)}
								>
									{reopening === key ? "Reopening…" : "Reopen"}
								</Button>
							</li>
						);
					})}
				</ul>
			)}

			<div className="flex flex-col gap-1.5">
				<Button
					variant="outline"
					className="tap-target w-full lg:w-auto lg:self-start"
					disabled={atCap}
					onClick={() => setSheetOpen(true)}
				>
					<CalendarPlus aria-hidden="true" />
					Add closed dates
				</Button>
				{atCap ? (
					// Disabled with the reason where the seller is clicking.
					<p className="text-xs text-muted-foreground">
						You have {MAX_CLOSED_RANGES} closures lined up — reopen one you no
						longer need to add another.
					</p>
				) : null}
			</div>

			<AddClosedDatesSheet
				retailerId={retailerId}
				open={sheetOpen}
				onOpenChange={setSheetOpen}
				existing={closures}
			/>
		</Card>
	);
}

/**
 * The one place a closure is written from — Settings' card and the booking
 * calendar's "Mark the store closed" both open this sheet. `initialRange`
 * pre-selects the days (the calendar hands over the range the seller was about
 * to block). The form mounts only while open, so every open starts fresh —
 * never with a stale pick or a half-typed reason from last time.
 */
export function AddClosedDatesSheet({
	retailerId,
	open,
	onOpenChange,
	existing,
	initialRange,
	onAdded,
}: {
	retailerId: Id<"retailers">;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Upcoming closures, to say when the pick overlaps one. */
	existing: ReadonlyArray<ClosedDateRange>;
	initialRange?: { startDate: number; endDate: number };
	onAdded?: () => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="sm:max-w-md">
				{open ? (
					<AddClosedDatesForm
						retailerId={retailerId}
						existing={existing}
						initialRange={initialRange}
						onDone={() => {
							onOpenChange(false);
							onAdded?.();
						}}
					/>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function AddClosedDatesForm({
	retailerId,
	existing,
	initialRange,
	onDone,
}: {
	retailerId: Id<"retailers">;
	existing: ReadonlyArray<ClosedDateRange>;
	initialRange?: { startDate: number; endDate: number };
	onDone: () => void;
}) {
	const add = useMutation(api.closedDates.add);
	const today = todayMytMidnight(Date.now());
	const [picked, setPicked] = useState<DateRange | undefined>(
		initialRange
			? {
					from: calendarDateFromMytEpoch(initialRange.startDate),
					to: calendarDateFromMytEpoch(initialRange.endDate),
				}
			: undefined,
	);
	const [label, setLabel] = useState("");
	const [saving, setSaving] = useState(false);

	// A single tap is a one-day closure; the second tap extends it.
	const startDate = picked?.from
		? mytEpochFromCalendarDate(picked.from)
		: undefined;
	const endDate =
		startDate === undefined
			? undefined
			: picked?.to
				? mytEpochFromCalendarDate(picked.to)
				: startDate;
	const range =
		startDate !== undefined && endDate !== undefined
			? { startDate, endDate }
			: null;
	const days = range ? closedRangeDays(range) : 0;

	const impact = useQuery(
		convexQuery(
			api.closedDates.impact,
			range ? { retailerId, ...range } : "skip",
		),
	).data;
	const overlaps = range
		? existing.filter(
				(other) =>
					other.startDate <= range.endDate && other.endDate >= range.startDate,
			)
		: [];
	const trimmed = label.trim();

	async function save() {
		if (!range) return;
		setSaving(true);
		try {
			await add({
				retailerId,
				startDate: range.startDate,
				endDate: range.endDate,
				label: trimmed.length > 0 ? trimmed : undefined,
			});
			toast.success(`Closed ${formatClosedRange(range)}`);
			onDone();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<>
			<SheetHeader>
				<SheetTitle>Add closed dates</SheetTitle>
				<SheetDescription>
					Tap the first closed day, then the last. One tap closes a single day.
				</SheetDescription>
			</SheetHeader>
			<div className="flex justify-center">
				<Calendar
					mode="range"
					selected={picked}
					onSelect={setPicked}
					defaultMonth={picked?.from ?? calendarDateFromMytEpoch(today)}
					max={MAX_CLOSED_RANGE_DAYS}
					disabled={{ before: calendarDateFromMytEpoch(today) }}
					showOutsideDays={false}
				/>
			</div>
			<p className="text-center text-sm font-medium" aria-live="polite">
				{range
					? `${formatClosedRange(range)} · ${dayCount(days)}`
					: "No days picked yet"}
			</p>

			<label className="flex flex-col gap-1.5">
				<span className="text-sm font-medium">
					Reason{" "}
					<span className="font-normal text-muted-foreground">
						(optional — buyers see this)
					</span>
				</span>
				<Input
					variant="field"
					value={label}
					maxLength={MAX_CLOSED_LABEL_CHARS}
					placeholder="e.g. Hari Raya"
					onChange={(event) => setLabel(event.target.value)}
				/>
				<span className="self-end text-[11px] tabular-nums text-muted-foreground">
					{label.length}/{MAX_CLOSED_LABEL_CHARS}
				</span>
			</label>

			{range ? (
				<ImpactLine
					impact={impact}
					overlaps={overlaps}
					endsAfterToday={range.endDate >= today + DAY_MS}
				/>
			) : null}

			<Button
				className="tap-target w-full"
				disabled={!range || saving}
				onClick={save}
			>
				{!range
					? "Pick the dates to close"
					: saving
						? "Closing…"
						: days === 1
							? `Close ${formatClosedRange(range)}`
							: `Close ${dayCount(days)}`}
			</Button>
		</>
	);
}

/** What the closure lands on, stated before saving. Nothing is moved — the
 * line says so, and links the orders so fixing one is a tap away. */
function ImpactLine({
	impact,
	overlaps,
	endsAfterToday,
}: {
	impact:
		| {
				orders: number;
				ordersCapped: boolean;
				bookings: number;
				samples: Array<{
					shortId: string;
					customerName?: string;
					kind: "order" | "booking";
				}>;
		  }
		| undefined;
	overlaps: ReadonlyArray<ClosedDateRange>;
	endsAfterToday: boolean;
}) {
	const parts: string[] = [];
	if (impact) {
		if (impact.orders > 0) {
			parts.push(
				`${impact.orders}${impact.ordersCapped ? "+" : ""} order${impact.orders === 1 ? " is" : "s are"} due`,
			);
		}
		if (impact.bookings > 0) {
			parts.push(
				`${impact.bookings} booking${impact.bookings === 1 ? " runs" : "s run"} through them`,
			);
		}
	}
	return (
		<div className="flex flex-col gap-2 rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed text-muted-foreground">
			{impact === undefined ? (
				<p>Checking what's already on these dates…</p>
			) : parts.length === 0 ? (
				<p>
					Nothing is due or booked on these dates.{" "}
					{endsAfterToday
						? "Buyers won't be able to pick them from now on."
						: "Buyers won't be able to pick today."}
				</p>
			) : (
				<>
					<p>
						<span className="font-semibold text-foreground">
							{parts.join(", and ")} on these dates.
						</span>{" "}
						They stay exactly as they are — open one to reschedule or message
						the buyer if you need to.
					</p>
					<ul className="flex flex-wrap gap-1.5">
						{impact.samples.map((sample) => (
							<li key={sample.shortId}>
								<Link
									to="/app/orders/$shortId"
									params={{ shortId: sample.shortId }}
									className="inline-flex min-h-8 items-center rounded-full border border-border bg-background px-2.5 font-medium text-foreground hover:bg-muted"
								>
									{sample.shortId}
									{sample.customerName ? ` · ${sample.customerName}` : ""}
								</Link>
							</li>
						))}
					</ul>
				</>
			)}
			{overlaps.length > 0 ? (
				<p>
					Overlaps a closure you already have (
					{overlaps.map((other) => formatClosedRange(other)).join("; ")}) —
					that's fine, both count.
				</p>
			) : null}
		</div>
	);
}
