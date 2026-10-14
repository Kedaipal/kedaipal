import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AdminSellerRow } from "../../../convex/admin";
import type { Country } from "../../../convex/lib/country";
import { SHOWCASE_MEMBER_CAP } from "../../../convex/lib/showcase";
import { cn } from "../../lib/utils";
import { StoreLogoTile } from "../storefront/storefront-header";
import { BulkSelectRow } from "../ui/bulk-select-row";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";

/** What the editor needs to show a just-added store before it is saved. */
export type PickedStore = {
	retailerId: Id<"retailers">;
	storeName: string;
	slug: string;
};

/**
 * "Add stores" for a showcase (z8r3fdr6mv): the admin seller directory,
 * narrowed to the showcase's region, with search, a tri-state select-all
 * over the matches (the editor's own `BulkSelectRow` — one idea, one control)
 * and one "Add N stores" button. A store hidden by Kedaipal or opted out is
 * still addable — it can come back, and the admin may be lining up a booth
 * that opens tomorrow — but its row says so. A Kedaipal or test store is
 * NOT: it never lists, so it is greyed out with that reason, left out of
 * select-all, and refused by `setMembers` too. Stores already in the showcase are shown ticked and
 * disabled rather than hidden: "why can't I find Rimba Gear?" is answered
 * by seeing it. Booth labels are set after adding, in the editor row.
 */
export function ShowcaseStorePicker({
	open,
	onOpenChange,
	showcaseTitle,
	country,
	alreadyIn,
	capacityLeft,
	onAdd,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	showcaseTitle: string;
	country: Country;
	alreadyIn: ReadonlySet<Id<"retailers">>;
	capacityLeft: number;
	/** The picked stores WITH their names, so the editor's new rows read as
	 * the store from the moment they're added, not "New store" until a save. */
	onAdd: (stores: PickedStore[]) => void;
}) {
	const sellerList = useQuery(
		convexQuery(api.admin.listSellersForAdmin, open ? {} : "skip"),
	).data;
	const [query, setQuery] = useState("");
	const [picked, setPicked] = useState<Set<Id<"retailers">>>(() => new Set());

	const q = query.trim().toLowerCase();
	const candidates = (sellerList?.sellers ?? []).filter(
		(s) =>
			s.country === country &&
			(q.length === 0 ||
				s.storeName.toLowerCase().includes(q) ||
				s.slug.toLowerCase().includes(q)),
	);
	const addable = candidates.filter(
		(s) => !alreadyIn.has(s._id) && !s.marketplace.internal,
	);
	const pickedHere = addable.filter((s) => picked.has(s._id)).length;
	const overCap = picked.size > capacityLeft;

	function toggle(id: Id<"retailers">) {
		setPicked((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}
	function toggleAll(selectAll: boolean) {
		setPicked((prev) => {
			const next = new Set(prev);
			for (const s of addable) {
				if (selectAll) next.add(s._id);
				else next.delete(s._id);
			}
			return next;
		});
	}
	function commit() {
		onAdd(
			(sellerList?.sellers ?? [])
				.filter((s) => picked.has(s._id))
				.map((s) => ({
					retailerId: s._id,
					storeName: s.storeName,
					slug: s.slug,
				})),
		);
		setPicked(new Set());
		setQuery("");
		onOpenChange(false);
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex flex-col gap-0 p-0">
				<SheetHeader className="border-b border-border px-4 pb-3 pt-4">
					<SheetTitle>Add stores</SheetTitle>
					<SheetDescription>
						to {showcaseTitle} · {country} stores only
					</SheetDescription>
					<div className="relative mt-2">
						<Search
							aria-hidden
							className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							variant="field"
							type="search"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search by name or slug"
							aria-label="Search stores"
							className="pl-9"
						/>
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						{sellerList === undefined
							? "Loading…"
							: `${candidates.length} ${candidates.length === 1 ? "match" : "matches"}${candidates.length - addable.length > 0 ? ` · ${candidates.length - addable.length} can't be added` : ""}`}
					</p>
					{addable.length > 1 ? (
						<BulkSelectRow
							label={
								q.length > 0
									? `All ${addable.length} matches`
									: `All ${addable.length} stores`
							}
							selected={pickedHere}
							total={addable.length}
							unit="stores"
							tone="master"
							onToggle={toggleAll}
						/>
					) : null}
				</SheetHeader>

				<ul className="min-h-0 grow overflow-y-auto">
					{sellerList === undefined ? (
						<li className="flex flex-col gap-3 p-4">
							<Skeleton className="h-12 w-full" />
							<Skeleton className="h-12 w-full" />
							<Skeleton className="h-12 w-full" />
						</li>
					) : candidates.length === 0 ? (
						<li className="px-4 py-10 text-center text-sm text-muted-foreground">
							No {country} store matches.
						</li>
					) : (
						candidates.map((s) => (
							<PickerRow
								key={s._id}
								seller={s}
								inShowcase={alreadyIn.has(s._id)}
								checked={picked.has(s._id)}
								onToggle={() => toggle(s._id)}
							/>
						))
					)}
				</ul>

				<div className="flex flex-col gap-2 border-t border-border px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
					{overCap ? (
						<span className="text-center text-xs text-destructive">
							A showcase holds up to {SHOWCASE_MEMBER_CAP} stores — room for{" "}
							{capacityLeft} more.
						</span>
					) : (
						<span className="text-center text-xs text-muted-foreground">
							Booth labels can be set after adding.
						</span>
					)}
					<Button
						type="button"
						disabled={picked.size === 0 || overCap}
						onClick={commit}
						className="tap-target font-bold"
					>
						Add {picked.size} {picked.size === 1 ? "store" : "stores"}
					</Button>
				</div>
			</SheetContent>
		</Sheet>
	);
}

function PickerRow({
	seller,
	inShowcase,
	checked,
	onToggle,
}: {
	seller: AdminSellerRow;
	inShowcase: boolean;
	checked: boolean;
	onToggle: () => void;
}) {
	const blocked = !inShowcase && seller.marketplace.internal;
	const warning = seller.marketplace.internal
		? "A Kedaipal or test store — never shown on /stores, can't be added"
		: seller.marketplace.hidden
			? "Hidden from /stores by Kedaipal — won't show"
			: seller.marketplace.unlistedAt !== undefined
				? "Seller turned off their /stores listing — won't show"
				: null;
	return (
		<li>
			<label
				className={cn(
					"flex min-h-[60px] cursor-pointer items-center gap-3 border-b border-border/60 px-4 py-2.5 transition-colors hover:bg-muted/50 has-[:focus-visible]:bg-muted/50",
					(inShowcase || blocked) && "cursor-default opacity-60",
				)}
			>
				<input
					type="checkbox"
					className="size-5 shrink-0 accent-primary"
					checked={inShowcase || checked}
					disabled={inShowcase || blocked}
					onChange={onToggle}
					aria-label={`${seller.storeName}${inShowcase ? " (already in this showcase)" : blocked ? " (can't be added — a Kedaipal or test store)" : ""}`}
				/>
				<StoreLogoTile storeName={seller.storeName} size="bar" />
				<span className="flex min-w-0 flex-col">
					<span className="truncate text-sm font-bold">{seller.storeName}</span>
					<span
						className={cn(
							"truncate text-xs",
							warning
								? "font-semibold text-amber-700 dark:text-amber-300"
								: "text-muted-foreground",
						)}
					>
						{inShowcase
							? "Already in this showcase"
							: (warning ?? `/${seller.slug}`)}
					</span>
				</span>
			</label>
		</li>
	);
}
