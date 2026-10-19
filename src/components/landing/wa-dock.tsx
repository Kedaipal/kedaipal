import { useAuth } from "@clerk/tanstack-react-start";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BILLING_CURRENCY_FOR_COUNTRY } from "../../../convex/lib/plans";
import {
	useActiveSection,
	useSectionVisibility,
} from "../../hooks/useActiveSection";
import { useLandingRegionContext } from "../../hooks/useLandingRegion";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
import { trackDemoCta } from "../../lib/ga-events";
import { m } from "../../paraglide/messages";
import { DemoPill } from "./landing-ui";

/**
 * The floating WhatsApp dock (z8r3fdtpub T1, 19 Oct 2026 — after docket.io's
 * persistent "Talk to me" plus question chips). A reader convinced halfway
 * down the page used to have nowhere to tap: on a phone the page ran nine
 * screens between the hero's link and the pricing card. The dock is that
 * tap: the demo pill and two question chips that prefill the chat with what
 * a seller at THAT section tends to ask.
 *
 * It appears once the hero (`#top`) has scrolled out and hides while the
 * final CTA (`#final`) or the footer (`#site-footer`) is on screen — it
 * never doubles an ask already in front of the reader, never covers the
 * page's last lines — never shows to a signed-in seller, and never renders
 * on the server or first paint
 * (`useSectionVisibility` is `null` until the observer reports). Bottom-right
 * column on desktop; a bottom bar on a phone, above the home indicator.
 *
 * Each chip is its own WhatsApp link, so the message is prefilled with the
 * question and `demo_cta` carries it as `chip` — GA4 can say which question
 * converts, which the ticket's two-week read depends on.
 */

const CURRENCY_SYMBOL = { MYR: "RM", SGD: "S$" } as const;

const SECTIONS = [
	"top",
	"demo",
	"proof",
	"flow",
	"payments",
	"pricing",
	"faq",
] as const;

export function WaDock() {
	const { isSignedIn } = useAuth();
	const heroVisible = useSectionVisibility("top");
	const finalVisible = useSectionVisibility("final");
	const footerVisible = useSectionVisibility("site-footer");
	const section = useActiveSection(SECTIONS);
	const [region] = useLandingRegionContext();
	const supportWa = useSupportWaNumber();
	const reduced = useReducedMotion();

	// Hidden until the hero has gone — `null` (SSR, first paint, no hero on
	// the page) counts as "not yet", never as "show" — and while the final CTA
	// or the footer is on screen: a phone's footer is taller than the viewport
	// past the final CTA, and the dock would sit on its last lines. A signed-in
	// seller never sees it at all: the dock is a prospect's tool, and every
	// other surface gives them their dashboard door instead.
	const shown =
		!isSignedIn &&
		heroVisible === false &&
		finalVisible !== true &&
		footerVisible !== true;

	const currency = CURRENCY_SYMBOL[BILLING_CURRENCY_FOR_COUNTRY[region]];
	const chips =
		section === "flow" || section === "payments"
			? [m.dock_chip_store(), m.dock_chip_fit()]
			: section === "pricing" || section === "faq"
				? [m.dock_chip_plan({ currency }), m.dock_chip_store()]
				: [m.dock_chip_fit(), m.dock_chip_store()];

	return (
		<AnimatePresence>
			{shown ? (
				<motion.aside
					aria-label={m.dock_label()}
					initial={reduced ? false : { opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					exit={reduced ? undefined : { opacity: 0, y: 16 }}
					transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
					className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2 border-t border-border bg-background/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-lg sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none"
				>
					<div className="flex flex-wrap justify-end gap-2 sm:flex-col sm:items-end">
						{chips.map((chip) => (
							<a
								key={chip}
								href={buildWaContactLink(chip, supportWa)}
								target="_blank"
								rel="noopener noreferrer"
								onClick={() => trackDemoCta("dock", chip)}
								className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border border-border bg-card px-3.5 text-xs font-semibold text-card-foreground shadow-md shadow-primary/5 transition-colors hover:border-foreground/25 hover:bg-muted"
							>
								{chip}
							</a>
						))}
					</div>
					<DemoPill
						placement="dock"
						long
						className="min-h-12 w-full text-[15px] sm:w-auto sm:min-h-[52px]"
					/>
				</motion.aside>
			) : null}
		</AnimatePresence>
	);
}
