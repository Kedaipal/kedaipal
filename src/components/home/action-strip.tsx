import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Banknote, Bell, CalendarCheck } from "lucide-react";
import { formatPrice } from "../../lib/format";
import { heroAmount } from "../../lib/home-copy";
import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";

/**
 * The buckets every strip count is computed over: OPEN work.
 *
 * `counts.dueToday` and `counts.unpaid` both start from "is this order still
 * open", so every link must carry it too. Without it, "To collect: 2 unpaid"
 * opened four — the two open ones plus two settled orders that happen to carry
 * an unpaid status. A count and the list it opens have to ask one question.
 */
const OPEN_BUCKETS = ["new", "in_progress"] as const;

/**
 * Everything that is not a walk-in. A counter sale stamps today as its
 * fulfilment date at create, so `counts.dueToday` excludes it; an order with no
 * source recorded reads as "storefront", the same default the count applies.
 */
const NOT_COUNTER = ["storefront", "claim"] as const;

/**
 * The three things that might need the seller right now (z8r3fdrgzj).
 *
 * One strip, and nothing below it repeats a number it already shows — the old
 * Home said the same counts twice, once here and again as "Needs attention"
 * rows. The exception rows underneath now carry only what this cannot say.
 *
 * Each cell is a real link to the list it counts, so a number is always one tap
 * from the orders behind it. The money cell gets more width (`1.3fr`) because
 * "RM 1,240" is simply longer than "6" and should not wrap under its own label.
 */
export function ActionStrip({
	loading,
	newCount,
	dueTodayCount,
	unpaidCount,
	unpaidAmount,
	currency,
	/** When the store is out of credits the cells stay LINKS — the seller must
	 * still be able to reach a buyer — and only the sub-labels change to say
	 * which side is paused (Credits T3.1). */
	paused,
}: {
	loading: boolean;
	newCount: number;
	dueTodayCount: number;
	unpaidCount: number;
	unpaidAmount: number;
	currency: string;
	paused?: boolean;
}) {
	return (
		<section
			aria-label="Needs you today"
			className="grid grid-cols-[1fr_1fr_1.3fr] gap-2"
		>
			<Cell
				icon={Bell}
				tone="amber"
				loading={loading}
				value={String(newCount)}
				label="New orders"
				sub={paused ? "accepting paused" : "to confirm"}
				to="/app/orders"
				// The count is the NEW BUCKET, so the link must be too — `statuses`
				// is not a param this inbox reads (it reads `st` / `bucket`), so the
				// old value was dropped and "2 New orders" opened all 6.
				search={{ bucket: ["new"] as const }}
			/>
			<Cell
				icon={CalendarCheck}
				tone="accent"
				loading={loading}
				value={String(dueTodayCount)}
				label="Due today"
				sub={paused ? "updates paused" : "to prepare"}
				to="/app/orders"
				// Open, non-counter, due today — the three rules `counts.dueToday`
				// is built from, so the chip's number and this list agree.
				search={{
					fwin: "today" as const,
					bucket: OPEN_BUCKETS,
					sources: NOT_COUNTER,
				}}
			/>
			<Cell
				icon={Banknote}
				tone="plain"
				loading={loading}
				// `heroAmount`, not the plain format: at 334px "RM 81.00" clipped to
				// "RM 81…" — the figure the cell exists to show. A whole-ringgit
				// total drops the two decimals that were costing it the fit, and
				// the full-precision number stays in the title.
				value={heroAmount(unpaidAmount, currency)}
				valueTitle={formatPrice(unpaidAmount, currency)}
				label="To collect"
				sub={`${unpaidCount} unpaid`}
				to="/app/orders"
				// "To collect" counts every open order whose money has not arrived —
				// unpaid AND claimed-but-unverified (`isOpenUnpaid`). The param is
				// `pay`, and it takes both, or the list is narrower than its own total.
				search={{ pay: ["unpaid", "claimed"] as const, bucket: OPEN_BUCKETS }}
			/>
		</section>
	);
}

const TONE_TILE = {
	amber: "bg-amber-100 text-amber-800",
	accent: "bg-accent/15 text-accent-emphasis",
	plain: "bg-muted text-muted-foreground",
} as const;

const TONE_VALUE = {
	amber: "text-amber-700",
	accent: "text-foreground",
	plain: "text-foreground",
} as const;

function Cell({
	icon: Icon,
	tone,
	loading,
	value,
	valueTitle,
	label,
	sub,
	to,
	search,
}: {
	icon: LucideIcon;
	tone: keyof typeof TONE_TILE;
	loading: boolean;
	value: string;
	valueTitle?: string;
	label: string;
	sub: string;
	to: string;
	search: Record<string, unknown>;
}) {
	return (
		<Link
			to={to}
			search={search}
			className="flex min-h-[104px] min-w-0 flex-col gap-1.5 rounded-[18px] border border-border bg-card p-3 shadow-[0_1px_2px_rgb(15_23_41/0.04)] transition-colors hover:bg-muted/40"
		>
			<span
				className={cn(
					"flex size-7 shrink-0 items-center justify-center rounded-[9px]",
					TONE_TILE[tone],
				)}
			>
				<Icon className="size-[15px]" aria-hidden="true" />
			</span>
			<span className="flex min-w-0 flex-col gap-px">
				{loading ? (
					<Skeleton className="h-6 w-10" />
				) : (
					<span
						title={valueTitle}
						className={cn(
							"truncate font-heading text-xl font-extrabold leading-tight tabular-nums",
							TONE_VALUE[tone],
						)}
					>
						{value}
					</span>
				)}
				<span className="text-xs font-semibold">{label}</span>
				{/* NOT truncated. "accepting paused" is longer than the cell and was
				    clipping to "accepting pa…" — which hides the one thing the
				    out-of-credits state exists to say. The sub-label is the least
				    important line in the cell, so it wraps instead. */}
				<span className="text-[11px] leading-tight text-muted-foreground">
					{sub}
				</span>
			</span>
		</Link>
	);
}
