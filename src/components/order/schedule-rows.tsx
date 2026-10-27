// The Orders → Schedule rows (`z8r3fdjv0d`): one row per (date, listing),
// grouped under its date. Presentational — the route fetches, this renders —
// so every state is testable without a backend.
//
// Mobile is a card per row under a date heading; desktop is one table. Both
// read the same `ScheduleRow` through the same chip helper, so the two layouts
// can't describe one row two ways.

import { Link } from "@tanstack/react-router";
import { ArrowRight, Users } from "lucide-react";
import {
	DAY_MS,
	formatFulfilmentDate,
	formatFulfilmentTime,
} from "../../../convex/lib/fulfilmentDate";
import type { ScheduleRow } from "../../../convex/lib/scheduleRows";
import { TONE_CHIP } from "../../lib/tone";
import { cn } from "../../lib/utils";

/** One date and the rows on it. */
export type ScheduleDay = { date: number; rows: ScheduleRow[] };

/** Group rows (already date-sorted by the server) under their date. */
export function groupByDate(rows: readonly ScheduleRow[]): ScheduleDay[] {
	const days: ScheduleDay[] = [];
	for (const row of rows) {
		const last = days[days.length - 1];
		if (last && last.date === row.date) last.rows.push(row);
		else days.push({ date: row.date, rows: [row] });
	}
	return days;
}

/** A row is past once its LAST day is behind today — so a two-day seminar on
 * its second morning is still upcoming, which is when the seller needs it. */
export function isPastRow(row: ScheduleRow, todayMyt: number): boolean {
	return (row.endDate ?? row.date) < todayMyt;
}

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`;

/** "Thu, 13 Nov" — with "Today" / "Tomorrow" up front when it is. A
 * multi-day event's span is on its row (`rowMeta`), not the heading: two
 * listings can share a start day and end on different ones.
 *
 * In the UPCOMING list a date before today can only be a multi-day event that
 * is still running (`isPastRow` sent everything else to the past section), so
 * it leads with "On now" — the seminar's second morning is exactly when the
 * seller opens this, and a heading reading like yesterday would bury it. */
export function dayHeading(
	date: number,
	todayMyt: number,
	past = false,
): string {
	const diff = Math.round((date - todayMyt) / DAY_MS);
	const lead =
		diff === 0
			? "Today · "
			: diff === 1
				? "Tomorrow · "
				: diff < 0 && !past
					? "On now · started "
					: "";
	return `${lead}${formatFulfilmentDate(date, { year: false })}`;
}

/** The unit a row counts in, in the seller's words. */
const unit = (row: ScheduleRow) => (row.kind === "event" ? "seat" : "booking");

type Chip = { key: string; label: string; className: string };

/**
 * The count chips, in reading order: capacity, registered, then the payment
 * split. Every registered unit is in exactly one chip after "registered"
 * (see `lib/scheduleRows.ts`), so the chips add up and never contradict.
 *
 * Paid shows even at zero once anything is payable — "0 paid" five days out is
 * the whole reason to open this screen. Claimed and Unpaid show only when
 * non-zero, so an all-paid row reads as calm as it is.
 */
export function scheduleChips(row: ScheduleRow): Chip[] {
	const chips: Chip[] = [];
	if (row.kind === "event") {
		// The CAPACITY, not a second copy of the count: "46 registered" sits
		// right beside it, and "46/50 seats" said 46 twice. Full is the one
		// capacity fact worth a word of its own.
		chips.push({
			key: "seats",
			label:
				row.seats === undefined
					? "No seat cap"
					: row.registered >= row.seats
						? `Full · ${row.seats} seats`
						: `${row.seats} seats`,
			// Navy: a fact about the listing, not a payment state.
			className: "bg-segment text-segment-foreground",
		});
	}
	chips.push({
		key: "registered",
		label:
			row.kind === "event"
				? `${row.registered} registered`
				: plural(row.registered, "booking"),
		className: TONE_CHIP.neutral,
	});
	const payable = row.paid + row.claimed + row.unpaid;
	if (payable > 0) {
		chips.push({
			key: "paid",
			label: `${row.paid} paid`,
			className: "bg-accent/15 text-accent-emphasis",
		});
	}
	if (row.claimed > 0) {
		chips.push({
			key: "claimed",
			label: `${row.claimed} claimed`,
			className: TONE_CHIP.info,
		});
	}
	if (row.unpaid > 0) {
		chips.push({
			key: "unpaid",
			label: `${row.unpaid} unpaid`,
			className: TONE_CHIP.warn,
		});
	}
	if (row.free > 0) {
		chips.push({
			key: "free",
			label: payable > 0 ? `${row.free} free` : "Free",
			className: TONE_CHIP.neutral,
		});
	}
	return chips;
}

/** The states a chip can't carry, as one muted sentence each: a request not
 * yet approved has had no payment asked for, and an order waiting on credits
 * can't be opened yet. Said in place so the chips' arithmetic is never a
 * mystery. */
export function scheduleNotes(row: ScheduleRow): string[] {
	const notes: string[] = [];
	if (row.awaitingApproval > 0)
		notes.push(
			`${plural(row.awaitingApproval, unit(row))} awaiting your approval — no payment asked yet`,
		);
	if (row.waitingOnCredits > 0)
		notes.push(
			`${plural(row.waitingOnCredits, unit(row))} waiting on credits — top up to open`,
		);
	return notes;
}

/** The inbox, narrowed to exactly this row's orders. */
function ordersLinkProps(row: ScheduleRow) {
	return {
		to: "/app/orders" as const,
		search: { listing: row.productId, ffrom: row.date, fto: row.date },
	};
}

function OrdersAction({
	row,
	compact,
}: {
	row: ScheduleRow;
	compact?: boolean;
}) {
	if (row.orders === 0) {
		// Not a dead "Open 0 orders": say why there is nothing behind the row.
		return (
			<span className="px-2 text-xs text-muted-foreground">
				{row.waitingOnCredits > 0
					? "Nothing to open yet"
					: row.kind === "event"
						? "No one registered yet"
						: "No bookings yet"}
			</span>
		);
	}
	return (
		<Link
			{...ordersLinkProps(row)}
			className={cn(
				"inline-flex items-center gap-1 rounded-lg font-semibold text-accent-emphasis transition-colors hover:bg-accent/10",
				compact ? "h-9 px-2 text-sm" : "tap-target px-2 text-sm",
			)}
		>
			Open {plural(row.orders, "order")}
			<ArrowRight className="size-4" aria-hidden="true" />
		</Link>
	);
}

function HeadcountAction({
	row,
	compact,
}: {
	row: ScheduleRow;
	compact?: boolean;
}) {
	return (
		<Link
			to="/app/products/$productId"
			params={{ productId: row.productId }}
			className={cn(
				"inline-flex items-center gap-1 rounded-lg font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
				compact ? "h-9 px-2 text-sm" : "tap-target px-2 text-sm",
			)}
		>
			<Users className="size-4" aria-hidden="true" />
			Headcount
		</Link>
	);
}

function Chips({ row }: { row: ScheduleRow }) {
	return (
		<span className="flex flex-wrap items-center gap-1.5">
			{scheduleChips(row).map((c) => (
				<span
					key={c.key}
					className={cn(
						"rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums",
						c.className,
					)}
				>
					{c.label}
				</span>
			))}
		</span>
	);
}

function Notes({ row }: { row: ScheduleRow }) {
	const notes = scheduleNotes(row);
	if (notes.length === 0) return null;
	return (
		<ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
			{notes.map((n) => (
				<li key={n}>{n}</li>
			))}
		</ul>
	);
}

/** "12:00 PM · Event" — the line under the listing name. */
function rowMeta(row: ScheduleRow): string {
	const parts: string[] = [];
	if (row.timeMinutes !== undefined)
		parts.push(formatFulfilmentTime(row.timeMinutes));
	parts.push(row.kind === "event" ? "Event" : "Check-in");
	if (row.endDate !== undefined && row.endDate !== row.date)
		parts.push(`until ${formatFulfilmentDate(row.endDate, { year: false })}`);
	return parts.join(" · ");
}

/**
 * The rows, grouped by date. `canSeeHeadcount` hides the Headcount link for a
 * teammate without the products area, whose tap would only be refused.
 */
export function ScheduleRows({
	rows,
	todayMyt,
	canSeeHeadcount,
	past = false,
}: {
	rows: readonly ScheduleRow[];
	todayMyt: number;
	canSeeHeadcount: boolean;
	/** The past section: same layout, quieter, so the eye stays on what's
	 * coming — and no "On now" heading. */
	past?: boolean;
}) {
	const days = groupByDate(rows);
	return (
		<>
			{/* Mobile — a card per row, under its date. */}
			<div
				className={cn("flex flex-col gap-5 lg:hidden", past && "opacity-80")}
			>
				{days.map((day) => (
					<section key={day.date} className="flex flex-col gap-2">
						<h3 className="px-1 font-heading text-sm font-bold text-muted-foreground">
							{dayHeading(day.date, todayMyt, past)}
						</h3>
						{day.rows.map((row) => (
							<article
								key={row.key}
								className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4"
							>
								<div className="min-w-0">
									<p className="line-clamp-2 font-semibold">{row.name}</p>
									<p className="text-xs text-muted-foreground">
										{rowMeta(row)}
									</p>
								</div>
								<Chips row={row} />
								<Notes row={row} />
								<div className="-mx-2 -mb-2 flex items-center justify-between gap-2 border-t border-border pt-1">
									<OrdersAction row={row} />
									{row.kind === "event" && canSeeHeadcount ? (
										<HeadcountAction row={row} />
									) : null}
								</div>
							</article>
						))}
					</section>
				))}
			</div>

			{/* Desktop — one table, each date a header row over its listings: the
			    same grouping as the cards, and it gives the chips the width a
			    date column would have taken (at a 13" dashboard width they
			    wrapped to three lines beside one). */}
			<div
				className={cn(
					"hidden overflow-hidden rounded-2xl border border-border bg-card lg:block",
					past && "opacity-80",
				)}
			>
				<table className="w-full text-sm">
					<thead className="sr-only">
						<tr>
							<th scope="col">Listing</th>
							<th scope="col">Registered and paid</th>
							<th scope="col">Actions</th>
						</tr>
					</thead>
					{days.map((day, d) => (
						<tbody key={day.date}>
							<tr
								className={cn("bg-muted/50", d > 0 && "border-t border-border")}
							>
								<th
									scope="colgroup"
									colSpan={3}
									className="px-4 py-2 text-left font-heading text-xs font-bold text-muted-foreground"
								>
									{dayHeading(day.date, todayMyt, past)}
								</th>
							</tr>
							{day.rows.map((row) => (
								<tr key={row.key} className="border-t border-border align-top">
									<td className="w-[32%] px-4 py-3">
										<p className="line-clamp-2 font-semibold">{row.name}</p>
										<p className="text-xs text-muted-foreground">
											{rowMeta(row)}
										</p>
									</td>
									<td className="px-4 py-3">
										<div className="flex flex-col gap-1.5">
											<Chips row={row} />
											<Notes row={row} />
										</div>
									</td>
									<td className="whitespace-nowrap px-4 py-2">
										<div className="flex items-center justify-end gap-1">
											{row.kind === "event" && canSeeHeadcount ? (
												<HeadcountAction row={row} compact />
											) : null}
											<OrdersAction row={row} compact />
										</div>
									</td>
								</tr>
							))}
						</tbody>
					))}
				</table>
			</div>
		</>
	);
}
