import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { formatFulfilmentDate } from "../../../convex/lib/fulfilmentDate";
import {
	collapseStoreArea,
	STORE_AREA_MAX,
} from "../../../convex/lib/marketplaceListing";
import type { FeaturedIn } from "../../../convex/showcases";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
import { convexErrorMessage } from "../../lib/format";
import { showcasePath } from "../../lib/showcase";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
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
	/** Published showcases this store is in (z8r3fdr6mv). */
	featuredIn: FeaturedIn[];
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
			{readiness?.featuredIn.map((f) => (
				<FeaturedCard
					key={f.slug}
					featured={f}
					storeName={storeName}
					notShowing={featuredBlocker(listed, readiness)}
				/>
			))}
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

/**
 * Kedaipal put this store in a showcase (z8r3fdr6mv) — a time-boxed section
 * at the top of /stores. The seller is TOLD, with the booth label we gave
 * them, the link they can share, and a way to tell us the label is wrong:
 * being featured without knowing is the hidden behaviour the house rules
 * forbid. One card per showcase; drafts never reach here.
 */
/**
 * Why a featured store is NOT actually on the showcase right now — the same
 * order the directory's listable rule checks (`notListedReason`), because a
 * showcase only shows members the directory would list. Null when it shows.
 * The first build said "You're featured" to a seller who had switched their
 * listing off, while buyers saw no ticket.
 */
export function featuredBlocker(
	listed: boolean,
	readiness: Pick<
		ListingReadiness,
		"internal" | "hidden" | "hasVisibleProduct"
	>,
): string | null {
	if (readiness.internal)
		return "A Kedaipal or test store is never shown on /stores.";
	if (readiness.hidden)
		return "Kedaipal has taken your store off /stores, so it isn't shown here either.";
	if (!listed) return "Turn on “List my store” above to appear in it.";
	if (!readiness.hasVisibleProduct)
		return "Add a product buyers can see to appear in it.";
	return null;
}

function FeaturedCard({
	featured,
	storeName,
	notShowing,
}: {
	featured: FeaturedIn;
	storeName: string;
	/** Why buyers don't see this store in the showcase, or null. */
	notShowing: string | null;
}) {
	const supportWa = useSupportWaNumber();
	const path = showcasePath(featured.slug);
	const fullUrl = `https://kedaipal.com${path}`;
	const askUrl = buildWaContactLink(
		`Hi Kedaipal, about ${storeName} in the "${featured.title}" showcase on kedaipal.com/stores —`,
		supportWa,
	);
	const when =
		featured.state === "scheduled" && featured.startsAt !== undefined
			? `from ${formatFulfilmentDate(featured.startsAt, { weekday: false, year: false })}`
			: featured.endsAt !== undefined
				? `until ${formatFulfilmentDate(featured.endsAt - 1, { weekday: false, year: false })}`
				: "with no end date";
	return (
		<div
			className={cn(
				"flex flex-col gap-3 rounded-2xl border p-4",
				notShowing
					? "border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-950/20"
					: "border-accent/30 bg-accent/5",
			)}
		>
			<div className="flex flex-col gap-0.5">
				<span
					className={cn(
						"text-[11px] font-bold uppercase tracking-wider",
						notShowing
							? "text-amber-700 dark:text-amber-300"
							: "text-accent-emphasis",
					)}
				>
					{notShowing
						? "In this showcase — not showing"
						: featured.state === "scheduled"
							? "You'll be featured"
							: "You're featured"}
				</span>
				<span className="font-heading text-base font-extrabold">
					{featured.title}
				</span>
				<span className="text-xs text-muted-foreground">
					{featured.label ? (
						<>
							{notShowing ? "Booth label " : "Shown as "}
							<b className="text-foreground">{featured.label}</b> ·{" "}
						</>
					) : null}
					{notShowing ? `the showcase runs ${when}` : `on /stores ${when}`}
				</span>
				{notShowing ? (
					<span className="mt-1 text-sm font-medium text-amber-800 dark:text-amber-200">
						{notShowing}
					</span>
				) : null}
			</div>
			<div className="flex flex-wrap gap-2">
				<CopyButton value={fullUrl} label="Copy showcase link" />
				<Button asChild variant="outline" className="tap-target font-semibold">
					<a href={path} target="_blank" rel="noreferrer">
						View on /stores
					</a>
				</Button>
			</div>
			<span className="text-xs text-muted-foreground">
				Kedaipal picked your store for this showcase.{" "}
				{featured.label ? "Booth label wrong? " : ""}
				<a
					href={askUrl}
					target="_blank"
					rel="noreferrer"
					className="font-medium text-accent-emphasis underline underline-offset-2"
				>
					Tell us on WhatsApp
				</a>
				.
			</span>
		</div>
	);
}
