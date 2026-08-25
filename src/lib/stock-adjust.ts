/**
 * Stock adjustment — the pure half (86eypn8ye).
 *
 * Stock no longer rides the product Save button; it moves through an explicit
 * control that states, in words, three numbers the seller must never confuse:
 * what is on the shelf NOW, what the change IS, and what the count will BE.
 * Every label those three appear under is authored here so the dialog, the
 * multi-variant sheet and the confirm button cannot word the same movement
 * three different ways.
 */

/** What the seller is currently expressing. */
export type StockDraft =
	| { mode: "delta"; delta: number }
	/** `setTo: null` = the exact-count field is blank. */
	| { mode: "set"; setTo: number | null };

export const EMPTY_DELTA: StockDraft = { mode: "delta", delta: 0 };

/**
 * The count this draft would produce, or `null` when it says nothing yet
 * (a blank exact-count field).
 *
 * A negative movement clamps at zero rather than erroring: matching
 * `decrementAggregatesForCancel` and the usage meter, an over-subtraction
 * self-heals instead of dead-ending the seller at a counter.
 */
export function nextCount(live: number, draft: StockDraft): number | null {
	if (draft.mode === "delta") return Math.max(0, live + draft.delta);
	return draft.setTo;
}

/** True when confirming would actually move the number. */
export function hasChange(live: number, draft: StockDraft): boolean {
	const next = nextCount(live, draft);
	return next !== null && next !== live;
}

/**
 * The movement, named as a verb phrase, shown under the big result number.
 *
 * This line is the anti-confusion device: the large digits are the RESULT, and
 * without a sentence naming the change beside them a seller can read "30" as
 * "I am adding 30". Never omit it.
 */
export function movementLabel(live: number, draft: StockDraft): string {
	const next = nextCount(live, draft);
	if (next === null) return "Type the count you made";
	const diff = next - live;
	if (diff === 0) return "No change yet";
	if (draft.mode === "set")
		return diff > 0
			? `${diff} more than the store holds`
			: `${-diff} fewer than the store holds`;
	return diff > 0 ? `Adding ${diff}` : `Removing ${-diff}`;
}

/**
 * The confirm button's label. Borrowed from the rejected "three verbs"
 * direction: naming the movement on the button means the last thing read before
 * the tap is what will happen, which recovers that direction's explicitness
 * without making the seller pick a mode before they can type.
 */
export function confirmLabel(live: number, draft: StockDraft): string {
	const next = nextCount(live, draft);
	if (next === null || next === live) return "No change";
	if (draft.mode === "set") return `Set to ${next}`;
	const diff = next - live;
	return diff > 0 ? `Add ${diff}` : `Remove ${-diff}`;
}

/**
 * Clamp a stepped/typed movement so the result can never go below zero — the
 * `-` button disables at the floor instead of letting the seller build a
 * movement the server would silently clamp anyway.
 */
export function clampDelta(live: number, delta: number): number {
	return Math.max(-live, delta);
}

/**
 * The mutation argument for one row. `set` carries the count the seller could
 * see at the moment they confirmed, so the server can refuse an overwrite of a
 * sale that landed in between rather than writing it out of existence.
 */
export function toAdjustment<T>(
	variantId: T,
	live: number,
	draft: StockDraft,
):
	| { variantId: T; delta: number }
	| { variantId: T; setTo: number; expectedOnHand: number } {
	if (draft.mode === "set") {
		const setTo = draft.setTo ?? live;
		return { variantId, setTo, expectedOnHand: live };
	}
	return { variantId, delta: clampDelta(live, draft.delta) };
}

/**
 * How the dialog reacts to the live count moving while it is open — the same
 * race as the bug this ticket fixes, compressed into seconds.
 *
 * A movement is correct against ANY starting number, so it only informs. An
 * exact count is not, so it warns and offers the arithmetic. Neither ever
 * blocks: only the seller knows whether they counted the shelf before or after
 * those units went out the door.
 */
export function liveShift(
	openedAt: number,
	live: number,
	draft: StockDraft,
): { tone: "info" | "warn"; message: string; suggestion?: number } | null {
	if (live === openedAt) return null;
	const moved = openedAt - live;
	const what =
		moved > 0
			? `${moved} ${moved === 1 ? "unit" : "units"} sold`
			: `${-moved} ${-moved === 1 ? "unit was" : "units were"} added`;
	if (draft.mode === "delta")
		return {
			tone: "info",
			message: `${what} while this was open — now ${live}. Your change still applies on top.`,
		};
	return {
		tone: "warn",
		message: `${what} while you were counting. The store holds ${live} now, not ${openedAt} — saving your count writes that over.`,
		suggestion:
			draft.setTo === null ? undefined : Math.max(0, draft.setTo - moved),
	};
}
