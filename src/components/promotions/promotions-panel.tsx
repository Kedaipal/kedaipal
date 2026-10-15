import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { Lock, Plus, Tag } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	type PromotionPhase,
	promotionPhase,
} from "../../../convex/lib/promotions";
import { useDeadlineClock } from "../../hooks/useDeadlineClock";
import { PHASE_LABEL, windowLine } from "../../lib/promotion-flow";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

/**
 * The "Sale prices" tab of the Promotions home (`z8r3fducfd`): every bulk
 * promotion as ONE row — name, discount, product count, and where it stands
 * (applying / scheduled / live / ended) — grouped by that phase so what's
 * running now is always first.
 *
 * Phases are computed on the client's clock from the row's window
 * (`promotionPhase`, the server's own rule), so a promotion slides from
 * Scheduled to Live to Ended on screen without a cron or a refetch.
 */

type Row = FunctionReturnType<typeof api.promotions.list>["promotions"][number];

const GROUPS: Array<{ title: string; phases: PromotionPhase[] }> = [
	{ title: "Running now", phases: ["applying", "live", "ending"] },
	{ title: "Scheduled", phases: ["scheduled"] },
	{ title: "Ended", phases: ["ended"] },
];

export function PromotionsPanel({
	retailerId,
	newBlockedReason,
	showReasonNote,
}: {
	retailerId: Id<"retailers">;
	/** Why "New promotion" is off, or null. */
	newBlockedReason: string | null;
	/** False when the page already states the reason (the view-only banner). */
	showReasonNote: boolean;
}) {
	const data = useQuery(convexQuery(api.promotions.list, { retailerId })).data;
	const rows = data?.promotions;
	// Ticks only while something has a deadline to watch.
	const deadlines = (rows ?? [])
		.filter((r) => r.endedAt === undefined)
		.flatMap((r) => [r.startsAt, r.endsAt])
		.filter((t): t is number => t !== undefined);
	const now = useDeadlineClock(deadlines);

	const newButton = (
		<Button
			asChild={newBlockedReason === null}
			className="tap-target gap-1.5"
			disabled={newBlockedReason !== null}
		>
			{newBlockedReason === null ? (
				<Link to="/app/promotions/new">
					<Plus className="size-4" aria-hidden />
					New promotion
				</Link>
			) : (
				<span>
					<Plus className="size-4" aria-hidden />
					New promotion
				</span>
			)}
		</Button>
	);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start justify-between gap-3">
				<p className="text-[13px] text-muted-foreground">
					Many products on one sale price, edited and ended as one. A single
					product's sale is still set in its own form.
				</p>
				<div className="shrink-0">{newButton}</div>
			</div>

			{newBlockedReason !== null && showReasonNote ? (
				<div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 p-3 text-muted-foreground">
					<Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<p className="text-xs leading-relaxed">{newBlockedReason}</p>
				</div>
			) : null}

			{data?.pausedByPlan && rows && rows.length > 0 ? (
				<p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
					Promotions are part of the Pro plan, so these are paused — your
					storefront is selling at normal prices. You can still end them.
				</p>
			) : null}

			{rows === undefined ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-24 rounded-2xl" />
					<Skeleton className="h-24 rounded-2xl" />
				</div>
			) : rows.length === 0 ? (
				<EmptyState />
			) : (
				GROUPS.map((group) => {
					const inGroup = rows
						.map((row) => ({ row, phase: promotionPhase(row, row.queue, now) }))
						.filter(({ phase }) => group.phases.includes(phase));
					if (inGroup.length === 0) return null;
					return (
						<section key={group.title} className="flex flex-col gap-2">
							<h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
								{group.title}
							</h2>
							<ul className="flex flex-col gap-2">
								{inGroup.map(({ row, phase }) => (
									<li key={row._id}>
										<PromotionRow
											row={row}
											phase={phase}
											now={now}
											paused={data?.pausedByPlan ?? false}
										/>
									</li>
								))}
							</ul>
						</section>
					);
				})
			)}
		</div>
	);
}

function PromotionRow({
	row,
	phase,
	now,
	paused,
}: {
	row: Row;
	phase: PromotionPhase;
	now: number;
	paused: boolean;
}) {
	const live = phase === "live" || phase === "applying";
	const ended = phase === "ended";
	return (
		<Link
			to="/app/promotions/$promotionId"
			params={{ promotionId: row._id }}
			className={cn(
				"flex flex-col gap-2.5 rounded-2xl border p-3.5 transition-colors hover:bg-muted/40",
				live && !paused ? "border-2 border-accent/45" : "border-border",
				ended && "bg-muted/30",
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-0.5">
					<span
						className={cn(
							"truncate text-[15px] font-bold",
							ended && "text-muted-foreground",
						)}
					>
						{row.label ?? "Promotion"}
					</span>
					<span className="text-[13px] text-muted-foreground">
						{row.percentOff}% off · {row.productCount}{" "}
						{row.productCount === 1 ? "product" : "products"}
						{phase === "applying" ? " · applying the prices…" : ""}
					</span>
				</div>
				<PhaseBadge phase={phase} paused={paused} />
			</div>
			<div className="flex items-center justify-between gap-3 border-t border-border pt-2.5">
				<span className="text-[13px] font-medium tabular-nums">
					{windowLine(row, phase, now)}
				</span>
				<span className="shrink-0 text-[13px] font-semibold text-accent-emphasis">
					{ended ? "View" : "Manage"}
				</span>
			</div>
		</Link>
	);
}

export function PhaseBadge({
	phase,
	paused,
}: {
	phase: PromotionPhase;
	paused: boolean;
}) {
	const running = phase === "live" || phase === "applying";
	const label = paused && phase !== "ended" ? "Paused" : PHASE_LABEL[phase];
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold",
				running && !paused
					? "bg-accent/12 text-accent-emphasis"
					: phase === "ended"
						? "bg-muted text-muted-foreground"
						: "bg-muted text-foreground",
			)}
		>
			{running && !paused ? (
				<span aria-hidden className="size-2 rounded-full bg-accent" />
			) : null}
			{label}
		</span>
	);
}

function EmptyState() {
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
			<div className="flex size-12 items-center justify-center rounded-2xl bg-accent/12">
				<Tag className="size-5 text-accent-emphasis" aria-hidden />
			</div>
			<div className="max-w-sm">
				<p className="font-medium">Put many products on sale at once</p>
				<p className="mt-1 text-sm text-muted-foreground">
					Pick the products, set one discount and when it runs. Prices snap back
					by themselves when it ends, and you can end it early in one tap — a
					happy hour across your menu, or 30% off a whole category.
				</p>
			</div>
		</div>
	);
}
