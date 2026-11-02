import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";
import { COMP_KIND_LABEL, type CompKind } from "../../../convex/lib/comp";
import {
	highlightedThroughLabel,
	sellerHighlight,
} from "../../lib/admin-seller-view";
import { convexErrorMessage, formatShortDate } from "../../lib/format";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { ToggleSwitch } from "../ui/toggle-switch";

/** Local YYYY-MM-DD for a native date input's min/default. */
function toDateInputValue(epoch: number): string {
	const d = new Date(epoch);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The inclusive end date as stored: the NEXT local midnight, so the card
 * stays on the rail through that whole day. */
function untilFromEndDate(endDate: string): number {
	const [y, m, d] = endDate.split("-").map(Number);
	return new Date(y, m - 1, d + 1).getTime();
}

/**
 * Store highlights for one store (z8r3fdkmyp), from the admin directory's
 * Manage menu. Three shapes, by what the store is:
 *
 * - **Internal** (our own / a test store): never listed — says so, no
 *   controls.
 * - **Comped** partner / sponsor / pilot: featured AUTOMATICALLY while the
 *   comp lasts (Zaki, 1 Oct 2026); the one control is the switch that keeps
 *   this store off (`admin.setCompHighlight`).
 * - **Everyone else**: a paid, dated window (`setMarketplaceSponsorship` /
 *   `endMarketplaceSponsorship`) — V1 is sold by hand, this just runs it.
 *
 * "Highlight" is the admin word on purpose: "Sponsor" is already a comp kind
 * in the same table, and the two are different things. Buyers still see the
 * placement labelled "Sponsored" — the disclosure word.
 */
export function HighlightDialog({
	seller,
	onClose,
}: {
	seller: AdminSellerRow;
	onClose: () => void;
}) {
	const setWindow = useMutation(api.admin.setMarketplaceSponsorship);
	const endWindow = useMutation(api.admin.endMarketplaceSponsorship);
	const setCompHighlight = useMutation(api.admin.setCompHighlight);
	const now = Date.now();
	const { source, compEligible } = sellerHighlight(seller, now);
	const liveUntil =
		source === "paid" ? seller.marketplace.sponsoredUntil : undefined;
	const savedEndDate =
		liveUntil !== undefined ? toDateInputValue(liveUntil - 1) : "";
	const [endDate, setEndDate] = useState(savedEndDate);
	const [saving, setSaving] = useState(false);
	// Nothing to save until the date moves — an unchanged "Update" would write
	// a no-op and an audit row that says something happened.
	const unchanged = endDate === savedEndDate;
	const compOn = seller.marketplace.compHighlightOffAt === undefined;
	const compKindLabel = seller.comp
		? COMP_KIND_LABEL[seller.comp.kind as CompKind]
		: "";

	async function run(work: () => Promise<unknown>, done: string, close = true) {
		setSaving(true);
		try {
			await work();
			toast.success(done);
			if (close) onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	function handleSetWindow() {
		if (!endDate || unchanged) return;
		const until = untilFromEndDate(endDate);
		void run(
			() => setWindow({ retailerId: seller._id, until }),
			`${seller.storeName} is highlighted through ${highlightedThroughLabel(until)}.`,
		);
	}

	const description = seller.marketplace.internal
		? `${seller.storeName} is a Kedaipal or test store, so it is never listed on kedaipal.com/stores — and so never highlighted.`
		: source === "paid" && liveUntil !== undefined
			? `${seller.storeName} is on the "Store highlights" rail through ${highlightedThroughLabel(liveUntil)} — buyers see it labelled “Sponsored”.`
			: compEligible
				? `${compKindLabel} comps join the "Store highlights" rail automatically and leave it when the comp ends — buyers see them labelled “Sponsored”.`
				: `Put ${seller.storeName} on the "Store highlights" rail for a set window — buyers see it labelled “Sponsored”.`;

	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Store highlights</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				{seller.marketplace.internal ? null : (
					<>
						{seller.marketplace.hidden !== undefined ? (
							<p className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
								An admin hid this store from /stores — a highlight would not
								show until it's shown again (Manage → Show on /stores again).
							</p>
						) : seller.marketplace.unlistedAt !== undefined ? (
							<p className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
								This seller opted OUT of the marketplace — a highlight would not
								show until they relist in Settings → Store.
							</p>
						) : null}

						{compEligible ? (
							<div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-3">
								<div className="flex flex-col">
									<span className="text-sm font-medium">
										Feature while comped
									</span>
									<span className="text-xs text-muted-foreground">
										{compOn
											? "On — shown on the rail until the comp ends."
											: `Off since ${formatShortDate(seller.marketplace.compHighlightOffAt ?? now)} — this comped store stays off the rail.`}
									</span>
								</div>
								<ToggleSwitch
									on={compOn}
									disabled={saving}
									label={`Feature ${seller.storeName} in Store highlights while comped`}
									onChange={(next) =>
										void run(
											() =>
												setCompHighlight({ retailerId: seller._id, on: next }),
											next
												? `${seller.storeName} is featured while comped.`
												: `${seller.storeName} is off Store highlights.`,
											false,
										)
									}
								/>
							</div>
						) : null}

						{/* A dated window is the non-comped path; for a comped store it
						    only appears when one is still running, so it can be ended. */}
						{!compEligible || liveUntil !== undefined ? (
							<div className="flex flex-col gap-1.5">
								<label
									htmlFor="highlight-until"
									className="text-sm font-medium"
								>
									Highlighted through (inclusive)
								</label>
								<Input
									id="highlight-until"
									type="date"
									value={endDate}
									min={toDateInputValue(now)}
									onChange={(e) => setEndDate(e.target.value)}
									variant="field"
								/>
								{/* Disabled-with-reason: the button below waits on this field. */}
								<p className="text-xs text-muted-foreground">
									{endDate.length === 0
										? "Pick the last day the card should show."
										: liveUntil !== undefined && unchanged
											? "Pick a new last day to move the window."
											: `Shows through ${highlightedThroughLabel(untilFromEndDate(endDate))}, then leaves the rail on its own.`}
								</p>
							</div>
						) : null}

						{!compEligible || liveUntil !== undefined ? (
							<div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
								{liveUntil !== undefined ? (
									<Button
										type="button"
										variant="secondary"
										disabled={saving}
										onClick={() =>
											void run(
												() => endWindow({ retailerId: seller._id }),
												`${seller.storeName}'s highlight window ended.`,
											)
										}
									>
										End window now
									</Button>
								) : null}
								<Button
									type="button"
									disabled={saving || endDate.length === 0 || unchanged}
									onClick={handleSetWindow}
								>
									{saving
										? "Saving…"
										: liveUntil !== undefined
											? "Update window"
											: "Start highlight"}
								</Button>
							</div>
						) : null}
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
