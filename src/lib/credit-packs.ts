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
/**
 * How many LIVE waiting orders a pack of `credits` actually opens.
 *
 * The queue advances by POSITIONS, one credit per position, and a cancelled
 * order keeps the position it was debited for (`waitingOrderOffsets`). So a
 * credit landing on a dead position opens nothing, and `min(waiting, credits)`
 * — which this used to be — over-promises by exactly the number of dead
 * positions the pack has to pay its way past.
 *
 * `offsets` is each live order's distance past the watermark, ascending, so
 * "does this pack reach it?" is `offset <= credits`. With no gaps the offsets
 * are `[1, 2, 3, …]` and this is `min(waiting, credits)` again, which is why
 * the ordinary case reads exactly as it did before.
 */
export function liveOrdersOpenedBy(
	offsets: readonly number[],
	credits: number,
): number {
	return offsets.filter((offset) => offset <= credits).length;
}

/**
 * What a pack OPENS, beside what it does to the balance (Credits T3.1).
 *
 * Said on the checkout line because "it unlocks your store" was the previous
 * release's copy and it was both wrong (the store was never locked) and vague
 * (which orders?).
 *
 * It must never over-promise, which is subtler than it looks: credits are
 * spent per queue POSITION and cancelled orders still hold theirs, so the
 * count of waiting orders is not the count a pack opens (PR #347 review, 9 Oct
 * 2026 — "4 live behind 2 cancelled" promised 4 and opened 2). When the two
 * diverge the line says where the difference went, because a seller who buys
 * 4 credits and watches 2 orders open with no explanation has been misled by
 * us, not by the rule.
 */
export function opensLine(
	waiting: number,
	credits: number,
	/** `CreditBalanceView.waitingOffsets`. Omitted ⇒ assume an unbroken queue,
	 * which is what every store without a cancelled gated order has. */
	offsets?: readonly number[],
): string {
	const queue = offsets ?? Array.from({ length: waiting }, (_, i) => i + 1);
	const opens = liveOrdersOpenedBy(queue, credits);
	const left = waiting - opens;
	const orders = (n: number) => `${n} ${n === 1 ? "order" : "orders"}`;
	if (left === 0)
		return `That opens ${waiting === 1 ? "the order" : `all ${orders(waiting)}`} waiting on credits.`;
	if (opens === 0) {
		// The pack doesn't reach the oldest waiting order, so say how far short
		// it falls. Deliberately NOT "N credits go to orders you cancelled":
		// that read as a wasted credit, and it isn't one — a cancelled gated
		// order's refund moves the watermark the same single position its
		// order held, so positions and debt stay in lockstep and every credit
		// the seller buys pays down real debt. Verified on dev: paying exactly
		// the debt always clears the live queue.
		const need = queue[0] ?? credits + 1;
		return `That doesn't open an order yet — the one waiting needs ${need === 1 ? "1 credit" : `${need} credits`}.`;
	}
	const freed =
		opens === 1
			? "the oldest order"
			: `the ${orders(opens)} that have waited longest`;
	return `That opens ${freed} — ${orders(left)} would still be waiting.`;
}

export function afterTopUpLine(total: number, credits: number): string {
	const after = total + credits;
	const orders = (n: number) => `${n} ${n === 1 ? "order" : "orders"}`;
	if (total >= 0) return `After this top-up: ${orders(after)} left.`;
	const owed = -total;
	if (after > 0) return `Covers the ${owed} owed and leaves ${orders(after)}.`;
	if (after === 0) return `Covers the ${owed} owed exactly.`;
	return `Covers ${credits} of the ${owed} owed — ${-after} still owed after it.`;
}
