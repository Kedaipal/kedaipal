import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Country } from "../../../convex/lib/country";
import { countryName } from "../../../convex/lib/crossBorder";
import { convexErrorMessage } from "../../lib/format";
import { matchesSearch, pickerSections } from "../../lib/promotion-flow";
import { TONE_PANEL } from "../../lib/tone";
import { cn } from "../../lib/utils";
import { AppImage } from "../ui/app-image";
import { BulkSelectRow } from "../ui/bulk-select-row";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";

type Choices = FunctionReturnType<typeof api.crossBorder.productChoices>;
type Row = Choices["products"][number];

/**
 * Products → Overseas (z8r3fdr5yy): which products can go to the other
 * country. Every product starts ticked — the lane inherits — and the seller
 * unticks what can't make the trip (frozen, fresh, same-day), grouped by
 * their own categories with a tri-state select-all on top and on every group,
 * so a 40-product catalogue is a few taps, never forty. Services and events
 * show disabled WITH the reason: they have no parcel to send.
 *
 * `first` is the one-time pass right after the switch is turned on (Zaki,
 * 28 Oct): the same screen, with a sentence that says why it opened.
 */
export function OverseasProducts({
	retailerId,
	storeCountry,
	destination,
	first,
	turnsOnLane = false,
	readOnly,
	readOnlyReason,
	onDone,
}: {
	retailerId: Id<"retailers">;
	storeCountry: Country;
	destination: Country;
	first: boolean;
	/** A new lane waits on this step — confirming it (even with no changes)
	 * is what makes delivery abroad live. */
	turnsOnLane?: boolean;
	readOnly: boolean;
	readOnlyReason?: string;
	onDone: () => void;
}) {
	const choices = useQuery(
		convexQuery(api.crossBorder.productChoices, { retailerId }),
	).data;
	const setDomesticOnly = useMutation(api.crossBorder.setDomesticOnly);
	// The seller's edits over what's saved — a product absent here reads as
	// saved. Kept as a delta so a live change elsewhere (a product added in
	// another tab) shows up instead of being frozen out by a snapshot.
	const [edits, setEdits] = useState<Map<string, boolean>>(new Map());
	const [query, setQuery] = useState("");
	const [saving, setSaving] = useState(false);
	const where = countryName(destination);

	const goes = (row: Row) => edits.get(row._id) ?? row.shipsAbroad;
	const tickable = (row: Row) => row.reason !== "no_parcel";

	const byId = useMemo(
		() => new Map((choices?.products ?? []).map((p) => [p._id as string, p])),
		[choices?.products],
	);

	if (choices === undefined) {
		return (
			<div className="flex flex-col gap-3">
				<Skeleton className="h-11 w-full rounded-xl" />
				<Skeleton className="h-64 w-full rounded-2xl" />
			</div>
		);
	}
	if (choices.products.length === 0) {
		return (
			<p className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
				You have no products yet. Anything you add can go to {where} unless you
				untick it here.
			</p>
		);
	}

	const visible = choices.products.filter((p) => matchesSearch(p, query));
	const sections = pickerSections(
		visible.map((p) => ({ _id: p._id, categoryIds: p.categoryIds })),
		choices.categories,
	);
	const tickableIds = (ids: readonly string[]) =>
		ids.filter((id) => {
			const row = byId.get(id);
			return row !== undefined && tickable(row);
		});
	const countGoing = (ids: readonly string[]) =>
		ids.filter((id) => {
			const row = byId.get(id);
			return row !== undefined && goes(row);
		}).length;

	function setMany(ids: readonly string[], on: boolean) {
		setEdits((prev) => {
			const next = new Map(prev);
			for (const id of ids) {
				const row = byId.get(id);
				if (!row || !tickable(row)) continue;
				if (row.shipsAbroad === on) next.delete(id);
				else next.set(id, on);
			}
			return next;
		});
	}

	const allTickable = tickableIds(choices.products.map((p) => p._id));
	const goingTotal = countGoing(allTickable);
	const visibleTickable = tickableIds(visible.map((p) => p._id));
	const goingVisible = countGoing(visibleTickable);
	const dirty = edits.size > 0;

	async function save() {
		if (!dirty && !turnsOnLane) {
			onDone();
			return;
		}
		setSaving(true);
		try {
			const changes = [...edits].map(([productId, on]) => ({
				productId: productId as Id<"products">,
				domesticOnly: !on,
			}));
			await setDomesticOnly({
				retailerId,
				changes,
				...(turnsOnLane ? { confirmLane: true } : {}),
			});
			toast.success(
				turnsOnLane
					? `Done — ${goingTotal} product${goingTotal === 1 ? "" : "s"} can go to ${where}.`
					: `${goingTotal} product${goingTotal === 1 ? "" : "s"} can go to ${where}.`,
			);
			setEdits(new Map());
			onDone();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="flex flex-col gap-3">
			{first ? (
				<div
					className={cn(
						"rounded-xl border px-3.5 py-3 text-sm",
						TONE_PANEL.info,
					)}
				>
					<p className="font-semibold">
						One last step: what can go to {where}?
					</p>
					<p>
						Everything is ticked to start. Untick anything that can't survive
						the trip or that couriers won't carry across the border — frozen,
						chilled or fresh food, same-day bakes. Unticked products show buyers
						in {where} "Ships within {countryName(storeCountry)} only".
						{turnsOnLane
							? ` Buyers in ${where} see your store once you confirm.`
							: ""}
					</p>
				</div>
			) : null}
			{readOnly && readOnlyReason ? (
				<p
					className={cn(
						"rounded-xl border px-3.5 py-3 text-sm",
						TONE_PANEL.neutral,
					)}
				>
					{readOnlyReason}
				</p>
			) : null}

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
						selected={goingVisible}
						total={visibleTickable.length}
						onToggle={(on) => setMany(visibleTickable, on)}
						tone="master"
						size="touch"
						unit="products"
						trailing={
							<span className="shrink-0 tabular-nums text-xs text-muted-foreground">
								{goingVisible} of {visibleTickable.length} go
							</span>
						}
					/>
					{sections.map((section) => {
						const ids = tickableIds(section.productIds);
						const going = countGoing(ids);
						return (
							<section
								key={section.key}
								className="overflow-hidden rounded-2xl border border-border"
							>
								{sections.length > 1 && ids.length > 0 ? (
									<div className="border-b border-border px-1 py-0.5">
										<BulkSelectRow
											label={section.name}
											selected={going}
											total={ids.length}
											onToggle={(on) => setMany(ids, on)}
											size="touch"
											unit="products"
											trailing={
												<span className="shrink-0 tabular-nums text-xs text-muted-foreground">
													{going} of {ids.length}
												</span>
											}
										/>
									</div>
								) : sections.length > 1 ? (
									<p className="border-b border-border px-4 py-2.5 text-sm font-semibold">
										{section.name}
									</p>
								) : null}
								<ul className="divide-y divide-border/60">
									{section.productIds.map((id) => {
										const row = byId.get(id);
										if (!row) return null;
										return (
											<li key={id}>
												<ProductRow
													row={row}
													on={goes(row)}
													disabled={readOnly}
													storeCountry={storeCountry}
													onToggle={() => setMany([id], !goes(row))}
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

			{/* Sticky inside the page column, above the bottom nav on a phone —
			    the parcel-weights pattern. A `fixed` full-width bar covered the
			    nav and ran under the sidebar (found on the /test-code pass). */}
			<div className="sticky bottom-20 z-10 rounded-2xl border border-border bg-background p-3 shadow-lg lg:bottom-4">
				<div className="flex items-center gap-3 lg:justify-end">
					<p className="flex-1 text-sm text-muted-foreground lg:flex-none">
						{goingTotal} of {allTickable.length} can go to {where}
					</p>
					<Button
						type="button"
						className="h-11 min-w-[9rem] lg:h-10"
						onClick={() => void save()}
						isLoading={saving}
						disabled={readOnly}
					>
						{dirty
							? `Save ${edits.size} change${edits.size === 1 ? "" : "s"}`
							: turnsOnLane || first
								? "Looks right"
								: "Done"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function ProductRow({
	row,
	on,
	disabled,
	storeCountry,
	onToggle,
}: {
	row: Row;
	on: boolean;
	disabled: boolean;
	storeCountry: Country;
	onToggle: () => void;
}) {
	const noParcel = row.reason === "no_parcel";
	const locked = noParcel || disabled;
	return (
		<button
			type="button"
			aria-pressed={noParcel ? undefined : on}
			disabled={locked}
			onClick={onToggle}
			className={cn(
				"flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left disabled:cursor-not-allowed",
				noParcel && "bg-muted/40",
				on && !noParcel && "bg-accent/5",
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"flex size-[17px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
					noParcel
						? "border-border bg-muted"
						: on
							? "border-accent bg-accent text-accent-foreground"
							: "border-border bg-background",
				)}
			>
				{on && !noParcel ? <Check className="size-3" /> : null}
			</span>
			<span className="size-10 shrink-0 overflow-hidden rounded-lg bg-muted">
				{row.imageUrl ? (
					<AppImage src={row.imageUrl} alt="" aspect="size-full" />
				) : null}
			</span>
			<span className="flex min-w-0 flex-col gap-0.5">
				<span
					className={cn(
						"truncate text-sm font-medium",
						noParcel && "text-muted-foreground",
					)}
				>
					{row.name}
				</span>
				<span className="truncate text-xs text-muted-foreground">
					{noParcel
						? "A service or event — nothing to ship"
						: on
							? "Can go overseas"
							: `Ships within ${countryName(storeCountry)} only`}
				</span>
			</span>
		</button>
	);
}
