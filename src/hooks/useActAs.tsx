import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import type { Id } from "../../convex/_generated/dataModel";

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
 */

const STORAGE_KEY = "kp:actAsRetailerId";

type ActAsContextValue = {
	actAsRetailerId: Id<"retailers"> | undefined;
	setActAs: (id: Id<"retailers"> | undefined) => void;
};

const ActAsContext = createContext<ActAsContextValue | null>(null);

export function ActAsProvider({ children }: { children: ReactNode }) {
	const [actAsRetailerId, setStored] = useState<Id<"retailers"> | undefined>(
		() => {
			if (typeof window === "undefined") return undefined;
			const v = window.sessionStorage.getItem(STORAGE_KEY);
			return v ? (v as Id<"retailers">) : undefined;
		},
	);

	const setActAs = useCallback((id: Id<"retailers"> | undefined) => {
		setStored(id);
		if (typeof window === "undefined") return;
		if (id) window.sessionStorage.setItem(STORAGE_KEY, id);
		else window.sessionStorage.removeItem(STORAGE_KEY);
	}, []);

	const value = useMemo(
		() => ({ actAsRetailerId, setActAs }),
		[actAsRetailerId, setActAs],
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
 * subtree only — so the one screen that most needs to end a session,
 * `/onboarding`'s pre-built store claim, cannot use the hook at all. (It threw
 * exactly that way the first time a vendor opened it.) The claim is the moment
 * a store changes hands, and the usual route to it is the admin's own tab:
 * they built the store, signed out, and the vendor signed in where the session
 * is still sitting in `sessionStorage`, which a sign-out does not clear.
 *
 * Exported from here rather than reaching for the key directly, so
 * `STORAGE_KEY` keeps exactly one owner. Safe before hydration and in SSR.
 */
export function clearStoredActAs(): void {
	if (typeof window === "undefined") return;
	window.sessionStorage.removeItem(STORAGE_KEY);
}

/** Convenience reader for the current act-as retailer id (undefined = own store). */
export function useActAsRetailerId(): Id<"retailers"> | undefined {
	return useActAs().actAsRetailerId;
}
