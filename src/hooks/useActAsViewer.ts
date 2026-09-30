import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Who is looking at the dashboard, reduced to the two facts the admin act-as
 * session turns on (see `useActAs`): which Clerk SESSION is signed in, and
 * whether that user is a Kedaipal admin.
 *
 * It lives apart from the session so the session's rules (`resolveActAs`) can
 * be tested against any viewer without standing up Clerk and a Convex socket.
 */
export type ActAsViewer = {
	/**
	 * `undefined` until Clerk has loaded, `null` when nobody is signed in.
	 * Clerk mints a new `sessionId` on every sign-in and keeps it across a
	 * refresh, which is exactly the lifetime an act-as session should have.
	 */
	session: { userId: string; sessionId: string } | null | undefined;
	/** `undefined` until Convex has CONFIRMED who is asking, and answered. */
	isAdmin: boolean | undefined;
};

export function useActAsViewer(): ActAsViewer {
	const { isLoaded, userId, sessionId } = useAuth();
	const convexAuth = useConvexAuth();
	const session = !isLoaded
		? undefined
		: userId && sessionId
			? { userId, sessionId }
			: null;
	// The same query, and cache entry, the dashboard shell already reads — so
	// asking it here costs nothing.
	const amIAdmin = useQuery(
		convexQuery(api.billing.amIAdmin, session ? {} : "skip"),
	).data;
	// `amIAdmin` is only a verdict once Convex has confirmed the identity. A
	// query sent in the moment between Clerk loading and Convex attaching the
	// token is answered for an ANONYMOUS caller — `false` — and believing that
	// would end an admin's act-as session on every refresh.
	const isAdmin = convexAuth.isLoading
		? undefined
		: convexAuth.isAuthenticated
			? amIAdmin
			: false;
	return { session, isAdmin };
}
