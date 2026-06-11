import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { CostCalculator } from "#/components/cost/cost-calculator";
import { Footer } from "#/components/landing/footer";
import { Nav } from "#/components/landing/nav";
import {
	BOUNDS,
	type CostInputs,
	clamp,
	DEFAULT_INPUTS,
} from "#/lib/calculator";

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

	const initialInputs: CostInputs = {
		ordersPerWeek:
			search.w !== undefined
				? clamp(search.w, BOUNDS.ordersPerWeek.min, BOUNDS.ordersPerWeek.max)
				: DEFAULT_INPUTS.ordersPerWeek,
		aov:
			search.aov !== undefined
				? clamp(search.aov, BOUNDS.aov.min, BOUNDS.aov.max)
				: DEFAULT_INPUTS.aov,
		missedPerWeek:
			search.m !== undefined
				? clamp(search.m, BOUNDS.missedPerWeek.min, BOUNDS.missedPerWeek.max)
				: DEFAULT_INPUTS.missedPerWeek,
		chaseMin:
			search.min !== undefined
				? clamp(search.min, BOUNDS.chaseMin.min, BOUNDS.chaseMin.max)
				: DEFAULT_INPUTS.chaseMin,
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
