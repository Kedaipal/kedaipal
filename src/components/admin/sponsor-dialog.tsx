import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";
import { sponsorshipActive } from "../../../convex/lib/marketplaceListing";
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

/** The last day a stored `until` covers — what every surface names. */
export function sponsoredThroughLabel(until: number): string {
	return formatShortDate(until - 1);
}

/**
 * Marketplace sponsorship window editor (z8r3fdkmyp) — the admin console is
 * the ONE writer of `marketplaceSponsoredUntil`, from the directory's Manage
 * menu. V1 sponsorship is sold by hand (manual invoice); this dialog just
 * runs the window. Start/move and end are separate mutations so the audit
 * log records which act happened.
 */
export function SponsorDialog({
	seller,
	onClose,
}: {
	seller: AdminSellerRow;
	onClose: () => void;
}) {
	const setSponsorship = useMutation(api.admin.setMarketplaceSponsorship);
	const endSponsorship = useMutation(api.admin.endMarketplaceSponsorship);
	const now = Date.now();
	const liveUntil = sponsorshipActive(seller.marketplace.sponsoredUntil, now)
		? seller.marketplace.sponsoredUntil
		: undefined;
	const savedEndDate =
		liveUntil !== undefined ? toDateInputValue(liveUntil - 1) : "";
	const [endDate, setEndDate] = useState(savedEndDate);
	const [saving, setSaving] = useState(false);
	// Nothing to save until the date moves — an unchanged "Update" would write
	// a no-op and an audit row that says something happened.
	const unchanged = endDate === savedEndDate;

	async function run(work: () => Promise<unknown>, done: string) {
		setSaving(true);
		try {
			await work();
			toast.success(done);
			onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	function handleSet() {
		if (!endDate || unchanged) return;
		const until = untilFromEndDate(endDate);
		void run(
			() => setSponsorship({ retailerId: seller._id, until }),
			`${seller.storeName} is sponsored through ${sponsoredThroughLabel(until)}.`,
		);
	}

	function handleEnd() {
		void run(
			() => endSponsorship({ retailerId: seller._id }),
			`${seller.storeName} is off the highlights rail.`,
		);
	}

	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Marketplace sponsorship</DialogTitle>
					<DialogDescription>
						{liveUntil !== undefined
							? `${seller.storeName} rides the "Store highlights" rail (labelled Sponsored) through ${sponsoredThroughLabel(liveUntil)}.`
							: `Put ${seller.storeName} on the marketplace's "Store highlights" rail — every placement carries a visible “Sponsored” label.`}
					</DialogDescription>
				</DialogHeader>
				{seller.marketplace.unlistedAt !== undefined ? (
					<p className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
						This seller opted OUT of the marketplace — a sponsorship would not
						show until they relist in Settings → Store.
					</p>
				) : null}
				<div className="flex flex-col gap-1.5">
					<label htmlFor="sponsor-until" className="text-sm font-medium">
						Sponsored through (inclusive)
					</label>
					<Input
						id="sponsor-until"
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
								: `Shows through ${sponsoredThroughLabel(untilFromEndDate(endDate))}, then leaves the rail on its own.`}
					</p>
				</div>
				<div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
					{liveUntil !== undefined ? (
						<Button
							type="button"
							variant="secondary"
							disabled={saving}
							onClick={handleEnd}
						>
							End sponsorship now
						</Button>
					) : null}
					<Button
						type="button"
						disabled={saving || endDate.length === 0 || unchanged}
						onClick={handleSet}
					>
						{saving
							? "Saving…"
							: liveUntil !== undefined
								? "Update window"
								: "Start sponsorship"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
