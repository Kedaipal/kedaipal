import { useAuth, useClerk } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useConvexAuth } from "convex/react";
import { useEffect, useRef } from "react";
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

/**
 * @param onSignedOut Called the moment Clerk ends the signed-in session. The
 * viewer's own `session` can't carry that moment: while Clerk tears a session
 * down, `useAuth()` reports both ids `undefined` — "not loaded", not "signed
 * out" — and UserButton's redirect unmounts `/app` about 400ms later, before it
 * ever settles on `null`. Measured driving the real sign-out (z8r3fdkqn6 test
 * run, 2 Oct); Clerk's own listener is the one place that hears it.
 */
export function useActAsViewer(onSignedOut?: () => void): ActAsViewer {
	const { isLoaded, userId, sessionId } = useAuth();
	const clerk = useClerk();
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

	const onSignedOutRef = useRef(onSignedOut);
	useEffect(() => {
		onSignedOutRef.current = onSignedOut;
	});
	useEffect(
		() =>
			clerk.addListener(
				({ session: clerkSession, user }) => {
					if (!clerkSession && !user) onSignedOutRef.current?.();
				},
				// Changes only: the state at mount is `useAuth()`'s to report.
				{ skipInitialEmit: true },
			),
		[clerk],
	);

	return { session, isAdmin };
}
