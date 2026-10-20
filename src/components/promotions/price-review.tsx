import { useId } from "react";
import { formatPrice } from "../../lib/format";
import {
	type FlowProduct,
	type ReviewSummary,
	reviewLinesFor,
} from "../../lib/promotion-flow";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";

/**
 * Every line's normal → sale price before anything goes live (`z8r3fducfd`).
 *
 * The percent prices every line by the shared 5-sen rule; any line can be
 * typed over (the per-product override) or emptied to keep it at full price.
 * Lines that can't be discounted at all — priced by quote, or too small to
 * take a cut — are NAMED with the reason rather than quietly dropped, and a
 * booking or event listing says it takes the price but not the flash extras.
 */
export function PriceReview({
	products,
	percentOff,
	overrides,
	onOverride,
	currency,
	summary,
	hasFlashExtras,
}: {
	products: readonly FlowProduct[];
	percentOff: number;
	overrides: Readonly<Record<string, string>>;
	onOverride: (variantId: string, value: string) => void;
	currency: string;
	summary: ReviewSummary;
	/** Whether the terms carry a cap / max per order / pay window — only then
	 * is "price only" worth saying on a booking or event. */
	hasFlashExtras: boolean;
}) {
	const fieldId = useId();
	const notOnSale = summary.total - summary.onSale - summary.invalid;
	return (
		<div className="flex flex-col gap-3">
			<p
				className={cn(
					"rounded-xl border px-3 py-2.5 text-xs",
					notOnSale > 0
						? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
						: "border-border bg-muted/40 text-muted-foreground",
				)}
			>
				<b>
					{summary.onSale} of {summary.total}{" "}
					{summary.total === 1 ? "line" : "lines"}
				</b>{" "}
				go on sale.
				{notOnSale > 0
					? ` ${notOnSale} stay${notOnSale === 1 ? "s" : ""} at the normal price — each one says why below.`
					: " Type over any price to change just that line."}
			</p>

			{products.map((product) => {
				const lines = reviewLinesFor(product, percentOff, overrides);
				return (
					<section
						key={product._id}
						className="overflow-hidden rounded-2xl border border-border"
					>
						<div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2.5">
							<h3 className="truncate text-sm font-semibold">{product.name}</h3>
							{product.isBooking || product.isEvent ? (
								<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
									{product.isBooking ? "Booking" : "Event"}
								</span>
							) : null}
						</div>
						<ul className="divide-y divide-border/60">
							{lines.map((line) => {
								const name = line.variant.label || "Price";
								const errorId = `${fieldId}-${line.variant._id}`;
								return (
									<li
										key={line.variant._id}
										className="flex flex-col gap-1 px-3 py-2"
									>
										<div className="flex items-center justify-between gap-3">
											<span className="min-w-0 text-sm">
												<span className="truncate">{name}</span>
												{line.variant.price > 0 ? (
													<span className="ml-2 text-xs text-muted-foreground line-through">
														{formatPrice(line.variant.price, currency)}
													</span>
												) : null}
											</span>
											{line.kind === "skip" ? (
												<span className="shrink-0 text-right text-xs font-semibold text-muted-foreground">
													{line.reason}
												</span>
											) : (
												<Input
													aria-label={`Sale price for ${product.name}${line.variant.label ? `, ${line.variant.label}` : ""}`}
													aria-describedby={line.issue ? errorId : undefined}
													variant="field"
													inputMode="decimal"
													placeholder="Not on sale"
													isError={line.issue !== undefined}
													className={cn(
														"h-11 w-28 text-right",
														line.edited && !line.issue && "border-accent",
													)}
													value={line.input}
													onChange={(e) =>
														onOverride(line.variant._id, e.target.value)
													}
												/>
											)}
										</div>
										{line.kind === "sale" && line.issue ? (
											<p
												id={errorId}
												className="text-right text-xs font-medium text-destructive"
											>
												{line.issue}
											</p>
										) : line.kind === "sale" && line.sen === null ? (
											<p className="text-right text-xs text-muted-foreground">
												Left at the normal price
											</p>
										) : line.kind === "sale" && line.edited ? (
											<p className="text-right text-xs text-accent-emphasis">
												Edited
											</p>
										) : null}
									</li>
								);
							})}
						</ul>
						{(product.isBooking || product.isEvent) && hasFlashExtras ? (
							<p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
								Price only — the flash extras don't apply here,{" "}
								{product.isBooking
									? "capacity already caps a booking."
									: "seats already cap an event."}
							</p>
						) : null}
					</section>
				);
			})}
		</div>
	);
}
