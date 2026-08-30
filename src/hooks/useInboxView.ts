import { useCallback, useEffect, useState } from "react";

/** Card list vs table — the orders inbox's two layouts (86eyrtz74). */
export type InboxView = "cards" | "table";

/**
 * The orders inbox's remembered LAYOUT (86eyrtz74).
 *
 * A seller who works in the table shouldn't be dropped back into cards every
 * time they open Orders from the nav — the layout is how they read their
 * business, not a per-visit choice. So the chosen view is remembered per store
 * on this device, exactly like the column layout it sits beside
 * (`useOrderColumns`): a personal display preference has no business costing a
 * Convex write or following the seller onto a colleague's screen.
 *
 * The URL still WINS when it names a view, so a shared or bookmarked link opens
 * the layout it was sent in. Absent from the URL means "whatever I was last
 * in" — which is why `setView` writes the explicit value both to the URL and to
 * storage, including `view=cards`. Keeping the default out of the URL (the
 * `bucket`/`sort` convention) would make cards unshareable and unpinnable
 * against a remembered table.
 *
 * Keyed per retailer so an admin acting across stores doesn't drag one store's
 * layout onto another.
 */
const STORAGE_PREFIX = "kp:orders:view:";

function storageKey(retailerId: string): string {
	return `${STORAGE_PREFIX}${retailerId}`;
}

export function parseStoredView(raw: string | null): InboxView | null {
	return raw === "table" || raw === "cards" ? raw : null;
}

function readInitial(retailerId: string): InboxView | null {
	if (typeof window === "undefined") return null;
	try {
		return parseStoredView(window.localStorage.getItem(storageKey(retailerId)));
	} catch {
		return null;
	}
}

export interface InboxViewState {
	/** The remembered view, or null while it hydrates / when never set. */
	stored: InboxView | null;
	/** Remember a view the seller just chose. */
	remember: (next: InboxView) => void;
}

export function useInboxView(retailerId: string): InboxViewState {
	const [stored, setStored] = useState<InboxView | null>(null);

	// Hydrate after mount (never during render) so the server and the first
	// client paint agree — the house pattern (useSidebarCollapsed,
	// useOrderColumns). In practice this lands before anything is visible: the
	// inbox is still behind its retailer-loading state on the first commit.
	useEffect(() => {
		setStored(readInitial(retailerId));
	}, [retailerId]);

	const remember = useCallback(
		(next: InboxView) => {
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
 * Which layout to render, given what the URL asked for, what this seller was
 * last in, and whether they can have the table at all.
 *
 * Precedence, in one place so it can't drift: **a seller without the Order
 * Inbox feature always gets cards**, then a view NAMED in the URL (a shared or
 * bookmarked link opens the layout it was sent in), then the remembered one,
 * and cards for a seller who has never chosen.
 *
 * The plan gate leads because the table IS a gated inbox surface, not a display
 * mode of the all-tier list: its header filters write URL params that
 * `searchOrders` refuses to honour for a Starter, and the cards/table toggle
 * lives inside the gated header actions. Without this, a Pro seller whose plan
 * lapses kept their remembered `view=table` and landed in a table whose funnels
 * wrote filters that changed nothing — with the toggle hidden, so no way back
 * to cards. Matches the posture the route already takes with stale URL filters:
 * ignore them rather than half-honour them.
 *
 * The stored preference is deliberately NOT cleared when gated — it is still
 * what they chose, and upgrading should put them back in the table.
 */
export function resolveInboxView(
	urlView: InboxView | undefined,
	stored: InboxView | null,
	inboxEnabled = true,
): InboxView {
	if (!inboxEnabled) return "cards";
	return urlView ?? stored ?? "cards";
}
