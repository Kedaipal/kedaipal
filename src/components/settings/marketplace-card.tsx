import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { STORE_AREA_MAX } from "../../../convex/lib/marketplaceListing";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ToggleSwitch } from "../ui/toggle-switch";
import { SAVE_BTN_CLASS, SectionHeading } from "./settings-primitives";

/**
 * Settings → Store → Marketplace listing (z8r3fdkmyp). The seller-facing side
 * of the /stores directory: every store with a visible product is listed by
 * default, so this card is where the seller LEARNS that and where they can
 * step out — a default the seller can't see or undo would be hidden
 * behaviour, which the house rules forbid.
 *
 * Two controls: the listing switch (saves on flip — it's a state, not a
 * form) and the card's area line (a form with the usual counter + save).
 */
export function MarketplaceCard({
	unlisted,
	area,
	onSave,
}: {
	unlisted: boolean;
	area: string;
	onSave: (patch: {
		marketplaceListed?: boolean;
		storeArea?: string;
	}) => Promise<unknown>;
}) {
	const [flipping, setFlipping] = useState(false);
	const [areaValue, setAreaValue] = useState(area);
	const [savingArea, setSavingArea] = useState(false);
	const listed = !unlisted;
	const areaDirty = areaValue.trim() !== area.trim();

	async function handleFlip(next: boolean) {
		setFlipping(true);
		try {
			await onSave({ marketplaceListed: next });
			toast.success(
				next
					? "Your store is listed on the marketplace."
					: "Removed from the marketplace — your direct link still works.",
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setFlipping(false);
		}
	}

	async function handleAreaSubmit(e: FormEvent) {
		e.preventDefault();
		if (!areaDirty) return;
		setSavingArea(true);
		try {
			await onSave({ storeArea: areaValue });
			toast.success(
				areaValue.trim().length > 0 ? "Area updated." : "Area removed.",
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSavingArea(false);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="Marketplace listing"
				description={
					<>
						Buyers browsing{" "}
						<a
							href="/stores"
							target="_blank"
							rel="noreferrer"
							className="font-medium text-accent-emphasis underline underline-offset-2"
						>
							kedaipal.com/stores
						</a>{" "}
						can discover your store there — free distribution, on by default
						once you have a product.
					</>
				}
			/>
			<div className="flex items-center justify-between gap-3">
				<div className="flex flex-col">
					<span className="text-sm font-medium">List my store</span>
					<span className="text-xs text-muted-foreground">
						{listed
							? "Shown in the directory and its search."
							: "Hidden from the directory — buyers can still reach your direct link."}
					</span>
				</div>
				<ToggleSwitch
					on={listed}
					disabled={flipping}
					onChange={handleFlip}
					label="List my store on the Kedaipal marketplace"
				/>
			</div>
			<form onSubmit={handleAreaSubmit} className="flex flex-col gap-1.5">
				<label htmlFor="marketplace-area" className="text-sm font-medium">
					Area shown on your card
				</label>
				<Input
					id="marketplace-area"
					type="text"
					value={areaValue}
					onChange={(e) => setAreaValue(e.target.value)}
					placeholder="e.g. Ampang, KL"
					maxLength={STORE_AREA_MAX}
					variant="field"
				/>
				<span className="flex items-baseline justify-between text-xs text-muted-foreground">
					<span>Helps nearby buyers spot you. Leave blank to show none.</span>
					<span className="tabular-nums">
						{areaValue.trim().length}/{STORE_AREA_MAX}
					</span>
				</span>
				<Button
					type="submit"
					disabled={!areaDirty || savingArea}
					className={SAVE_BTN_CLASS}
				>
					{savingArea ? "Saving…" : "Save area"}
				</Button>
			</form>
		</div>
	);
}
