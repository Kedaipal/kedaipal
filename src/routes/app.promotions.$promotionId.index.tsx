import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { ChevronLeft, Lock, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { promotionPhase } from "../../convex/lib/promotions";
import { ViewOnlyNote } from "../components/app/view-only-note";
import { PageHeader } from "../components/dashboard/page-header";
import {
	FlowSkeleton,
	PromotionGone,
} from "../components/promotions/promotion-flow";
import { PhaseBadge } from "../components/promotions/promotions-panel";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { useDeadlineClock } from "../hooks/useDeadlineClock";
import { usePromotionGate } from "../hooks/usePromotionGate";
import { useAreaLock } from "../hooks/useStoreLock";
import { convexErrorMessage } from "../lib/format";
import {
	lowestSale,
	saleLineCount,
	timeLeft,
	windowLine,
} from "../lib/promotion-flow";
import { cn } from "../lib/utils";

/**
 * One promotion (`z8r3fducfd`) — where it stands, every product in it, and
 * the three things a seller does to a running sale: change it, add to it,
 * end it. Ended ones keep their history and offer "Run again".
 *
 * Ending and removing are gated by the store lock only, never by Pro: a
 * store that dropped to Starter can always switch a sale off.
 */
export const Route = createFileRoute("/app/promotions/$promotionId/")({
	component: PromotionRoute,
});

function PromotionRoute() {
	const { promotionId } = Route.useParams();
	const retailer = useDashboardRetailer();
	const areaLock = useAreaLock("products");
	const setGate = usePromotionGate();
	const end = useMutation(api.promotions.end);
	const removeProducts = useMutation(api.promotions.removeProducts);
	const addProducts = useMutation(api.promotions.addProducts);
	const [confirmEnd, setConfirmEnd] = useState(false);
	const [removing, setRemoving] = useState<string | null>(null);
	const detail = useQuery(
		convexQuery(api.promotions.get, {
			promotionId: promotionId as Id<"promotions">,
		}),
	).data;
	const deadlines =
		detail && detail.promotion.endedAt === undefined
			? [detail.promotion.startsAt, detail.promotion.endsAt].filter(
					(t): t is number => t !== undefined,
				)
			: [];
	const now = useDeadlineClock(deadlines);

	if (!retailer) return null;
	if (detail === undefined) return <FlowSkeleton />;
	if (detail === null) return <PromotionGone />;

	const { promotion, queue, products, pausedByPlan } = detail;
	const currency = retailer.currency;
	const phase = promotionPhase(promotion, queue, now);
	const ended = phase === "ended" || phase === "ending";
	const name = promotion.label ?? "Promotion";
	const lockReason = areaLock.readOnly ? areaLock.reason : null;

	async function confirmEnding() {
		try {
			await end({ promotionId: promotion._id });
			toast.success(
				`${name} ended — every product is back to its normal price`,
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setConfirmEnd(false);
		}
	}

	// One tap, like End's confirm is not — a single product is cheap to put
	// back, so × is instant and the toast carries an Undo that re-adds it at
	// the prices this promotion gave it. Undo is adding to a promotion, which
	// is Pro: a store that can't set promotions gets the plain toast.
	async function remove(product: (typeof products)[number]) {
		setRemoving(product.productId);
		try {
			await removeProducts({
				promotionId: promotion._id,
				productIds: [product.productId],
			});
			const message = `${product.name} is back to its normal price`;
			if (setGate !== null || product.prices.length === 0) {
				toast.success(message);
				return;
			}
			toast.success(message, {
				action: {
					label: "Undo",
					onClick: () => {
						addProducts({
							promotionId: promotion._id,
							members: [
								{ productId: product.productId, prices: product.prices },
							],
						})
							.then(() => toast.success(`${product.name} is back in ${name}`))
							.catch((err) => toast.error(convexErrorMessage(err)));
					},
				},
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setRemoving(null);
		}
	}

	const countdown =
		phase === "scheduled" && promotion.startsAt !== undefined
			? { label: "Starts in", value: timeLeft(promotion.startsAt - now) }
			: !ended && promotion.endsAt !== undefined
				? { label: "Ends in", value: timeLeft(promotion.endsAt - now) }
				: null;

	return (
		<div className="flex flex-col gap-4 lg:max-w-2xl">
			<PageHeader
				title={name}
				back={{ to: "/app/promotions", label: "Promotions" }}
			/>
			<div className="flex items-center gap-1 lg:hidden">
				<Link
					to="/app/promotions"
					aria-label="Back to promotions"
					className="tap-target -ml-2 flex items-center justify-center rounded-lg hover:bg-muted"
				>
					<ChevronLeft className="size-5" aria-hidden />
				</Link>
				<h1 className="truncate font-heading text-[22px] font-extrabold">
					{name}
				</h1>
				<div className="ml-auto">
					<PhaseBadge phase={phase} paused={pausedByPlan} />
				</div>
			</div>
			<ViewOnlyNote />

			<section className="flex flex-col gap-3 rounded-3xl bg-foreground p-5 text-background dark:text-foreground dark:border dark:border-accent/30 dark:bg-accent/12 dark:text-foreground">
				<div className="flex items-start justify-between gap-3">
					<div className="flex flex-col gap-1">
						<span className="text-[11px] font-bold uppercase tracking-[0.08em] text-background/65 dark:text-foreground/65">
							{countdown?.label ?? (ended ? "Ended" : "Running")}
						</span>
						<span className="font-heading text-3xl font-extrabold tabular-nums text-accent">
							{countdown?.value ?? `${promotion.percentOff}% off`}
						</span>
					</div>
					<div className="hidden lg:block">
						<PhaseBadge phase={phase} paused={pausedByPlan} />
					</div>
				</div>
				<p className="text-[13px] text-background/80 dark:text-foreground/80">
					{promotion.percentOff}% off · {products.length}{" "}
					{products.length === 1 ? "product" : "products"} ·{" "}
					{windowLine(promotion, phase, now, { timeLeft: false })}
					{promotion.unitCap !== undefined
						? ` · first ${promotion.unitCap} units per product`
						: ""}
				</p>
				{phase === "applying" ? (
					<p className="text-xs text-background/70 dark:text-foreground/70">
						Putting the sale price on {queue.pending} more{" "}
						{queue.pending === 1 ? "product" : "products"}… this finishes on its
						own in a few seconds.
					</p>
				) : null}
				{ended ? (
					<Button
						asChild={setGate === null}
						disabled={setGate !== null}
						variant="secondary"
						className="tap-target"
					>
						{setGate === null ? (
							<Link to="/app/promotions/new" search={{ from: promotion._id }}>
								Run again
							</Link>
						) : (
							<span>Run again</span>
						)}
					</Button>
				) : (
					<div className="grid grid-cols-2 gap-2">
						<Button
							asChild={setGate === null}
							disabled={setGate !== null}
							variant="secondary"
							className="tap-target bg-background/12 dark:bg-foreground/12 text-background dark:text-foreground hover:bg-background/20 dark:hover:bg-foreground/20"
						>
							{setGate === null ? (
								<Link
									to="/app/promotions/$promotionId/edit"
									params={{ promotionId: promotion._id }}
								>
									Edit terms
								</Link>
							) : (
								<span>Edit terms</span>
							)}
						</Button>
						<Button
							type="button"
							disabled={lockReason !== null}
							onClick={() => setConfirmEnd(true)}
							className="tap-target bg-background text-destructive hover:bg-background/90 dark:hover:bg-foreground/90"
						>
							End now
						</Button>
					</div>
				)}
			</section>

			{(setGate !== null && !ended) || lockReason ? (
				<div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 p-3 text-muted-foreground">
					<Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<p className="text-xs leading-relaxed">
						{lockReason ??
							`${setGate} You can still end this promotion or take products out of it.`}
					</p>
				</div>
			) : null}
			{pausedByPlan && !ended ? (
				<p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
					Paused — promotions are part of the Pro plan, so your storefront is
					selling these at normal prices.
				</p>
			) : null}

			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-2">
					<h2 className="text-sm font-semibold">
						{products.length} {products.length === 1 ? "product" : "products"}
					</h2>
					{!ended && setGate === null ? (
						<Link
							to="/app/promotions/$promotionId/add"
							params={{ promotionId: promotion._id }}
							className="tap-target inline-flex items-center gap-1.5 px-1 text-[13px] font-semibold text-accent-emphasis hover:underline"
						>
							<Plus className="size-4" aria-hidden />
							Add products
						</Link>
					) : null}
				</div>
				{products.length === 0 ? (
					<p className="rounded-2xl border border-dashed border-border px-5 py-6 text-center text-sm text-muted-foreground">
						{ended
							? "None of the products it ran on are in your catalogue any more."
							: "No products left in this promotion. Add some, or end it."}
					</p>
				) : (
					<ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border">
						{products.map((p) => {
							const sale = lowestSale(p.variants, currency);
							const count = saleLineCount(p.variants);
							return (
								<li
									key={p.productId}
									className="flex items-center gap-2 py-1 pl-3 pr-1"
								>
									<Link
										to="/app/products/$productId"
										params={{ productId: p.productId }}
										className="flex min-h-14 min-w-0 flex-1 flex-col justify-center gap-0.5 py-1.5"
									>
										<span className="truncate text-sm font-semibold">
											{p.name}
										</span>
										<span className="text-xs text-muted-foreground">
											{ended ? (
												"Back at its normal price"
											) : !p.ours && p.state === "applied" ? (
												<span className="text-amber-700 dark:text-amber-400">
													Re-priced by hand since — ending won't touch it
												</span>
											) : sale ? (
												<>
													{count.priced > 1 ? "from " : ""}
													<b className="text-accent-emphasis">{sale.sale}</b>{" "}
													<span className="line-through">{sale.list}</span>
													{count.onSale < count.priced
														? ` · ${count.onSale} of ${count.priced} lines on sale`
														: ""}
												</>
											) : p.state === "pending" ? (
												"Applying…"
											) : (
												"No line on sale"
											)}
										</span>
									</Link>
									{!ended ? (
										<button
											type="button"
											onClick={() => remove(p)}
											disabled={lockReason !== null || removing === p.productId}
											aria-label={`Take ${p.name} out of ${name}`}
											className={cn(
												"tap-target flex shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50",
											)}
										>
											<X className="size-4" aria-hidden />
										</button>
									) : null}
								</li>
							);
						})}
					</ul>
				)}
				{!ended ? (
					<p className="text-xs text-muted-foreground">
						Ending puts every product back to its normal price straight away.
						Orders already placed keep the price they were placed at. Taking one
						product out (×) does the same for just that product, and can be
						undone straight after.
					</p>
				) : null}
			</section>

			<ConfirmDialog
				open={confirmEnd}
				onOpenChange={setConfirmEnd}
				title={`End ${name} now?`}
				description={`All ${products.length} products go back to their normal price straight away. Orders already placed keep the price they were placed at, and the promotion stays here with its history so you can run it again.`}
				confirmLabel="End it now"
				destructive
				onConfirm={confirmEnding}
			/>
		</div>
	);
}
