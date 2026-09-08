import { Link } from "@tanstack/react-router";
import { highlightRingClass } from "../../lib/country-setup-copy";
import { PRODUCT_SPOTLIGHT } from "../../lib/product-spotlight";
import type { ProductSpotlightKey } from "../../lib/spotlight";
import { Button } from "../ui/button";

/**
 * The first hop of a product-page spotlight (`/app/products?spot=<key>`,
 * src/lib/spotlight.ts): a What's-new note landed the seller on the list
 * for a card that lives on ONE product's form, and the list can't know
 * which. This says what they are looking for and where the next tap takes
 * them; the rows the key applies to carry it there.
 *
 * Wears the same spotlight ring the destination card will, so the two read
 * as one journey. Two states, never a dead end: with an eligible listing it
 * says "open one below"; with none it says so and offers "+ New product"
 * (unless the store is at the product cap, where that button would only
 * fail at the server — the cap banner right below it explains why).
 */
export function ProductSpotlightBanner({
	spot,
	eligibleCount,
	canCreate,
	onDismiss,
}: {
	spot: ProductSpotlightKey;
	/** Rows the key applies to, counted over EVERY product, not the filtered view. */
	eligibleCount: number;
	/** False at the product cap — the cap banner carries the reason. */
	canCreate: boolean;
	/** "Got it" — clears the key from the URL. */
	onDismiss: () => void;
}) {
	const copy = PRODUCT_SPOTLIGHT[spot];
	const hasEligible = eligibleCount > 0;
	return (
		<section
			aria-label={copy.title}
			className={`flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between ${highlightRingClass("spotlight")}`}
		>
			<div className="min-w-0">
				<p className="text-sm font-semibold">{copy.title}</p>
				<p className="mt-1 text-[13px] leading-snug text-muted-foreground">
					{hasEligible ? copy.body : copy.empty}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{!hasEligible && canCreate ? (
					<Button asChild className="h-11 sm:h-10">
						<Link to="/app/products/new">+ New product</Link>
					</Button>
				) : null}
				<Button variant="ghost" className="h-11 sm:h-10" onClick={onDismiss}>
					Got it
				</Button>
			</div>
		</section>
	);
}
