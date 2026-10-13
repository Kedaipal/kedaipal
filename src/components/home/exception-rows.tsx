import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, Clock, PackageX } from "lucide-react";

import { STALE_UNPAID_DAYS } from "../../../convex/lib/orderBuckets";
import { staleUnpaidRow } from "../../lib/home-copy";
import { cn } from "../../lib/utils";

/**
 * "Wed 30 Sep" — weekday and date, no year.
 *
 * A stale order is at most a few weeks old by definition, so the year is four
 * characters that never vary and push the money off the line. MYT, like every
 * other date the dashboard prints.
 */
function shortDayLabel(epoch: number): string {
	return new Date(epoch).toLocaleDateString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
		timeZone: "Asia/Kuala_Lumpur",
	});
}

/**
 * The things the strip above cannot say (z8r3fdrgzj decision 4).
 *
 * "Needs attention" used to repeat the strip's own counts back at the seller in
 * list form — the same three numbers, twice on one screen. These are EXCEPTIONS
 * only: a count the strip shows is never repeated here, and a row appears only
 * when something is actually wrong. No rows is the normal state, and the
 * section disappears entirely rather than saying "nothing to see".
 */
export function ExceptionRows({
	staleUnpaid,
	outOfStock,
	currency,
}: {
	staleUnpaid: {
		count: number;
		amount: number;
		oldestAt: number;
	};
	outOfStock: number;
	currency: string;
}) {
	// The instant the count was taken from, so the list the row opens holds the
	// same orders the row counted. Floored to the minute: unrounded, every render
	// produced a different `to` and so a different href for the same row, which
	// is churn the seller can't see and a link that can't be compared.
	const staleBefore =
		Math.floor(Date.now() / 60_000) * 60_000 -
		STALE_UNPAID_DAYS * 24 * 60 * 60 * 1000;
	const stale = staleUnpaidRow({
		count: staleUnpaid.count,
		amount: staleUnpaid.amount,
		currency,
		staleDays: STALE_UNPAID_DAYS,
		oldestLabel:
			staleUnpaid.oldestAt > 0 ? shortDayLabel(staleUnpaid.oldestAt) : null,
	});
	if (!stale && outOfStock === 0) return null;

	return (
		<section aria-label="Needs a look" className="flex flex-col gap-2">
			{stale ? (
				<Row
					icon={Clock}
					tone="amber"
					title={stale.title}
					detail={stale.detail}
					to="/app/orders"
					// Exactly `isStaleUnpaid`: OPEN (`bucket`), not-received (`pay`),
					// placed before the staleness cutoff (`to`, which bounds
					// `createdAt`). T2 guessed this would need a new `stale=1` param —
					// it does not, because the inbox's own date bound already asks the
					// question.
					//
					// `bucket` is load-bearing and shipped missing (PR #358 review):
					// `isStaleUnpaid` is a strict subset of `isOpenUnpaid`, so without
					// it a delivered or cancelled order still carrying an unpaid status
					// joined the list — the same defect this PR fixed for "To collect".
					search={{
						bucket: ["new", "in_progress"] as const,
						pay: ["unpaid", "claimed"] as const,
						to: staleBefore,
					}}
				/>
			) : null}
			{outOfStock > 0 ? (
				<Row
					icon={PackageX}
					tone="plain"
					title={`${outOfStock} product${outOfStock === 1 ? " is" : "s are"} out of stock`}
					detail="Buyers can't order these right now"
					to="/app/products"
					search={{ stock: "out" as const }}
				/>
			) : null}
		</section>
	);
}

const TONE = {
	amber: {
		frame: "border-amber-200 bg-amber-50",
		tile: "bg-amber-100 text-amber-800",
	},
	plain: {
		frame: "border-border bg-card",
		tile: "bg-muted text-muted-foreground",
	},
} as const;

function Row({
	icon: Icon,
	tone,
	title,
	detail,
	to,
	search,
}: {
	icon: LucideIcon;
	tone: keyof typeof TONE;
	title: string;
	detail: string;
	to: string;
	search: Record<string, unknown>;
}) {
	const t = TONE[tone];
	return (
		<Link
			to={to}
			search={search}
			className={cn(
				"flex min-h-11 items-center gap-2.5 rounded-2xl border px-3 py-2.5 transition-opacity hover:opacity-90",
				t.frame,
			)}
		>
			<span
				className={cn(
					"flex size-8 shrink-0 items-center justify-center rounded-xl",
					t.tile,
				)}
			>
				<Icon className="size-4" aria-hidden="true" />
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-[13px] font-semibold">{title}</span>
				<span className="truncate text-[11px] text-muted-foreground">
					{detail}
				</span>
			</span>
			<ChevronRight
				className="size-4 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
		</Link>
	);
}
