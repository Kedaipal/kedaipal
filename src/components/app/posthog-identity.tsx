import { useAuth } from "@clerk/tanstack-react-start";
import { useEffect, useRef } from "react";
import { getPostHogClient } from "../../lib/posthog";

/**
 * Ties the PostHog person to the signed-in seller (86eyrayux).
 *
 * Rendered inside the Clerk branch of the root provider tree — NOT inside
 * `/app` — because the reset half of this job has to outlive the dashboard: a
 * component mounted under `/app` unmounts the instant Clerk reports signed-out,
 * which is exactly when the reset needs to fire.
 *
 * Buyer surfaces never mount this (they render Clerk-free by design; see
 * `lib/buyer-routes.ts`), so shoppers stay anonymous and no buyer ever mints a
 * person profile.
 */
export function PostHogIdentity() {
	const { isLoaded, isSignedIn, userId } = useAuth();
	// Whether WE identified this browser. Without it, the else-branch below
	// would call reset() on every anonymous marketing-page mount, rotating a
	// visitor's distinct id mid-session and severing their own funnel.
	const identified = useRef(false);

	useEffect(() => {
		if (!isLoaded) return;
		const client = getPostHogClient();
		if (!client) return;

		if (isSignedIn && userId) {
			client.identify(userId);
			identified.current = true;
			return;
		}
		if (identified.current) {
			// Sign-out on a shared browser: without this, the next seller to sign
			// in inherits the previous one's events.
			client.reset();
			identified.current = false;
		}
	}, [isLoaded, isSignedIn, userId]);

	return null;
}

/**
 * Tags the seller's PostHog person with the store the dashboard is operating
 * on. Called from the `/app` shell, where the retailer is already loaded — so
 * this costs no extra query — and only there, because it is the only place the
 * answer exists.
 *
 * `actingAsAdmin` rides along so a Kedaipal admin running white-glove
 * onboarding is distinguishable in the data from the seller who owns the store;
 * without it, admin sessions would read as seller activity and inflate exactly
 * the activation metrics this integration exists to measure.
 */
export function usePostHogRetailer(
	retailerId: string | undefined,
	actingAsAdmin: boolean,
): void {
	useEffect(() => {
		if (!retailerId) return;
		getPostHogClient()?.setPersonProperties({ retailerId, actingAsAdmin });
	}, [retailerId, actingAsAdmin]);
}
