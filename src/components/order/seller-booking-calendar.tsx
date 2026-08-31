// The seller's month-view booking calendar (S4 `86eyn4kdb`; design 86eym0pjg
// §3, cell variant A — count pills). A LENS over the orders: day cells show
// booked counts vs capacity + blocked stripes, tapping a day opens its
// bookings (rows lead to the order), and the calendar's ONE write action is
// block/unblock. Two-tap range selection for blocking — the same interaction
// the buyer calendar uses; drag fights scroll on mobile.

import { convexQuery } from "@convex-dev/react-query";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Ban, CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	DAY_MS,
	formatFulfilmentDate,
	MYT_OFFSET_MS,
	todayMytMidnight,
} from "../../../convex/lib/fulfilmentDate";
import {
	addMytMonths,
	calendarDateFromMytEpoch,
	describeBookingSpan,
	mytMonthStart,
} from "../../lib/booking-dates";
import { convexErrorMessage } from "../../lib/format";
import { cn } from "../../lib/utils";
import { StatusBadge } from "../dashboard/status-badge";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { BookingDayCell, type DayCellInfo } from "./booking-day-cell";
import { BookingListingCards } from "./booking-listing-cards";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Which listing a block is written against — the ONE author, so the impact
 * count the seller reads and the row `blockDays` writes can never disagree.
 * `undefined` = the whole store.
 *
 * A single-listing store is deliberately scoped to that listing rather than
 * store-wide: it's the literal truth of what the seller can see on the
 * calendar, and a store block whose reach silently widens the day they add a
 * second listing is the surprising one.
 */
function blockScopeProductId(
	onlyListingId: Id<"products"> | undefined,
	scope: "store" | "listing",
	listingId: Id<"products"> | "all",
): Id<"products"> | undefined {
	if (onlyListingId !== undefined) return onlyListingId;
	return scope === "listing" && listingId !== "all" ? listingId : undefined;
}

/** Two-letter avatar for a day-sheet row. */
function guestInitials(name?: string): string {
	const parts = (name ?? "Guest").trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "G";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Where THIS night sits in the stay — "arrives today", "night 3 of 7",
 * "leaves tomorrow". The seller is looking at one date; a bare range makes
 * them do the arithmetic themselves.
 */
function nightPosition(
	row: { checkIn: number; checkOut: number },
	date: number,
): string {
	if (row.checkIn === date) return "arrives today";
	const total = Math.round((row.checkOut - row.checkIn) / DAY_MS);
	const nth = Math.round((date - row.checkIn) / DAY_MS) + 1;
	if (date + DAY_MS >= row.checkOut) return "leaves tomorrow";
	return `night ${nth} of ${total}`;
}

/** The named guests on a pending block, with the overflow counted. */
function guestSummary(impact: {
	count: number;
	samples: Array<{ customerName?: string }>;
}): string {
	const names = impact.samples.map((s) => s.customerName?.trim() || "Guest");
	const extra = impact.count - names.length;
	return extra > 0 ? `${names.join(", ")}, +${extra} more` : names.join(", ");
}

/** MYT month title ("September 2026") off the month-start epoch. */
function monthTitle(monthStart: number): string {
	const shifted = new Date(monthStart + MYT_OFFSET_MS);
	return shifted.toLocaleDateString("en-MY", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
}

export function SellerBookingCalendar({
	retailerId,
}: {
	retailerId: Id<"retailers">;
}) {
	const today = todayMytMidnight(Date.now());
	const todayMonth = mytMonthStart(today);
	const [month, setMonth] = useState(todayMonth);
	const [listingId, setListingId] = useState<Id<"products"> | "all">("all");
	const [sheetDate, setSheetDate] = useState<number | null>(null);
	// Two-tap block selection — null = not blocking; {start:null} = armed,
	// waiting for the first tap; {start} = waiting for the end tap;
	// {start,end} = the confirm sheet is up.
	const [blockSel, setBlockSel] = useState<{
		start: number | null;
		end?: number;
	} | null>(null);
	const [blockScope, setBlockScope] = useState<"store" | "listing">("store");
	const [blockNote, setBlockNote] = useState("");
	const [saving, setSaving] = useState(false);

	const blockDays = useMutation(api.bookingBlocks.blockDays);
	const unblock = useMutation(api.bookingBlocks.unblock);

	const windowFrom = month;
	const windowTo = addMytMonths(month, 1);
	// `placeholderData: keepPreviousData` is load-bearing, same as the inbox and
	// the buyer's calendar. Paging the month rewrites the query ARGS, which makes
	// a new TanStack Query key, which makes `data` undefined — and the loading
	// guard below replaces the whole card with a skeleton. Worse, the LISTING
	// CARDS are read off this same query, so the selector above vanished and
	// reappeared too: the seller saw the entire page flash on every month step.
	// (Stepping BACK was already smooth — that month was in the cache.)
	//
	// A stale month costs nothing here, unlike the buyer's calendar: this view
	// is read-only until the seller taps, and a tap opens a day sheet that
	// fetches its own rows.
	const calendarQuery = useQuery({
		...convexQuery(api.bookingBlocks.sellerCalendar, {
			retailerId,
			from: windowFrom,
			to: windowTo,
			productId: listingId === "all" ? undefined : listingId,
		}),
		placeholderData: keepPreviousData,
	});
	const calendar = calendarQuery.data;
	const monthLoading = calendarQuery.isPlaceholderData;
	const dayRows = useQuery(
		convexQuery(
			api.bookingBlocks.dayBookings,
			sheetDate !== null
				? {
						retailerId,
						date: sheetDate,
						productId: listingId === "all" ? undefined : listingId,
					}
				: "skip",
		),
	).data;

	// A single-listing store defaults to that listing so the honest "N/M"
	// denominator shows without a tap (design decision).
	const listings = calendar?.listings ?? [];
	if (listings.length === 1 && listingId === "all") {
		setListingId(listings[0]._id);
	}

	// A single-listing store gets no scope toggle (see the confirm sheet) — the
	// block is written against that listing, and the sheet names it.
	const onlyListing = listings.length === 1 ? listings[0] : undefined;
	const selectedListing =
		listingId === "all" ? undefined : listings.find((l) => l._id === listingId);
	// What the pending block would land on. Asked only once a range is complete
	// and the sheet is up — a bounded scan, not a per-tap read. Sits ABOVE the
	// loading early-return: every hook has to run on every render.
	const impact = useQuery(
		convexQuery(
			api.bookingBlocks.blockImpact,
			blockSel?.end !== undefined && blockSel.start !== null
				? {
						retailerId,
						productId: blockScopeProductId(
							onlyListing?._id,
							blockScope,
							listingId,
						),
						startDate: blockSel.start,
						endDate: blockSel.end,
					}
				: "skip",
		),
	).data;

	const byDate = useMemo(() => {
		const map = new Map<number, DayCellInfo>();
		for (const d of calendar?.days ?? []) {
			map.set(d.date, {
				booked: d.booked,
				blocked: d.blocked,
				guests: d.guests,
			});
		}
		return map;
	}, [calendar?.days]);

	if (!calendar) {
		return <Skeleton className="h-96 w-full rounded-2xl" />;
	}
	const capacity = calendar.capacityPerNight;
	const currency = calendar.currency;
	// Nothing booked and nothing blocked all month — an empty grid on its own
	// looks like a failure to load.
	const monthIsEmpty = calendar.days.every(
		(d) => d.booked === 0 && !d.blocked,
	);
	/** The seller's own note on whichever block covers this day — shown IN the
	 * cell, because a bare ✗ makes them tap to remember why they closed it. */
	function noteForDay(date: number): string | undefined {
		return calendar?.blocks.find(
			(b) => date >= b.startDate && date <= b.endDate && b.note,
		)?.note;
	}

	// Month grid, Monday-start (weekend-led business, same as the buyer side).
	const firstDate = calendarDateFromMytEpoch(month);
	const lead = (firstDate.getDay() + 6) % 7;
	const daysInMonth = Math.round((windowTo - month) / DAY_MS);
	const cells: Array<number | null> = [
		...Array.from({ length: lead }, () => null),
		...Array.from({ length: daysInMonth }, (_, i) => month + i * DAY_MS),
	];
	while (cells.length % 7 !== 0) cells.push(null);

	function tapDay(date: number) {
		if (blockSel !== null && blockSel.end === undefined) {
			if (blockSel.start === null) {
				// First tap of the armed mode picks the start.
				setBlockSel({ start: date });
			} else if (date < blockSel.start) {
				// An earlier tap restarts the range from there.
				setBlockSel({ start: date });
			} else {
				// A later tap (or the start itself, for one day) completes it.
				setBlockSel({ start: blockSel.start, end: date });
			}
			return;
		}
		if (blockSel !== null) return; // confirm sheet is up
		setSheetDate(date);
	}

	async function confirmBlock() {
		if (!blockSel || blockSel.start === null || blockSel.end === undefined)
			return;
		setSaving(true);
		try {
			await blockDays({
				retailerId,
				// Same author as the impact count above — the seller must never be
				// shown "3 bookings on these dates" for one scope and have another
				// written.
				productId: blockScopeProductId(
					listings.length === 1 ? listings[0]._id : undefined,
					blockScope,
					listingId,
				),
				startDate: blockSel.start,
				endDate: blockSel.end,
				note: blockNote.trim().length > 0 ? blockNote.trim() : undefined,
			});
			toast.success(
				"Nights blocked — new requests will see them as unavailable",
			);
			setBlockSel(null);
			setBlockNote("");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	async function handleUnblock(blockId: Id<"bookingBlocks">) {
		try {
			await unblock({ blockId });
			toast.success("Block removed — those nights take requests again");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	const blockDaysCount =
		blockSel?.end !== undefined && blockSel.start !== null
			? Math.round((blockSel.end - blockSel.start) / DAY_MS) + 1
			: 0;
	const sheetBlocks =
		sheetDate !== null
			? calendar.blocks.filter(
					(b) => sheetDate >= b.startDate && sheetDate <= b.endDate,
				)
			: [];

	return (
		<div className="flex flex-col gap-3">
			<BookingListingCards
				listings={listings}
				selected={listingId}
				onSelect={setListingId}
				currency={currency}
			/>

			<div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-3 lg:p-4">
				{/* Nav left, month centred, the ONE write action right — the block
				    button used to sit alone at the bottom of the card, below the
				    legend, where it read as a footnote rather than the thing the
				    calendar is for. */}
				<div className="flex items-center gap-2">
					<div className="flex items-center gap-1.5">
						<button
							type="button"
							aria-label="Previous month"
							onClick={() => setMonth(addMytMonths(month, -1))}
							disabled={month <= addMytMonths(todayMonth, -12)}
							className="tap-target flex items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
						>
							<ChevronLeft className="size-4" />
						</button>
						<button
							type="button"
							aria-label="Next month"
							onClick={() => setMonth(addMytMonths(month, 1))}
							disabled={month >= addMytMonths(todayMonth, 6)}
							className="tap-target flex items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
						>
							<ChevronRight className="size-4" />
						</button>
						{/* Paging six months out and back is four taps without this. */}
						<Button
							variant="outline"
							size="sm"
							className="tap-target hidden lg:inline-flex"
							disabled={month === todayMonth}
							onClick={() => setMonth(todayMonth)}
						>
							Today
						</Button>
					</div>
					<span
						className={cn(
							"flex-1 text-center font-heading text-base font-bold transition-opacity lg:text-lg",
							monthLoading && "opacity-60",
						)}
						aria-busy={monthLoading || undefined}
					>
						{monthTitle(month)}
					</span>
					<div className="flex items-center gap-1.5">
						<Button
							variant="outline"
							size="sm"
							className="tap-target hidden lg:inline-flex"
							onClick={() => setBlockSel({ start: null })}
							disabled={blockSel !== null}
						>
							<Ban className="size-4" aria-hidden />
							Block dates
						</Button>
						{/* The phone keeps its own bottom-anchored button below. */}
						<span className="tap-target lg:hidden" aria-hidden />
					</div>
				</div>

				<div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
					{WEEKDAYS.map((d, i) => (
						// Weekday initials repeat (T/T, S/S) — index keys a fixed list.
						// biome-ignore lint/suspicious/noArrayIndexKey: static 7-item header
						<span key={`${d}-${i}`}>{d}</span>
					))}
				</div>
				<div className="grid grid-cols-7 gap-1 lg:gap-1.5">
					{cells.map((date, i) =>
						date === null ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: filler cells
							<span key={`pad-${i}`} />
						) : (
							<BookingDayCell
								key={date}
								date={date}
								info={byDate.get(date)}
								capacity={capacity}
								isToday={date === today}
								isPast={date < today}
								inBlockSelection={
									blockSel !== null &&
									blockSel.start !== null &&
									date >= blockSel.start &&
									(blockSel.end === undefined
										? date <= blockSel.start
										: date <= blockSel.end)
								}
								blockNote={noteForDay(date)}
								onClick={() => tapDay(date)}
							/>
						),
					)}
				</div>

				{/* Legend — states, named. "Pill = booked / capacity" described a
				    control, not the calendar. */}
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2.5 text-[11px] text-muted-foreground lg:gap-x-5">
					<span className="flex items-center gap-1.5">
						<i
							className="size-3 rounded-full border border-accent/40 bg-accent/10"
							aria-hidden
						/>
						Has room
					</span>
					<span className="flex items-center gap-1.5">
						<i className="size-3 rounded-full bg-primary" aria-hidden />
						Full
					</span>
					<span className="flex items-center gap-1.5">
						<Ban className="size-3" aria-hidden />
						Blocked by you
					</span>
					{capacity === undefined && listings.length > 1 ? (
						<span>Pick a listing above to see how full each night is.</span>
					) : null}
					<span className="hidden flex-1 text-right 2xl:block">
						Buyers only ever see a date as unavailable — never
						&ldquo;blocked&rdquo;.
					</span>
				</div>
			</div>

			{/* The month is empty — say so, and say what fills it. A bare grid of
			    empty boxes reads as broken rather than as "no bookings yet". */}
			{monthIsEmpty ? (
				<div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-5 py-7 text-center">
					<CalendarRange className="size-5 text-muted-foreground" aria-hidden />
					<p className="text-sm font-semibold">
						Nothing booked in {monthTitle(month)}
					</p>
					<p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
						Requests land here as buyers pick their dates. Dates you block show
						up straight away.
					</p>
				</div>
			) : null}

			{/* Block MODE. The old affordance was a thin dashed strip under the
			    grid, easy to miss and easy to forget you were in. This is a real
			    mode: a bar that owns the flow, shows the live range, and always
			    offers the way out. Fixed on the phone (house rule 4), in flow on
			    desktop where the toolbar button sits instead. */}
			{blockSel === null ? (
				<Button
					variant="outline"
					className="tap-target w-full lg:hidden"
					onClick={() => setBlockSel({ start: null })}
				>
					<Ban className="size-4" aria-hidden />
					Block dates
				</Button>
			) : blockSel.end === undefined ? (
				<div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-primary px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 text-primary-foreground lg:static lg:rounded-2xl lg:border lg:border-primary lg:pb-3">
					<div className="mx-auto flex max-w-3xl items-center gap-3">
						<Ban className="size-4 shrink-0" aria-hidden />
						<span className="min-w-0 flex-1 text-xs leading-relaxed">
							{blockSel.start === null ? (
								<span className="font-semibold">
									Tap the first day to block.
								</span>
							) : (
								<>
									<span className="font-semibold">
										From {formatFulfilmentDate(blockSel.start)}
									</span>{" "}
									— tap the last day, or the same day again for just one.
								</>
							)}
						</span>
						<Button
							variant="ghost"
							size="sm"
							className="shrink-0 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
							onClick={() => setBlockSel(null)}
						>
							Cancel
						</Button>
					</div>
				</div>
			) : null}

			{/* Block confirm sheet */}
			<Sheet
				open={blockSel?.end !== undefined}
				onOpenChange={(open) => {
					if (!open) setBlockSel(null);
				}}
			>
				<SheetContent>
					<SheetHeader>
						<SheetTitle>
							Block {formatFulfilmentDate(blockSel?.start ?? today)}
							{blockSel?.end !== undefined && blockSel.end !== blockSel.start
								? ` → ${formatFulfilmentDate(blockSel.end)}`
								: ""}
						</SheetTitle>
					</SheetHeader>
					<div className="flex flex-col gap-3 px-4 pb-4">
						<p className="text-xs leading-relaxed text-muted-foreground">
							{blockDaysCount} day{blockDaysCount === 1 ? "" : "s"}. Blocking
							stops <span className="font-semibold">new</span> requests only —
							bookings already on these nights stay, and buyers just see the
							dates as unavailable (never &ldquo;blocked&rdquo;).
						</p>
						{/* Scope. With a SINGLE booking listing the toggle was noise
						    pretending to be a choice: both options do the same thing today,
						    yet they write different rows that diverge the moment a second
						    listing exists — and "This listing only" never named the listing,
						    because the chip row that would have named it is hidden below two.
						    So: one listing → no toggle, just the name. */}
						{onlyListing ? (
							<p className="text-xs text-muted-foreground">
								Blocks{" "}
								<span className="font-semibold text-foreground">
									{onlyListing.name}
								</span>
								 — your only booking listing.
							</p>
						) : listingId !== "all" ? (
							<div className="flex gap-1 rounded-xl bg-muted p-1">
								<button
									type="button"
									onClick={() => setBlockScope("store")}
									className={cn(
										"flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
										blockScope === "store"
											? "bg-background shadow-sm"
											: "text-muted-foreground",
									)}
								>
									Whole store
								</button>
								<button
									type="button"
									onClick={() => setBlockScope("listing")}
									className={cn(
										"flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
										blockScope === "listing"
											? "bg-background shadow-sm"
											: "text-muted-foreground",
									)}
								>
									{selectedListing?.name ?? "This listing only"}
								</button>
							</div>
						) : (
							<p className="text-xs text-muted-foreground">
								Applies to <span className="font-semibold">all</span>{" "}
								{listings.length} booking listings (pick a listing above to
								block just one).
							</p>
						)}
						{/* What this lands on top of. Stated, never used to refuse: a
						    seller closing for a flood must not be told to cancel their
						    guests first. "Bookings already on these nights stay" is true
						    but leaves them guessing whether that means nobody or forty. */}
						{impact && impact.count > 0 ? (
							<p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-foreground">
								<span className="font-semibold">
									{impact.count} booking{impact.count === 1 ? "" : "s"} already
									on these dates
								</span>{" "}
								({guestSummary(impact)}) — they stay confirmed and the guests
								are told nothing. Cancel any you need to from the order itself.
							</p>
						) : null}
						<input
							value={blockNote}
							onChange={(e) => setBlockNote(e.target.value.slice(0, 200))}
							placeholder="Note for yourself (optional) — e.g. Maintenance"
							className="rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
						/>
						<Button
							className="tap-target w-full"
							variant="secondary"
							isLoading={saving}
							onClick={confirmBlock}
						>
							Block {blockDaysCount} day{blockDaysCount === 1 ? "" : "s"}
						</Button>
					</div>
				</SheetContent>
			</Sheet>

			{/* Day tap-through sheet */}
			<Sheet
				open={sheetDate !== null}
				onOpenChange={(open) => {
					if (!open) setSheetDate(null);
				}}
			>
				<SheetContent>
					<SheetHeader>
						<SheetTitle>
							{sheetDate !== null ? formatFulfilmentDate(sheetDate) : ""}
						</SheetTitle>
					</SheetHeader>
					<div className="flex flex-col gap-3 px-4 pb-4">
						{sheetBlocks.map((block) => (
							<div
								key={block._id}
								className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs"
							>
								<span className="min-w-0">
									<span className="font-semibold">
										Blocked
										{block.productId === undefined
											? " (whole store)"
											: ` — ${listings.find((l) => l._id === block.productId)?.name ?? "one listing"}`}
									</span>
									{block.note ? (
										<span className="block truncate text-muted-foreground">
											{block.note}
										</span>
									) : null}
								</span>
								<Button
									variant="outline"
									size="sm"
									onClick={() => handleUnblock(block._id)}
								>
									Unblock
								</Button>
							</div>
						))}
						{dayRows === undefined ? (
							// Row skeletons, not one slab where the whole list was.
							<div className="flex flex-col gap-3">
								<Skeleton className="h-12 w-full rounded-xl" />
								<Skeleton className="h-12 w-full rounded-xl" />
							</div>
						) : dayRows.length === 0 ? (
							<div className="flex flex-col items-center gap-1.5 py-4 text-center">
								<CalendarRange
									className="size-5 text-muted-foreground"
									aria-hidden
								/>
								<p className="text-sm font-semibold">Nobody booked in yet</p>
								<p className="text-xs leading-relaxed text-muted-foreground">
									This night is open to requests. Block it if you&apos;re not
									taking guests.
								</p>
							</div>
						) : (
							<div className="flex flex-col divide-y divide-border">
								{dayRows.map((row) => (
									<Link
										key={row.shortId}
										to="/app/orders/$shortId"
										params={{ shortId: row.shortId }}
										className="flex items-center gap-3 py-2.5"
									>
										<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
											{guestInitials(row.customerName)}
										</span>
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium">
												{row.customerName ?? "Guest"}
											</p>
											{/* Enough to decide WHICH order to open without
											     opening them all: where in the stay tonight is,
											     and — on an all-listings view — whose plot. */}
											<p className="truncate text-xs text-muted-foreground tabular-nums">
												{describeBookingSpan(row.checkIn, row.checkOut, {
													isPackage: row.packaged,
													format: formatFulfilmentDate,
												})}
												{sheetDate !== null
													? ` · ${nightPosition(row, sheetDate)}`
													: ""}
												{listingId === "all" ? ` · ${row.listingName}` : ""}
											</p>
										</div>
										<div className="flex shrink-0 items-center gap-2">
											{row.paymentStatus !== "received" ? (
												<span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
													Unpaid
												</span>
											) : null}
											<StatusBadge status={row.status} />
											<ChevronRight
												className="size-4 text-muted-foreground"
												aria-hidden
											/>
										</div>
									</Link>
								))}
							</div>
						)}
						{sheetDate !== null && sheetBlocks.length === 0 ? (
							<Button
								variant="outline"
								className="tap-target w-full"
								onClick={() => {
									setBlockSel({ start: sheetDate, end: sheetDate });
									setSheetDate(null);
								}}
							>
								<Ban className="size-4" aria-hidden />
								Block this night
							</Button>
						) : null}
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}
