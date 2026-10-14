import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import {
	collapseStoreArea,
	STORE_AREA_MAX,
} from "../../../convex/lib/marketplaceListing";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
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
 *
 * The switch line tells the TRUTH about the directory, not just the switch:
 * ON with no storefront-visible product is not listed, and saying "Shown in
 * the directory" there would lie to the brand-new seller most likely to read
 * it — nor would it be true for an internal (Kedaipal / test) store, which is
 * never listed, or for one an admin hid (the card says so, with the admin's
 * note and a way to ask us). `readiness` comes from
 * `marketplace.myListingReadiness`; `undefined` is loading, never "no".
 */
type ListingReadiness = {
	hasVisibleProduct: boolean;
	internal: boolean;
	hidden: { note?: string } | null;
};

export function MarketplaceCard({
	storeName,
	unlisted,
	area,
	readiness,
	onSave,
}: {
	/** Names the store in the "ask us why" message when an admin hid it. */
	storeName: string;
	unlisted: boolean;
	area: string;
	readiness: ListingReadiness | undefined;
	onSave: (patch: {
		marketplaceListed?: boolean;
		storeArea?: string;
	}) => Promise<unknown>;
}) {
	const [flipping, setFlipping] = useState(false);
	const [areaValue, setAreaValue] = useState(area);
	const [savingArea, setSavingArea] = useState(false);
	const listed = !unlisted;
	// Compare in the SAVED shape: the server collapses inner whitespace, so a
	// raw comparison would leave "Ampang,   KL" reading as unsaved forever.
	const areaDirty = collapseStoreArea(areaValue) !== area;

	async function handleFlip(next: boolean) {
		setFlipping(true);
		try {
			await onSave({ marketplaceListed: next });
			// Say what the switch did, not what the directory shows: ON may
			// still not list (no visible product, internal, hidden by us) —
			// the status line under the switch carries that truth.
			toast.success(
				next
					? "Marketplace listing turned on."
					: "Marketplace listing turned off — your direct link still works.",
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
		const saved = collapseStoreArea(areaValue);
		setSavingArea(true);
		try {
			await onSave({ storeArea: saved });
			// Show what was stored, so the field and the card agree.
			setAreaValue(saved);
			toast.success(saved.length > 0 ? "Area updated." : "Area removed.");
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
					<ListingStatusLine
						listed={listed}
						readiness={readiness}
						storeName={storeName}
					/>
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
				<span className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
					<span>Helps nearby buyers spot you. Leave blank to show none.</span>
					<span className="shrink-0 tabular-nums">
						{collapseStoreArea(areaValue).length}/{STORE_AREA_MAX}
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

function ListingStatusLine({
	listed,
	readiness,
	storeName,
}: {
	listed: boolean;
	readiness: ListingReadiness | undefined;
	storeName: string;
}) {
	if (readiness?.internal) {
		return (
			<span className="text-xs text-muted-foreground">
				A Kedaipal or test store — never listed on the marketplace, whatever
				this switch says.
			</span>
		);
	}
	if (readiness?.hidden) {
		return (
			<HiddenByKedaipal note={readiness.hidden.note} storeName={storeName} />
		);
	}
	if (!listed) {
		return (
			<span className="text-xs text-muted-foreground">
				Hidden from the directory — buyers can still reach your direct link.
			</span>
		);
	}
	if (readiness === undefined) {
		return (
			<span className="text-xs text-muted-foreground">
				Checking your listing…
			</span>
		);
	}
	if (!readiness.hasVisibleProduct) {
		return (
			<span className="text-xs text-muted-foreground">
				On, but not shown yet — buyers find you once a product is visible on
				your storefront.{" "}
				<Link
					to="/app/products/new"
					className="font-medium text-accent-emphasis underline underline-offset-2"
				>
					Add a product
				</Link>
			</span>
		);
	}
	return (
		<span className="text-xs text-muted-foreground">
			Shown in the directory and its search.
		</span>
	);
}

/**
 * An admin took the store off /stores. It outranks the switch, so the seller
 * is told plainly — with the admin's note when there is one, and a WhatsApp
 * line to us either way, so "why?" is never a dead end.
 */
function HiddenByKedaipal({
	note,
	storeName,
}: {
	note?: string;
	storeName: string;
}) {
	const supportWa = useSupportWaNumber();
	const askUrl = buildWaContactLink(
		`Hi Kedaipal, my store ${storeName} is hidden from kedaipal.com/stores. What do I need to change?`,
		supportWa,
	);
	return (
		<span className="flex flex-col gap-1 text-xs text-muted-foreground">
			<span>
				Kedaipal has hidden your store from the directory, so it isn't shown
				whatever this switch says. Your storefront link and orders are
				unaffected.
			</span>
			{note ? (
				<span className="text-foreground">Note from Kedaipal: {note}</span>
			) : null}
			<a
				href={askUrl}
				target="_blank"
				rel="noreferrer"
				className="font-medium text-accent-emphasis underline underline-offset-2"
			>
				Ask us about it on WhatsApp
			</a>
		</span>
	);
}
