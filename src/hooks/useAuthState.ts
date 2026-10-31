import { useAuth } from "@clerk/tanstack-react-start";
import { useEffect, useState } from "react";

export type AuthState = "loading" | "signed-in" | "signed-out";

/**
 * How long a marketing CTA waits for Clerk before giving up and showing the
 * signed-out doors. Clerk normally resolves well inside a second; past this
 * its script is blocked or the network is bad, and a prospect left looking at
 * a skeleton has no way to sign up or book a demo at all.
 */
export const AUTH_LOAD_TIMEOUT_MS = 3000;

/**
 * Whether the visitor on a marketing surface (landing, `/pricing`) is signed
 * in — with "we don't know yet" as its own answer (z8r3fdy2m0).
 *
 * Clerk resolves auth client-side only, so `isSignedIn` is `undefined` on the
 * server render and the first paint. Branching on `isSignedIn ? … : …` reads
 * that as signed-out, and a signed-in seller watched "Log in" / "Start free"
 * flip to "Go to dashboard" on every visit. Callers render a placeholder for
 * `"loading"` instead.
 *
 * After `AUTH_LOAD_TIMEOUT_MS` without Clerk the answer becomes
 * `"signed-out"`; a late Clerk load still moves it to `"signed-in"`.
 */
export function useAuthState(): AuthState {
	const { isLoaded, isSignedIn } = useAuth();
	const [timedOut, setTimedOut] = useState(false);
	useEffect(() => {
		if (isLoaded) return;
		const t = setTimeout(() => setTimedOut(true), AUTH_LOAD_TIMEOUT_MS);
		return () => clearTimeout(t);
	}, [isLoaded]);
	if (isLoaded) return isSignedIn ? "signed-in" : "signed-out";
	return timedOut ? "signed-out" : "loading";
}
