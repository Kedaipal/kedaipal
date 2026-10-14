import type { FunctionReturnType } from "convex/server";
import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { api } from "../../../convex/_generated/api";
import { formatPrice } from "../../lib/format";
import { matchesSearch, pickerSections } from "../../lib/promotion-flow";
import { cn } from "../../lib/utils";
import { BulkSelectRow } from "../ui/bulk-select-row";
import { Input } from "../ui/input";

/**
 * Which products go on the promotion (`z8r3fducfd`) — step 1 of the flow, and
 * the same picker "Add products" opens on a running promotion.
 *
 * Grouped by the seller's own categories, with a tri-state select-all on top
 * and on every group (a 20-product happy hour is two taps, never twenty).
 *
 * A product that can't simply be picked — already on another open
 * promotion, or carrying its own sale — is shown disabled WITH its reason
 * and an explicit "Move here". Joining replaces that sale, so it is never
 * done by a select-all and never done silently: the server refuses a move
 * that isn't named (`promotions.create`'s `move`).
 */

export type PickerCatalog = FunctionReturnType<
	typeof api.promotions.pickerCatalog
>;
type PickerProduct = PickerCatalog["products"][number];

const dateLine = (ms: number) =>
	new Date(ms).toLocaleDateString("en-MY", { day: "numeric", month: "short" });

/** Why a product can't be ticked as-is, or null when it can. */
export function blockedReason(
	product: PickerProduct,
	mode: "create" | "add",
): string | null {
	if (mode === "add" && product.inThisPromotion)
		return "Already in this promotion";
	if (product.elsewhere)
		return `On ${product.elsewhere.label ?? "another promotion"}${
			product.elsewhere.endsAt !== undefined
				? ` until ${dateLine(product.elsewhere.endsAt)}`
				: ""
		}`;
	if (product.ownSale)
		return `Has its own sale${
			product.ownSale.endsAt !== undefined
				? ` until ${dateLine(product.ownSale.endsAt)}`
				: ""
		}`;
	return null;
}

/** What a move replaces, said as its own sentence (never the blocked
 * reason re-cased — "Oct" must stay "Oct"). */
function movedLine(product: PickerProduct): string {
	if (product.elsewhere)
		return `Moving here — leaves ${product.elsewhere.label ?? "its other promotion"}`;
	return "Moving here — replaces its own sale";
}

function priceSummary(product: PickerProduct, currency: string): string {
	const priced = product.variants.filter((v) => v.price > 0);
	const choices =
		product.variants.length > 1 ? ` · ${product.variants.length} choices` : "";
	if (priced.length === 0) return `Priced by quote${choices}`;
	const min = Math.min(...priced.map((v) => v.price));
	const max = Math.max(...priced.map((v) => v.price));
	const range =
		min === max
			? formatPrice(min, currency)
			: `${formatPrice(min, currency)} – ${formatPrice(max, currency)}`;
	return `${range}${choices}`;
}

export function ProductPicker({
	catalog,
	mode,
	selected,
	onSelectedChange,
	moving,
	onMovingChange,
	currency,
}: {
	catalog: PickerCatalog;
	mode: "create" | "add";
	selected: ReadonlySet<string>;
	onSelectedChange: (next: Set<string>) => void;
	/** Blocked products the seller chose to move here. */
	moving: ReadonlySet<string>;
	onMovingChange: (next: Set<string>) => void;
	currency: string;
}) {
	const [query, setQuery] = useState("");
	const byId = useMemo(
		() => new Map(catalog.products.map((p) => [p._id as string, p])),
		[catalog.products],
	);
	const visible = catalog.products.filter((p) => matchesSearch(p, query));
	const sections = pickerSections(
		visible.map((p) => ({ _id: p._id, categoryIds: p.categoryIds })),
		catalog.categories,
	);

	const isBlocked = (p: PickerProduct) =>
		blockedReason(p, mode) !== null && !moving.has(p._id);
	// Select-all only ever reaches the freely pickable — a move is a decision
	// about one product, made on its own row.
	const pickable = (ids: readonly string[]) =>
		ids.filter((id) => {
			const p = byId.get(id);
			return p !== undefined && !isBlocked(p);
		});

	function setMany(ids: readonly string[], on: boolean) {
		const next = new Set(selected);
		for (const id of ids) {
			if (on) next.add(id);
			else next.delete(id);
		}
		onSelectedChange(next);
	}

	function toggle(id: string) {
		setMany([id], !selected.has(id));
	}

	function moveHere(id: string) {
		onMovingChange(new Set([...moving, id]));
		onSelectedChange(new Set([...selected, id]));
	}

	function undoMove(id: string) {
		const nextMoving = new Set(moving);
		nextMoving.delete(id);
		onMovingChange(nextMoving);
		const nextSelected = new Set(selected);
		nextSelected.delete(id);
		onSelectedChange(nextSelected);
	}

	const allPickable = pickable(visible.map((p) => p._id));
	const selectedVisible = allPickable.filter((id) => selected.has(id)).length;

	if (catalog.products.length === 0)
		return (
			<p className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
				You have no products yet. Add one first, then come back to put it on
				sale.
			</p>
		);

	return (
		<div className="flex flex-col gap-3">
			<label className="relative block">
				<span className="sr-only">Search products</span>
				<Search
					className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden
				/>
				<Input
					variant="field"
					className="h-11 pl-9"
					placeholder="Search by name or item code"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
			</label>

			{visible.length === 0 ? (
				<p className="px-1 py-6 text-center text-sm text-muted-foreground">
					No product matches “{query.trim()}”.
				</p>
			) : (
				<>
					<BulkSelectRow
						label={query.trim() ? "All matching products" : "All products"}
						selected={selectedVisible}
						total={allPickable.length}
						onToggle={(on) => setMany(allPickable, on)}
						tone="master"
						size="touch"
						unit="products"
						trailing={
							<span className="shrink-0 tabular-nums text-xs text-muted-foreground">
								{selectedVisible} of {allPickable.length}
							</span>
						}
					/>
					{sections.map((section) => {
						const ids = pickable(section.productIds);
						const ticked = ids.filter((id) => selected.has(id)).length;
						return (
							<section
								key={section.key}
								className="overflow-hidden rounded-2xl border border-border"
							>
								{/* One group (a store with no categories) is the same set as
								    the master row above — a second identical select-all
								    would only be noise. */}
								{sections.length > 1 ? (
									<div className="border-b border-border px-1 py-0.5">
										<BulkSelectRow
											label={section.name}
											selected={ticked}
											total={ids.length}
											onToggle={(on) => setMany(ids, on)}
											size="touch"
											unit="products"
											trailing={
												<span className="shrink-0 tabular-nums text-xs text-muted-foreground">
													{ticked} of {ids.length}
												</span>
											}
										/>
									</div>
								) : null}
								<ul className="divide-y divide-border/60">
									{section.productIds.map((id) => {
										const product = byId.get(id);
										if (!product) return null;
										const reason = blockedReason(product, mode);
										const moved = moving.has(id);
										return (
											<li key={id}>
												<PickRow
													product={product}
													summary={priceSummary(product, currency)}
													selected={selected.has(id)}
													blocked={reason !== null && !moved}
													reason={reason}
													moved={moved}
													canMove={!(mode === "add" && product.inThisPromotion)}
													onToggle={() => toggle(id)}
													onMove={() => moveHere(id)}
													onUndoMove={() => undoMove(id)}
												/>
											</li>
										);
									})}
								</ul>
							</section>
						);
					})}
				</>
			)}
		</div>
	);
}

function PickRow({
	product,
	summary,
	selected,
	blocked,
	reason,
	moved,
	canMove,
	onToggle,
	onMove,
	onUndoMove,
}: {
	product: PickerProduct;
	summary: string;
	selected: boolean;
	blocked: boolean;
	reason: string | null;
	moved: boolean;
	canMove: boolean;
	onToggle: () => void;
	onMove: () => void;
	onUndoMove: () => void;
}) {
	const priceOnly = product.isBooking || product.isEvent;
	return (
		<div
			className={cn(
				"flex items-center gap-3 px-3",
				blocked && "bg-muted/40",
				selected && !blocked && "bg-accent/5",
			)}
		>
			<button
				type="button"
				aria-pressed={selected}
				disabled={blocked}
				onClick={onToggle}
				className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 text-left disabled:cursor-not-allowed"
			>
				<span
					aria-hidden="true"
					className={cn(
						"flex size-[17px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
						blocked
							? "border-border bg-muted"
							: selected
								? "border-accent bg-accent text-accent-foreground"
								: "border-border bg-background",
					)}
				>
					{selected && !blocked ? <Check className="size-3" /> : null}
				</span>
				<span className="flex min-w-0 flex-col gap-0.5">
					<span
						className={cn(
							"truncate text-sm font-medium",
							blocked && "text-muted-foreground",
						)}
					>
						{product.name}
					</span>
					<span className="truncate text-xs text-muted-foreground">
						{summary}
						{priceOnly
							? ` · ${product.isBooking ? "booking" : "event"}, sale price only`
							: ""}
					</span>
					{reason !== null ? (
						<span
							className={cn(
								"text-xs font-semibold",
								moved
									? "text-accent-emphasis"
									: "text-amber-700 dark:text-amber-400",
							)}
						>
							{moved ? movedLine(product) : reason}
						</span>
					) : null}
				</span>
			</button>
			{reason !== null && canMove ? (
				<button
					type="button"
					onClick={moved ? onUndoMove : onMove}
					className="tap-target shrink-0 px-1 text-[13px] font-semibold text-accent-emphasis hover:underline"
				>
					{moved ? "Undo" : "Move here"}
				</button>
			) : null}
		</div>
	);
}
