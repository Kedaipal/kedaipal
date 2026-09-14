import { useCallback, useEffect, useState } from "react";
import type { PinMode } from "../../convex/lib/orderInboxFilter";

/**
 * The orders inbox's remembered PIN BEHAVIOUR (86eyrtz74, fixed here).
 *
 * The Pinned chip cycles three ways, and they are not the same kind of thing:
 *
 *   - `top` / `off` — PRESENTATION. Whether a pinned order floats above the
 *     list or is filtered like any other. This is how the seller reads their
 *     inbox, not what they are looking at, so it is remembered per store on
 *     this device, exactly like the layout (`useInboxView`) and the column
 *     set (`useOrderColumns`).
 *   - `only` — a FILTER. It narrows the list to pinned orders, so it lives in
 *     the URL alone and is deliberately NEVER remembered. Carrying it forward
 *     would silently hide the results of the seller's next drill-in, which is
 *     the opposite of helpful.
 *
 * The bug this fixes: a seller who turned pinning off got it back on every
 * time they arrived from an Insights drill-in, because a drill-in builds a
 * fresh search object, `pin` was absent, and absent meant the `top` default
 * rather than "what I last chose".
 *
 * Keyed per retailer so an admin acting across stores doesn't drag one store's
 * preference onto another.
 */

/** The two modes worth remembering — `only` is a filter, not a preference. */
export type RememberedPinMode = Exclude<PinMode, "only">;

const STORAGE_PREFIX = "kp:orders:pin:";

function storageKey(retailerId: string): string {
	return `${STORAGE_PREFIX}${retailerId}`;
}

export function parseStoredPinMode(
	raw: string | null,
): RememberedPinMode | null {
	return raw === "top" || raw === "off" ? raw : null;
}

function readInitial(retailerId: string): RememberedPinMode | null {
	if (typeof window === "undefined") return null;
	try {
		return parseStoredPinMode(
			window.localStorage.getItem(storageKey(retailerId)),
		);
	} catch {
		return null;
	}
}

export interface InboxPinModeState {
	/** The remembered mode, or null while it hydrates / when never set. */
	stored: RememberedPinMode | null;
	/** Remember a mode the seller just chose. `only` is ignored by design. */
	remember: (next: PinMode) => void;
}

export function useInboxPinMode(retailerId: string): InboxPinModeState {
	const [stored, setStored] = useState<RememberedPinMode | null>(null);

	// Hydrate after mount (never during render) so the server and the first
	// client paint agree — the house pattern (useInboxView, useOrderColumns).
	useEffect(() => {
		setStored(readInitial(retailerId));
	}, [retailerId]);

	const remember = useCallback(
		(next: PinMode) => {
			if (next === "only") return;
			setStored(next);
			try {
				window.localStorage.setItem(storageKey(retailerId), next);
			} catch {
				// localStorage unavailable (private mode, quota) — keep in-memory.
			}
		},
		[retailerId],
	);

	return { stored, remember };
}

/**
 * Which pin behaviour to apply, given what the URL asked for and what this
 * seller last chose.
 *
 * Precedence, in one place so it can't drift: a mode NAMED in the URL always
 * wins (a shared or bookmarked link opens the way it was sent, and `only` can
 * only ever arrive this way), then the remembered preference, then `top` for a
 * seller who has never chosen.
 */
export function resolvePinMode(
	urlPin: Exclude<PinMode, "top"> | undefined,
	stored: RememberedPinMode | null,
): PinMode {
	return urlPin ?? stored ?? "top";
}
