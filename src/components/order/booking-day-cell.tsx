// One day of the seller's month grid.
//
// The old cell was a 56px box with a day number and, at most, a count pill —
// stretched across a 1400px desktop grid it was a wall of empty rectangles,
// which is the opposite of what a calendar is for. This one answers "who is
// booked, and is there room" without a tap:
//
//   desktop  guest name chips (up to 3, then "+N more") — there is room, so
//            use it; seeing WHO is the job.
//   phone    an occupancy BAR — 44px of width has no room for names, and a
//            bar reads full/half/empty at a glance better than "3/5" does.
//
// Full and blocked are different states and look different: full is the
// listing selling out (navy, earned), blocked is the seller's own doing
// (hatched, with the reason they typed).

import { Ban } from "lucide-react";
import { calendarDateFromMytEpoch } from "../../lib/booking-dates";
import { cn } from "../../lib/utils";

export type DayCellInfo = {
	booked: number;
	blocked: boolean;
	guests: Array<{ shortId: string; name: string }>;
};

/** Deterministic avatar tint, so the same guest keeps the same colour down a
 * column. Semantic tokens only — these are UI chrome, not brand identity. */
const AVATAR_TINTS = [
	"bg-primary",
	"bg-accent-emphasis",
	"bg-muted-foreground",
] as const;

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function BookingDayCell({
	date,
	info,
	capacity,
	isToday,
	isPast,
	inBlockSelection,
	blockNote,
	onClick,
}: {
	date: number;
	info: DayCellInfo | undefined;
	/** Undefined = unlimited, or an all-listings view where summing capacity
	 * across different products would be fake math. */
	capacity?: number;
	isToday: boolean;
	isPast: boolean;
	inBlockSelection: boolean;
	/** The seller's own note on the block covering this day, if any. */
	blockNote?: string;
	onClick: () => void;
}) {
	const booked = info?.booked ?? 0;
	const blocked = info?.blocked === true;
	const full = capacity !== undefined && booked >= capacity;
	const guests = info?.guests ?? [];
	const overflow = booked - guests.length;
	const fillPct =
		capacity === undefined
			? booked > 0
				? 100
				: 0
			: Math.min(100, Math.round((booked / Math.max(1, capacity)) * 100));

	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={`${calendarDateFromMytEpoch(date).getDate()} — ${
				blocked
					? "blocked"
					: booked === 0
						? "no bookings"
						: `${booked} booking${booked === 1 ? "" : "s"}`
			}`}
			className={cn(
				"relative flex min-h-16 flex-col rounded-xl border p-1.5 text-left transition-colors lg:min-h-[7.25rem] lg:p-2",
				blocked
					? // `var(--muted)`, NOT `hsl(var(--muted))`. This project's tokens are
					// already complete `hsl(...)` values, so wrapping them again yields
					// `hsl(hsl(210 40% 96%))` — invalid, which drops the WHOLE gradient
					// and computes to `background-image: none`. The S4 cell carried the
					// same double-wrap with a flat `bg-muted/60` beside it, so the
					// stripes never rendered and the flat fill hid it. Verified against
					// the running stylesheet, not by eye.
					"border-border bg-[repeating-linear-gradient(135deg,var(--muted)_0_6px,var(--card)_6px_12px)]"
					: full
						? "border-foreground/20 bg-muted/50"
						: "border-border bg-card hover:border-accent/60",
				isPast && "opacity-50",
				isToday && !inBlockSelection && "border-accent ring-3 ring-accent/15",
				inBlockSelection && "!border-primary bg-primary/8 ring-2 ring-primary",
			)}
		>
			<span className="flex items-center justify-between gap-1">
				<span
					className={cn(
						"text-[11px] font-bold tabular-nums lg:text-xs",
						isToday ? "text-accent-emphasis" : "text-foreground",
						blocked && "text-muted-foreground",
					)}
				>
					{calendarDateFromMytEpoch(date).getDate()}
					{isToday ? <span className="hidden lg:inline"> · Today</span> : null}
				</span>
				{blocked ? (
					<Ban className="size-3 text-muted-foreground" aria-hidden />
				) : booked > 0 ? (
					<span
						className={cn(
							"hidden rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums lg:inline",
							full
								? "bg-primary text-primary-foreground"
								: "bg-accent/10 text-accent-emphasis",
						)}
					>
						{capacity !== undefined ? `${booked}/${capacity}` : booked}
					</span>
				) : null}
			</span>

			{blocked ? (
				<span className="mt-auto hidden rounded-md border border-border bg-card/90 px-1.5 py-1 lg:block">
					<span className="block text-[10px] font-bold text-muted-foreground">
						Blocked
					</span>
					{blockNote ? (
						<span className="block truncate text-[10px] text-muted-foreground">
							{blockNote}
						</span>
					) : null}
				</span>
			) : (
				<>
					{/* Desktop: who. */}
					<span className="mt-1 hidden flex-col gap-1 lg:flex">
						{guests.map((guest, i) => (
							<span
								key={guest.shortId}
								className="flex items-center gap-1.5 rounded-md bg-muted py-0.5 pl-0.5 pr-1.5"
							>
								<span
									className={cn(
										"flex size-[18px] shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-primary-foreground",
										AVATAR_TINTS[i % AVATAR_TINTS.length],
									)}
								>
									{initials(guest.name)}
								</span>
								<span className="min-w-0 truncate text-[11px] font-medium">
									{guest.name}
								</span>
							</span>
						))}
						{overflow > 0 ? (
							<span className="pl-1 text-[10px] font-semibold text-muted-foreground">
								{full ? "Full · " : ""}+{overflow} more
							</span>
						) : full ? (
							<span className="pl-1 text-[10px] font-bold">Full</span>
						) : null}
					</span>
					{/* Phone: how full. */}
					{booked > 0 ? (
						<span className="mt-auto block h-1 w-full overflow-hidden rounded-full bg-muted lg:hidden">
							<span
								className={cn(
									"block h-full rounded-full",
									full ? "bg-primary" : "bg-accent",
								)}
								style={{ width: `${Math.max(12, fillPct)}%` }}
							/>
						</span>
					) : null}
				</>
			)}
		</button>
	);
}
