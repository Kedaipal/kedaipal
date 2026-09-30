import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";
import { sponsorshipActive } from "../../../convex/lib/marketplaceListing";
import { convexErrorMessage } from "../../lib/format";
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

/**
 * Marketplace sponsorship window editor (z8r3fdkmyp) — the ONE writer of
 * `marketplaceSponsoredUntil`, from the admin directory's Manage menu. V1
 * sponsorship is sold by hand (manual invoice); this dialog just runs the
 * window. The chosen END DATE is inclusive — the card stays on the rail
 * through that whole day (stored as the following midnight).
 */
export function SponsorDialog({
	seller,
	onClose,
}: {
	seller: AdminSellerRow;
	onClose: () => void;
}) {
	const setSponsorship = useMutation(api.admin.setMarketplaceSponsorship);
	const now = Date.now();
	const active = sponsorshipActive(seller.marketplace.sponsoredUntil, now);
	const [endDate, setEndDate] = useState(() =>
		active && seller.marketplace.sponsoredUntil
			? toDateInputValue(seller.marketplace.sponsoredUntil - 1)
			: "",
	);
	const [saving, setSaving] = useState(false);

	async function save(until: number | null) {
		setSaving(true);
		try {
			await setSponsorship({ retailerId: seller._id, until });
			toast.success(
				until === null
					? `${seller.storeName} is off the highlights rail.`
					: `${seller.storeName} is sponsored until ${new Date(until - 1).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}.`,
			);
			onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	function handleSet() {
		if (!endDate) return;
		// Inclusive end date → expires at the NEXT local midnight.
		const [y, m, d] = endDate.split("-").map(Number);
		const until = new Date(y, m - 1, d + 1).getTime();
		void save(until);
	}

	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Marketplace sponsorship</DialogTitle>
					<DialogDescription>
						{active && seller.marketplace.sponsoredUntil
							? `${seller.storeName} rides the "Store highlights" rail (labelled Sponsored) until ${new Date(seller.marketplace.sponsoredUntil - 1).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}.`
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
				</div>
				<div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
					{active ? (
						<Button
							type="button"
							variant="secondary"
							disabled={saving}
							onClick={() => void save(null)}
						>
							End sponsorship now
						</Button>
					) : null}
					<Button
						type="button"
						disabled={saving || endDate.length === 0}
						onClick={handleSet}
					>
						{saving
							? "Saving…"
							: active
								? "Update window"
								: "Start sponsorship"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
