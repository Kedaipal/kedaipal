import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { ReferralInvite } from "../../convex/referrals";
import { readReferralSlug } from "../lib/referral-cookie";

/**
 * The referral invite to show a visitor (z8r3fdetf5) — on the marketing pages
 * they browse after opening a `/referral/<slug>` link, and on the link's own
 * page.
 *
 * Three answers, each a different render:
 *  - `undefined` — an invite is EXPECTED (a referral cookie, or the link being
 *    visited) but hasn't resolved yet: hold its place, so the hero doesn't
 *    shift when it lands;
 *  - `null` — nothing to show: no referral, or one whose store can't refer
 *    any more (the server never says why);
 *  - an invite — show it.
 *
 * Where the slug comes from, in order: the link being visited (`link`, which
 * also carries the loader's SSR answer for the first paint), then the cookie —
 * the server's read from the root loader on the first render, so SSR and
 * hydration agree, then `document.cookie` after mount, which also covers a
 * client-side navigation where the root loader doesn't re-run.
 */
export function useReferralInvite(link?: {
	slug: string;
	/** The loader's answer; `undefined` when the SSR read soft-degraded. */
	loaded: ReferralInvite | null | undefined;
}): ReferralInvite | null | undefined {
	const serverSlug = useRouterState({
		select: (state) => {
			const data = state.matches[0]?.loaderData as
				| { referralSlug?: unknown }
				| undefined;
			return typeof data?.referralSlug === "string" ? data.referralSlug : null;
		},
	});
	const [cookieSlug, setCookieSlug] = useState<string | null>(serverSlug);
	useEffect(() => {
		setCookieSlug(readReferralSlug(document.cookie) ?? null);
	}, []);
	const slug = link?.slug ?? cookieSlug;
	const live = useQuery(
		convexQuery(api.referrals.invite, slug ? { slug } : "skip"),
	).data;
	if (!slug) return null;
	if (live !== undefined) return live;
	return link ? link.loaded : undefined;
}
