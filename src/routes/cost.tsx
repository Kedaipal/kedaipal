import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { CostCalculator } from "#/components/cost/cost-calculator";
import { Footer } from "#/components/landing/footer";
import { Nav } from "#/components/landing/nav";
import type { CostInputs } from "#/lib/calculator";

const SEO_TITLE = "What is WhatsApp-only ordering costing you? — Kedaipal";
const SEO_DESC =
	"Free calculator: in 60 seconds, work out the real monthly cost of missed orders and chasing payments over WhatsApp — and what plugging the leak is worth.";
const SITE_URL = "https://kedaipal.com";
const PAGE_URL = `${SITE_URL}/cost`;
const OG_IMAGE = `${SITE_URL}/og-image.png`;

/**
 * Optional prefill params so a shared `/cost?w=40&aov=35&m=5&min=5` link
 * reproduces a seller's numbers (intercept + case-study channels). All
 * coerced and optional; out-of-range values are clamped client-side.
 *
 * The params carry bare numbers with no currency, so a link built in Malaysia
 * and opened in Singapore reinterprets `aov=35` as S$35. Deliberate: a region
 * baked into the link would outlive the share, and the MY/SG toggle sits
 * directly above the sliders for anyone who needs to correct it.
 */
const searchSchema = z.object({
	w: z.coerce.number().optional(),
	aov: z.coerce.number().optional(),
	m: z.coerce.number().optional(),
	min: z.coerce.number().optional(),
});

export const Route = createFileRoute("/cost")({
	validateSearch: searchSchema,
	head: () => ({
		meta: [
			{ title: SEO_TITLE },
			{ name: "description", content: SEO_DESC },
			{ property: "og:type", content: "website" },
			{ property: "og:url", content: PAGE_URL },
			{ property: "og:title", content: SEO_TITLE },
			{ property: "og:description", content: SEO_DESC },
			{ property: "og:image", content: OG_IMAGE },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:title", content: SEO_TITLE },
			{ name: "twitter:description", content: SEO_DESC },
			{ name: "twitter:image", content: OG_IMAGE },
		],
		links: [{ rel: "canonical", href: PAGE_URL }],
	}),
	component: CostPage,
});

function CostPage() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();

	// Only the params the link actually carried. Anything absent is left for the
	// calculator to fill from the detected region's defaults, and clamping to
	// the slider ranges happens there too — the bounds are per currency now, and
	// the region isn't resolved until the calculator mounts.
	const initialInputs: Partial<CostInputs> = {
		...(search.w !== undefined && { ordersPerWeek: search.w }),
		...(search.aov !== undefined && { aov: search.aov }),
		...(search.m !== undefined && { missedPerWeek: search.m }),
		...(search.min !== undefined && { chaseMin: search.min }),
	};

	const syncToUrl = (inputs: CostInputs) => {
		navigate({
			search: {
				w: inputs.ordersPerWeek,
				aov: inputs.aov,
				m: inputs.missedPerWeek,
				min: inputs.chaseMin,
			},
			replace: true,
			resetScroll: false,
		});
	};

	return (
		<main className="min-h-dvh bg-background text-foreground">
			<Nav />
			<CostCalculator
				initialInputs={initialInputs}
				onInputsChange={syncToUrl}
			/>
			<Footer />
		</main>
	);
}
