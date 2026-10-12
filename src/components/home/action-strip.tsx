import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Banknote, Bell, CalendarCheck } from "lucide-react";
import { formatPriceCompact } from "../../lib/format";
import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";

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
				search={{ statuses: ["pending"] as const }}
			/>
			<Cell
				icon={CalendarCheck}
				tone="accent"
				loading={loading}
				value={String(dueTodayCount)}
				label="Due today"
				sub={paused ? "updates paused" : "to prepare"}
				to="/app/orders"
				search={{ fwin: "today" as const }}
			/>
			<Cell
				icon={Banknote}
				tone="plain"
				loading={loading}
				value={formatPriceCompact(unpaidAmount, currency)}
				valueTitle={String(unpaidAmount / 100)}
				label="To collect"
				sub={`${unpaidCount} unpaid`}
				to="/app/orders"
				search={{ payment: "unpaid" as const }}
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
