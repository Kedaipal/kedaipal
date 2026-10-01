import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { type ActAsViewer, useActAsViewer } from "./useActAsViewer";

/**
 * Admin "act-as" session — which vendor store a Kedaipal admin is currently
 * operating (white-glove onboarding). See docs/admin-console.md.
 *
 * This is deliberately a **persistent client session**, NOT a URL search param.
 * A URL param has to be re-threaded through every `<Link>` and every programmatic
 * `navigate()`/CRUD redirect, and any one that forgets it silently drops the
 * admin back into their own store. Holding it in context (mirrored to
 * `sessionStorage`) means the whole dashboard — every page, every mutation, every
 * back button — stays inside the vendor store automatically, and it survives a
 * refresh, until the admin explicitly Exits. Per-tab (`sessionStorage`) so two
 * tabs can operate two different stores without colliding.
 *
 * **The session belongs to the Clerk session that started it** (ClickUp
 * `z8r3fdkqn6`). It used to be a bare store id, so it outlived the admin's
 * sign-in: the next person to sign in to that tab inherited it, the dashboard
 * asked `getRetailerForAdmin` for a store they don't run, the server refused,
 * and every /app page sat on its skeleton for good. The record now names the
 * admin's `userId` and Clerk `sessionId` beside the store, and
 * `resolveActAs` honours it only for that exact session, confirmed as an admin:
 *
 * - a refresh keeps it — the Clerk session is the same;
 * - signing out ends it — the provider deletes the record on Clerk's own
 *   sign-out event (`useAuth()` reads "loading" for the whole of a UserButton
 *   sign-out, so it can't be the signal), and `/app` mounts it OUTSIDE its
 *   sign-in gate so it is still there when that event fires. A sign-out
 *   anywhere else leaves a record naming a session that can never sign in
 *   again, deleted on the next read;
 * - no later sign-in to the tab — another user's, or the same admin's — can
 *   pick it up;
 * - a viewer Convex says is not an admin never acts as a store: the record is
 *   dropped instead of asking `getRetailerForAdmin` a question the server will
 *   refuse.
 */

/**
 * The `sessionStorage` key. Its value is an `ActAsRecord` as JSON — a bare id is
 * the format from before z8r3fdkqn6, names no owner, and is discarded on read.
 */
export const ACT_AS_STORAGE_KEY = "kp:actAsRetailerId";

export type ActAsRecord = {
	/** The admin who started the session… */
	userId: string;
	/** …in this Clerk sign-in, and no other. */
	sessionId: string;
	/** The store they are operating. */
	retailerId: Id<"retailers">;
};

/** The stored form of a record. */
export function serializeActAsRecord(record: ActAsRecord): string {
	return JSON.stringify(record);
}

function parseActAsRecord(raw: string): ActAsRecord | undefined {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (typeof value !== "object" || value === null) return undefined;
	const { userId, sessionId, retailerId } = value as Record<string, unknown>;
	if (typeof userId !== "string" || userId.length === 0) return undefined;
	if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
	if (typeof retailerId !== "string" || retailerId.length === 0)
		return undefined;
	return { userId, sessionId, retailerId: retailerId as Id<"retailers"> };
}

/**
 * What the stored act-as value means for this viewer:
 *
 * - `none` — no session; the viewer operates their own store.
 * - `pending` — a session this viewer may own, but Clerk or Convex hasn't
 *   confirmed it yet. The dashboard must WAIT, not guess: showing the admin's
 *   own store for a moment is a moment in which a write can land there.
 * - `active` — operate `retailerId`.
 * - `discard` — not this viewer's to use (another user's or another sign-in's,
 *   a viewer who isn't an admin, or unreadable): delete it, and show the
 *   viewer their own store.
 */
export type ActAsResolution =
	| { kind: "none" }
	| { kind: "pending" }
	| { kind: "active"; retailerId: Id<"retailers"> }
	| { kind: "discard" };

export function resolveActAs(
	stored: string | null,
	viewer: ActAsViewer,
): ActAsResolution {
	if (stored === null) return { kind: "none" };
	const record = parseActAsRecord(stored);
	if (!record) return { kind: "discard" };
	if (viewer.session === undefined) return { kind: "pending" };
	if (
		viewer.session === null ||
		viewer.session.userId !== record.userId ||
		viewer.session.sessionId !== record.sessionId
	)
		return { kind: "discard" };
	if (viewer.isAdmin === undefined) return { kind: "pending" };
	return viewer.isAdmin
		? { kind: "active", retailerId: record.retailerId }
		: { kind: "discard" };
}

type ActAsContextValue = {
	/** The store being operated — set only once `resolveActAs` says `active`. */
	actAsRetailerId: Id<"retailers"> | undefined;
	/** A stored session is waiting on Clerk/Convex to confirm its owner. */
	pending: boolean;
	setActAs: (id: Id<"retailers"> | undefined) => void;
};

const ActAsContext = createContext<ActAsContextValue | null>(null);

function persist(value: string | null): void {
	if (typeof window === "undefined") return;
	if (value === null) window.sessionStorage.removeItem(ACT_AS_STORAGE_KEY);
	else window.sessionStorage.setItem(ACT_AS_STORAGE_KEY, value);
}

export function ActAsProvider({ children }: { children: ReactNode }) {
	const [stored, setStored] = useState<string | null>(() =>
		typeof window === "undefined"
			? null
			: window.sessionStorage.getItem(ACT_AS_STORAGE_KEY),
	);
	const save = useCallback((value: string | null) => {
		persist(value);
		setStored(value);
	}, []);

	// A sign-out ends any session in this tab — nobody is left for it to belong
	// to. Heard on Clerk's own event (see `useActAsViewer`): `viewer.session`
	// reads "loading" for the whole of a UserButton sign-out.
	const viewer = useActAsViewer(() => save(null));
	const resolution = resolveActAs(stored, viewer);

	// Deleted, not merely ignored: a dead record left in the tab is one
	// refactor away from being read again.
	const discard = resolution.kind === "discard";
	useEffect(() => {
		if (discard) save(null);
	}, [discard, save]);

	const userId = viewer.session?.userId;
	const sessionId = viewer.session?.sessionId;
	const setActAs = useCallback(
		(id: Id<"retailers"> | undefined) => {
			// Stamped with who started it. The doors that start a session (the
			// admin directory) only render for a signed-in admin, so a missing
			// Clerk session means there is no one to stamp — start nothing.
			save(
				id && userId && sessionId
					? serializeActAsRecord({ userId, sessionId, retailerId: id })
					: null,
			);
		},
		[save, userId, sessionId],
	);

	const actAsRetailerId =
		resolution.kind === "active" ? resolution.retailerId : undefined;
	const pending = resolution.kind === "pending";
	const value = useMemo(
		() => ({ actAsRetailerId, pending, setActAs }),
		[actAsRetailerId, pending, setActAs],
	);
	return (
		<ActAsContext.Provider value={value}>{children}</ActAsContext.Provider>
	);
}

export function useActAs(): ActAsContextValue {
	const ctx = useContext(ActAsContext);
	if (!ctx) throw new Error("useActAs must be used within an ActAsProvider");
	return ctx;
}

/**
 * End the stored act-as session WITHOUT the provider.
 *
 * `useActAs` throws outside `ActAsProvider`, and the provider wraps the `/app`
 * subtree only — so `/onboarding`'s pre-built store claim, the moment a store
 * changes hands, cannot use the hook at all (it threw exactly that way the
 * first time a vendor opened it). The usual route to the claim is the admin's
 * own tab: they built the store, signed out, and the vendor signed in where the
 * admin's record can still sit — when that sign-out happened outside `/app`,
 * where no provider was mounted to see it. The record names the admin's Clerk
 * session, so `resolveActAs` never honours it for the vendor and their first
 * `/app` mount deletes it; clearing it here just ends it at the handover
 * itself rather than one page later.
 *
 * Exported from here rather than reaching for the key directly, so
 * `ACT_AS_STORAGE_KEY` keeps exactly one writer. Safe in SSR.
 */
export function clearStoredActAs(): void {
	persist(null);
}

/** Convenience reader for the current act-as retailer id (undefined = own store). */
export function useActAsRetailerId(): Id<"retailers"> | undefined {
	return useActAs().actAsRetailerId;
}
