/**
 * What the inbox's "Update status" menu offers, derived from the SELECTION
 * rather than from the store (`z8r3fdh3w1`).
 *
 * Reading the retailer's primary flow offered "Ready for Pickup" and
 * "Collected" while a campsite booking was selected — pickup words on a stay,
 * for an action the server would then skip. A menu is a promise about what the
 * click does, so it is built from the rows the click will touch.
 *
 * Pure and separate from the route for the same reason
 * `inbox-status-chips.ts` is: it is a rule, not rendering, and the route it
 * came out of is two thousand lines long.
 */
import {
	ANCHOR_UI_LABELS,
	type OrderFlowKind,
	type OrderStage,
	STAGE_ANCHORS,
	type StageAnchor,
	stageLabel,
} from "./orderStatus";

/** One distinct vocabulary present in the selection. A packaged booking keys
 * separately from a plain stay: while bookings are on defaults the two read
 * Active/Ended vs Checked in/out. */
export type BulkVocab = { kind: OrderFlowKind; stages: OrderStage[] };

export type BulkTarget = {
	anchor: StageAnchor;
	label: string;
	/** No selected order has a step at this milestone, so the action would skip
	 * every one of them. Disabled rather than hidden — "why can't I mark these
	 * as packed?" needs an answer. */
	disabled: boolean;
	reason?: string;
};

export const NO_SUCH_STEP_REASON =
	"No step in the selected orders counts as this";

export const MIXED_KINDS_NOTE =
	"Your selection mixes kinds of order, so these are the shared milestones.";

/**
 * The four forward transitions, worded for this selection.
 *
 * - **One vocabulary** → its own words ("Checked In" for a stay).
 * - **Several that agree** → the shared word. The common delivery + pickup mix
 *   agrees on "Confirmed"/"Packed", so the seller keeps their familiar word and
 *   only a genuine disagreement changes anything.
 * - **Several that disagree** → the shared MILESTONE name (`ANCHOR_UI_LABELS`),
 *   the same vocabulary Settings teaches under "Counts as". No store word is
 *   true for every selected row, so none is used.
 * - **Nothing selected** → `fallbackStages` (the store's own flow) and nothing
 *   disabled; the trigger is disabled anyway, and milestone jargon behind an
 *   unpressable button helps no one.
 */
export function buildBulkTargets(
	vocabs: BulkVocab[],
	fallbackStages: OrderStage[],
): { targets: BulkTarget[]; note?: string } {
	let mixedWording = false;
	const targets = STAGE_ANCHORS.map((anchor): BulkTarget => {
		if (vocabs.length === 0) {
			const match = fallbackStages.find((s) => s.anchor === anchor);
			return {
				anchor,
				label: match ? stageLabel(match, "en") : ANCHOR_UI_LABELS[anchor],
				disabled: false,
			};
		}
		const words = new Set(
			vocabs
				.map((v) => v.stages.find((s) => s.anchor === anchor))
				.filter((s): s is OrderStage => s !== undefined)
				.map((s) => stageLabel(s, "en")),
		);
		// ONLY a genuine disagreement between vocabularies counts as mixing.
		// `words.size === 0` is the disabled case — it already carries its own
		// reason, and treating it as mixing put "Your selection mixes kinds of
		// order" above a selection of ONE kind. Caught by rendering it.
		if (words.size > 1) mixedWording = true;
		return {
			anchor,
			label: words.size === 1 ? [...words][0] : ANCHOR_UI_LABELS[anchor],
			disabled: words.size === 0,
			reason: words.size === 0 ? NO_SUCH_STEP_REASON : undefined,
		};
	});
	// Only worth saying when a word actually changed under the seller.
	return { targets, note: mixedWording ? MIXED_KINDS_NOTE : undefined };
}
