import { createContext, type ReactNode, useContext } from "react";
import type { Country } from "../../../convex/lib/country";
import { shipsAbroad, shipsWithinLabel } from "../../../convex/lib/crossBorder";
import { useMarketplaceRegion } from "../../hooks/useMarketplaceRegion";

/**
 * "Ships within Malaysia only" on the storefront (z8r3fdr5yy, Zaki 28 Oct).
 *
 * The storefront shows EVERY product to everyone — the label is the whole
 * mechanism. It appears only when (a) the store delivers abroad, (b) the
 * visitor is browsing from a country it delivers to (geo from the edge, a
 * guess — which is exactly why nothing is ever HIDDEN on it), and (c) the
 * product can't go. The buyer reads it before adding to the cart; checkout's
 * "Deliver to" switch is the hard stop.
 */
type AbroadVisit = { visitor: Country; label: string };

const HomeOnlyContext = createContext<AbroadVisit | null>(null);

export function HomeOnlyLabelProvider({
	storeCountry,
	shipsAbroadTo,
	children,
}: {
	storeCountry: Country;
	shipsAbroadTo: readonly Country[] | undefined;
	children: ReactNode;
}) {
	const visitor = useMarketplaceRegion();
	const visit =
		visitor !== storeCountry && (shipsAbroadTo ?? []).includes(visitor)
			? { visitor, label: shipsWithinLabel(storeCountry) }
			: null;
	return (
		<HomeOnlyContext.Provider value={visit}>
			{children}
		</HomeOnlyContext.Provider>
	);
}

/** The label for this product, or null when there's nothing to say. */
export function useHomeOnlyLabel(product: {
	kind?: string;
	event?: unknown;
	domesticOnly?: boolean;
}): string | null {
	const visit = useContext(HomeOnlyContext);
	return visit !== null && !shipsAbroad(product) ? visit.label : null;
}

/** The visitor's country when the store delivers there from abroad — the
 * header's "Delivers to Malaysia" line — or null at home / outside a
 * provider. */
export function useAbroadVisitor(): Country | null {
	return useContext(HomeOnlyContext)?.visitor ?? null;
}
