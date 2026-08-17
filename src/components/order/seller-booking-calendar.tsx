// The seller's month-view booking calendar (S4 `86eyn4kdb`; design 86eym0pjg
// §3, cell variant A — count pills). A LENS over the orders: day cells show
// booked counts vs capacity + blocked stripes, tapping a day opens its
// bookings (rows lead to the order), and the calendar's ONE write action is
// block/unblock. Two-tap range selection for blocking — the same interaction
// the buyer calendar uses; drag fights scroll on mobile.

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Ban, ChevronLeft, ChevronRight } from "lucide-react";
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
	mytMonthStart,
} from "../../lib/booking-dates";
import { convexErrorMessage } from "../../lib/format";
import { cn } from "../../lib/utils";
import { StatusBadge } from "../dashboard/status-badge";
import { Button } from "../ui/button";
import { FilterChip, FilterChipRow } from "../ui/filter-chip";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

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
	const calendar = useQuery(
		convexQuery(api.bookingBlocks.sellerCalendar, {
			retailerId,
			from: windowFrom,
			to: windowTo,
			productId: listingId === "all" ? undefined : listingId,
		}),
	).data;
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

	const byDate = useMemo(() => {
		const map = new Map<number, { booked: number; blocked: boolean }>();
		for (const d of calendar?.days ?? []) {
			map.set(d.date, { booked: d.booked, blocked: d.blocked });
		}
		return map;
	}, [calendar?.days]);

	if (!calendar) {
		return <Skeleton className="h-96 w-full rounded-2xl" />;
	}
	const capacity = calendar.capacityPerNight;

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
				productId:
					blockScope === "listing" && listingId !== "all"
						? listingId
						: undefined,
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
			{listings.length > 1 ? (
				<FilterChipRow>
					{listings.map((listing) => (
						<FilterChip
							key={listing._id}
							selected={listingId === listing._id}
							onClick={() => setListingId(listing._id)}
						>
							{listing.name}
						</FilterChip>
					))}
					<FilterChip
						selected={listingId === "all"}
						onClick={() => setListingId("all")}
					>
						All listings
					</FilterChip>
				</FilterChipRow>
			) : null}

			<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
				<div className="flex items-center justify-between">
					<button
						type="button"
						aria-label="Previous month"
						onClick={() => setMonth(addMytMonths(month, -1))}
						disabled={month <= addMytMonths(todayMonth, -12)}
						className="tap-target flex items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
					>
						<ChevronLeft className="size-4" />
					</button>
					<span className="font-heading text-sm font-bold">
						{monthTitle(month)}
					</span>
					<button
						type="button"
						aria-label="Next month"
						onClick={() => setMonth(addMytMonths(month, 1))}
						disabled={month >= addMytMonths(todayMonth, 6)}
						className="tap-target flex items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
					>
						<ChevronRight className="size-4" />
					</button>
				</div>

				<div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
					{WEEKDAYS.map((d, i) => (
						// Weekday initials repeat (T/T, S/S) — index keys a fixed list.
						// biome-ignore lint/suspicious/noArrayIndexKey: static 7-item header
						<span key={`${d}-${i}`}>{d}</span>
					))}
				</div>
				<div className="grid grid-cols-7 gap-1">
					{cells.map((date, i) =>
						date === null ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: filler cells
							<span key={`pad-${i}`} />
						) : (
							(() => {
								const info = byDate.get(date);
								const inBlockSel =
									blockSel !== null &&
									blockSel.start !== null &&
									date >= blockSel.start &&
									(blockSel.end === undefined
										? date <= blockSel.start
										: date <= blockSel.end);
								const full =
									capacity !== undefined &&
									info !== undefined &&
									info.booked >= capacity;
								return (
									<button
										key={date}
										type="button"
										onClick={() => tapDay(date)}
										className={cn(
											"relative flex min-h-14 flex-col rounded-lg border p-1 text-left transition-colors",
											info?.blocked
												? "border-border bg-[repeating-linear-gradient(135deg,hsl(var(--muted))_0_5px,transparent_5px_10px)] bg-muted/60"
												: full
													? "border-primary/30 bg-primary/5"
													: "border-border bg-background hover:border-accent/60",
											date < today && "opacity-50",
											date === today && "ring-1 ring-accent",
											inBlockSel && "!border-primary ring-1 ring-primary",
										)}
									>
										<span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
											{calendarDateFromMytEpoch(date).getDate()}
										</span>
										{info?.blocked ? (
											<Ban
												className="absolute right-1 top-1 size-3 text-muted-foreground"
												aria-hidden
											/>
										) : null}
										{info !== undefined && info.booked > 0 ? (
											<span
												className={cn(
													"mt-auto rounded-md px-1 py-0.5 text-center text-[10px] font-bold tabular-nums",
													full
														? "bg-primary text-primary-foreground"
														: "bg-accent/10 text-accent-emphasis",
												)}
											>
												{capacity !== undefined
													? `${info.booked}/${capacity}`
													: info.booked}
											</span>
										) : null}
									</button>
								);
							})()
						),
					)}
				</div>

				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
					<span>
						{capacity !== undefined
							? "Pill = booked / capacity"
							: "Pill = bookings that night (pick a listing for capacity)"}
					</span>
					<span className="flex items-center gap-1.5">
						<Ban className="size-3" aria-hidden />
						Blocked by you
					</span>
				</div>

				{blockSel === null ? (
					<Button
						variant="outline"
						className="tap-target w-full"
						onClick={() => setBlockSel({ start: null })}
					>
						<Ban className="size-4" aria-hidden />
						Block days…
					</Button>
				) : blockSel.end === undefined ? (
					<div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs">
						<span>
							{blockSel.start === null ? (
								"Tap the first day to block."
							) : (
								<>
									Blocking from{" "}
									<span className="font-semibold">
										{formatFulfilmentDate(blockSel.start)}
									</span>{" "}
									— tap the last day (tap it again for just one day).
								</>
							)}
						</span>
						<Button variant="ghost" size="sm" onClick={() => setBlockSel(null)}>
							Cancel
						</Button>
					</div>
				) : null}
			</div>

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
						{listingId !== "all" ? (
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
									This listing only
								</button>
							</div>
						) : (
							<p className="text-xs text-muted-foreground">
								Applies to the whole store (pick a listing chip first to block
								just one).
							</p>
						)}
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
							<Skeleton className="h-16 w-full rounded-xl" />
						) : dayRows.length === 0 ? (
							<p className="py-2 text-center text-sm text-muted-foreground">
								No bookings on this night.
							</p>
						) : (
							<div className="flex flex-col divide-y divide-border">
								{dayRows.map((row) => (
									<Link
										key={row.shortId}
										to="/app/orders/$shortId"
										params={{ shortId: row.shortId }}
										className="flex items-center gap-3 py-2.5"
									>
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium">
												{row.customerName ?? "Guest"}
											</p>
											<p className="text-xs text-muted-foreground tabular-nums">
												{formatFulfilmentDate(row.checkIn)} →{" "}
												{formatFulfilmentDate(row.checkOut)}
											</p>
										</div>
										<StatusBadge status={row.status} />
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
