import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Check, EyeOff, FolderOpen } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ProBadge } from "../app/pro-gate";

/** Mirrors MAX_CATEGORIES_PER_PRODUCT in convex/categories.ts. */
const MAX_CATEGORIES = 10;

/**
 * Multi-select list of a product's category membership, rendered as a card
 * section inside ProductForm. A scrollable checkbox list (not chips) so each
 * category can show its description, and a long catalog scrolls instead of
 * wrapping into an unreadable wall. Selection is staged locally by the parent
 * (submitted with the form).
 *
 * Only ACTIVE categories are shown/managed here — the seed
 * (`getProductCategoryIds`) is active-only and the server preserves archived
 * memberships untouched, so nothing invisible consumes the cap. Adding is
 * Pro-gated: when `locked`, unselected rows disable (ProBadge marks why) while
 * selected rows stay deselectable, mirroring the server's add-gated/clear-ungated
 * rule.
 */
export function CategoryPicker({
	retailerId,
	selectedIds,
	onChange,
	locked,
}: {
	retailerId: Id<"retailers">;
	selectedIds: Id<"categories">[];
	onChange: (ids: Id<"categories">[]) => void;
	locked: boolean;
}) {
	const categories = useQuery(api.categories.listForRetailer, { retailerId });
	const active = categories?.filter((c) => c.active);
	const selected = new Set(selectedIds);
	const atCap = selectedIds.length >= MAX_CATEGORIES;
	// A product whose EVERY selected category is hidden drops off the storefront.
	// Warn live so the seller isn't surprised (server keeps `hiddenByCategory`).
	const selectedCats = active?.filter((c) => selected.has(c._id)) ?? [];
	const allSelectedHidden =
		selectedCats.length > 0 && selectedCats.every((c) => c.hidden === true);

	function toggle(id: Id<"categories">) {
		onChange(
			selected.has(id)
				? selectedIds.filter((x) => x !== id)
				: [...selectedIds, id],
		);
	}

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm lg:p-5">
			<div className="min-w-0">
				<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
					Storefront
				</p>
				<h3 className="flex items-center gap-2 text-base font-semibold leading-tight">
					Categories
					{locked ? <ProBadge /> : null}
				</h3>
				<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
					{locked
						? "Adding products to categories is part of the Pro plan. You can still remove this product from its current categories."
						: "Pick where this product appears when buyers browse by category. It always stays in the “All products” view."}
				</p>
			</div>

			{active === undefined ? null : active.length === 0 ? (
				<div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
					<FolderOpen className="size-4 shrink-0" aria-hidden />
					<span>
						No categories yet —{" "}
						<Link
							to="/app/products/categories"
							className="font-medium text-foreground underline underline-offset-2"
						>
							create your first one
						</Link>{" "}
						to group products on your storefront.
					</span>
				</div>
			) : (
				<>
					{/* Scrolls once the list is long so it never becomes a wall. */}
					<div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-0.5">
						{active.map((category) => {
							const isSelected = selected.has(category._id);
							// Deselecting is always allowed; ADDING is blocked by the plan
							// lock or the 10-category cap.
							const disabled = !isSelected && (locked || atCap);
							return (
								<button
									key={category._id}
									type="button"
									onClick={() => toggle(category._id)}
									disabled={disabled}
									aria-pressed={isSelected}
									// Fixed row height (uniform-cards rule, docs/design-system.md):
									// a category without a description centers in the same box as
									// one with a (single, truncated) description line.
									className={`flex min-h-[3.75rem] w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
										isSelected
											? "border-accent bg-accent/10"
											: "border-border bg-card hover:border-accent/40"
									}`}
								>
									<span
										className={`flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
											isSelected
												? "border-accent bg-accent text-white"
												: "border-input bg-background"
										}`}
									>
										{isSelected ? (
											<Check className="size-3.5" aria-hidden />
										) : null}
									</span>
									<span className="flex min-w-0 flex-col">
										<span className="flex items-center gap-1.5">
											<span className="truncate text-sm font-medium leading-snug">
												{category.name}
											</span>
											{category.hidden ? (
												<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
													<EyeOff className="size-2.5" aria-hidden />
													Hidden
												</span>
											) : null}
										</span>
										{category.description ? (
											<span className="truncate text-xs leading-snug text-muted-foreground">
												{category.description}
											</span>
										) : null}
									</span>
								</button>
							);
						})}
					</div>
					{allSelectedHidden ? (
						<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
							Every category you picked is hidden, so this product won&apos;t
							show on your storefront (it&apos;s still sellable at the counter).
							Add a visible category to list it online.
						</p>
					) : null}
					{!locked && atCap ? (
						<p className="text-xs text-muted-foreground">
							A product can be in at most {MAX_CATEGORIES} categories — remove
							one to pick another.
						</p>
					) : null}
				</>
			)}
		</section>
	);
}
