/**
 * How the credit-pack picker presents the packs (Credits T2, z8r3fdf8ht) —
 * pure, so the numbers a seller compares are pinned by tests. Packs read like
 * the /pricing cards: the credits are the headline, then the price, then what
 * a credit costs in each, and the bigger pack says exactly what it saves.
 * Order counts and prices only — never a percentage (credits-copy rule).
 */
import { formatPrice } from "./format";

type Pack = {
	id: string;
	credits: number;
	priceMinor: number;
	currency: string;
};

export type PackOffer = Pack & {
	/** What one credit costs in this pack, minor units, rounded to a cent. */
	perCreditMinor: number;
	/** The cheapest per credit, when the packs actually differ. */
	bestValue: boolean;
	/** What this pack saves against buying the same credits in the dearest
	 * pack — `null` for the dearest pack itself, or when nothing is saved. */
	saving: {
		minor: number;
		/** "4 × 50" — how many of the dearest pack it replaces, when the
		 * credits divide evenly (they do for every pack we sell). */
		versus: { count: number; credits: number } | null;
	} | null;
};

export function packOffers(packs: readonly Pack[]): PackOffer[] {
	const rate = (p: Pack) => p.priceMinor / p.credits;
	const dearest = packs.reduce<Pack | null>(
		(a, b) => (a === null || rate(b) > rate(a) ? b : a),
		null,
	);
	const cheapest = packs.reduce<Pack | null>(
		(a, b) => (a === null || rate(b) < rate(a) ? b : a),
		null,
	);
	const differ =
		dearest !== null && cheapest !== null && rate(dearest) !== rate(cheapest);
	return packs.map((p) => {
		const savedMinor =
			dearest && p.id !== dearest.id
				? Math.round(p.credits * rate(dearest) - p.priceMinor)
				: 0;
		return {
			...p,
			perCreditMinor: Math.round(rate(p)),
			bestValue: differ && cheapest?.id === p.id,
			saving:
				dearest && savedMinor > 0
					? {
							minor: savedMinor,
							versus:
								p.credits % dearest.credits === 0
									? {
											count: p.credits / dearest.credits,
											credits: dearest.credits,
										}
									: null,
						}
					: null,
		};
	});
}

/** A price with no cents when it has none — "S$ 22", "RM 45" — the way the
 * /pricing cards quote a plan. Non-whole amounts keep their cents. */
export function wholePrice(minor: number, currency: string): string {
	return formatPrice(minor, currency).replace(/\.00$/, "");
}

/** What the store will have once this pack lands, in orders — the preview
 * under the picker, so the seller sees the result of the tap before it.
 * A debt is paid first: "Covers the 15 owed and leaves 35 orders." */
export function afterTopUpLine(total: number, credits: number): string {
	const after = total + credits;
	const orders = (n: number) => `${n} ${n === 1 ? "order" : "orders"}`;
	if (total >= 0) return `After this top-up: ${orders(after)} left.`;
	const owed = -total;
	if (after > 0) return `Covers the ${owed} owed and leaves ${orders(after)}.`;
	if (after === 0) return `Covers the ${owed} owed exactly.`;
	return `Covers ${credits} of the ${owed} owed — ${-after} still owed after it.`;
}
