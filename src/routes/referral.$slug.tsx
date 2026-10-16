import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { api } from "../../convex/_generated/api";
import {
	REFERRER_STORE_PARAM,
	sanitizeReferrerSlug,
} from "../../convex/lib/poweredBy";
import { referralPath, referralSourceTag } from "../../convex/lib/referral";
import type { ReferralInvite } from "../../convex/referrals";
import { LandingPage } from "../components/landing/landing-page";
import { useReferralInvite } from "../hooks/useReferralInvite";
import { getConvexHttpClient, SITE_URL } from "../lib/convex-server";
import { writeReferralCookie } from "../lib/referral-cookie";
import { referralMeta } from "../lib/referral-meta";
import { ssrRead } from "../lib/ssr-read";

/**
 * A seller's referral link, `kedaipal.com/referral/<their-slug>` (z8r3fdetf5,
 * docs/referrals.md). The link IS the code — no typed codes anywhere.
 *
 * It renders the landing page itself rather than redirecting to `/`, for the
 * place this link actually travels: WhatsApp. A link unfurler follows a
 * redirect and reads the TARGET's tags, so a redirect would preview every
 * referral as the generic Kedaipal card. Rendering here lets the preview say
 * who is inviting and what the visitor gets — the loader resolves the invite
 * server-side for `head()` and the first paint.
 *
 * A link whose store can't refer right now (trial, lapsed, unknown) gets the
 * plain landing and promises nothing — the server says only "no invite",
 * never why. A valid one is remembered for 30 days (`referral-cookie.ts`) so
 * it reaches signup even on another day. Not for search engines: `noindex`,
 * canonical `/`.
 */

interface ReferralLoaderData {
	/** `undefined` when the SSR read failed and the client query decides. */
	invite: ReferralInvite | null | undefined;
}

const OG_IMAGE = `${SITE_URL}/og-image.png`;
const FALLBACK_TITLE = "Kedaipal — WhatsApp Order Hub for Malaysian Sellers";
const FALLBACK_DESC =
	"Sell on WhatsApp. Never lose an order or a payment. Orders, payments and couriers on one screen. Free until your first order, no Meta setup.";

export const Route = createFileRoute("/referral/$slug")({
	loader: async ({ params }): Promise<ReferralLoaderData> => {
		const client = getConvexHttpClient();
		// Soft-degrade like every public loader (86eyheqzv): a transient
		// upstream failure renders the landing and the client query decides.
		const read = await ssrRead(() =>
			client.query(api.referrals.invite, { slug: params.slug }),
		);
		return { invite: read.ok ? read.value : undefined };
	},
	head: ({ loaderData, params }) => {
		const invite = loaderData?.invite;
		const { title, description } = invite
			? referralMeta(invite)
			: { title: FALLBACK_TITLE, description: FALLBACK_DESC };
		const url = `${SITE_URL}${referralPath(params.slug)}`;
		return {
			meta: [
				{ title },
				{ name: "description", content: description },
				// A share link, not a page: one per seller, all the same pitch.
				{ name: "robots", content: "noindex, follow" },
				{ property: "og:type", content: "website" },
				{ property: "og:url", content: url },
				{ property: "og:title", content: title },
				{ property: "og:description", content: description },
				{ property: "og:image", content: OG_IMAGE },
				{ property: "og:image:width", content: "1200" },
				{ property: "og:image:height", content: "630" },
				{ property: "og:locale", content: "en_MY" },
				{ name: "twitter:card", content: "summary_large_image" },
				{ name: "twitter:title", content: title },
				{ name: "twitter:description", content: description },
				{ name: "twitter:image", content: OG_IMAGE },
			],
			links: [{ rel: "canonical", href: SITE_URL }],
		};
	},
	component: ReferralLanding,
});

function ReferralLanding() {
	const { slug } = Route.useParams();
	const loaded = Route.useLoaderData().invite;
	const invite = useReferralInvite({ slug, loaded });

	// The link's analytics tag, captured like any `?src=` visit — even for a
	// link that turned out to name nobody, which is still a referral VISIT
	// worth counting. The referrer rides `store=` (never parsed out of the
	// tag, which truncates long slugs).
	const attributionSearch = useMemo(() => {
		const params = new URLSearchParams({ src: referralSourceTag(slug) });
		const store = sanitizeReferrerSlug(slug);
		if (store) params.set(REFERRER_STORE_PARAM, store);
		return `?${params.toString()}`;
	}, [slug]);

	// Remember the referral only once the page has shown its offer — a link
	// that promised nothing leaves nothing behind. The CURRENT slug, so a link
	// shared before a rename is kept by the name that resolves today.
	const resolvedSlug = invite ? invite.slug : null;
	useEffect(() => {
		if (resolvedSlug) writeReferralCookie(resolvedSlug);
	}, [resolvedSlug]);

	return <LandingPage invite={invite} attributionSearch={attributionSearch} />;
}
