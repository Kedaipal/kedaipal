import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { FolderOpen } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ProBadge } from "../app/pro-gate";
import { FilterChip } from "../ui/filter-chip";

/** Mirrors MAX_CATEGORIES_PER_PRODUCT in convex/categories.ts. */
const MAX_CATEGORIES = 10;

/**
 * Multi-select chip picker for a product's category membership, rendered as a
 * card section inside ProductForm. Selection is staged locally by the parent
 * (submitted with the form). Adding is Pro-gated — when `locked`, unselected
 * chips disable (ProBadge marks why) while selected chips stay deselectable,
 * mirroring the server's add-gated/clear-ungated rule.
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
					<div className="flex flex-wrap gap-2">
						{active.map((category) => {
							const isSelected = selected.has(category._id);
							// Deselecting is always allowed; ADDING is blocked by the plan
							// lock or the 10-category cap.
							const disabled = !isSelected && (locked || atCap);
							return (
								<FilterChip
									key={category._id}
									tone="accent"
									selected={isSelected}
									onClick={() => toggle(category._id)}
									disabled={disabled}
									className="disabled:cursor-not-allowed disabled:opacity-50"
								>
									{category.name}
								</FilterChip>
							);
						})}
					</div>
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
