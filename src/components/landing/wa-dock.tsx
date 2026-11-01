import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAuthState } from "../../hooks/useAuthState";
import { useSectionVisibility } from "../../hooks/useSectionVisibility";
import { m } from "../../paraglide/messages";
import { DemoPill } from "./landing-ui";

/**
 * The floating WhatsApp dock (z8r3fdtpub T1, 19 Oct 2026): ONE pill, "Book a
 * demo on WhatsApp". A reader convinced halfway down the page used to have
 * nowhere to tap — on a phone the page ran nine screens between the hero's
 * link and the pricing card — and the dock is that tap.
 *
 * The first cut copied docket.io's per-section question chips beside the
 * pill; three loose bubbles stacked bottom-right read as clutter (Arif, on
 * sight) and the hero already asks the one question that matters, so the
 * chips went. And from `md` up the fixed nav bar already carries the demo
 * pill, so the dock would only double it: it renders below `md` alone, as a
 * bottom bar above the home indicator — exactly where the nav has no pill.
 *
 * It appears once the hero (`#top`) has scrolled out and hides while the
 * final CTA (`#final`) or the footer (`#site-footer`) is on screen — it
 * never doubles an ask already in front of the reader, never covers the
 * page's last lines — never shows to a signed-in seller (every other surface
 * gives them their dashboard door; the dock is a prospect's tool), and never
 * renders on the server or first paint (`useSectionVisibility` is `null`
 * until the observer reports).
 */
export function WaDock() {
	const auth = useAuthState();
	const heroVisible = useSectionVisibility("top");
	const finalVisible = useSectionVisibility("final");
	const footerVisible = useSectionVisibility("site-footer");
	const reduced = useReducedMotion();

	// Hidden until the hero has gone — `null` (SSR, first paint, no hero on
	// the page) counts as "not yet", never as "show".
	const shown =
		auth === "signed-out" &&
		heroVisible === false &&
		finalVisible !== true &&
		footerVisible !== true;

	return (
		<AnimatePresence>
			{shown ? (
				<motion.aside
					aria-label={m.dock_label()}
					initial={reduced ? false : { opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					exit={reduced ? undefined : { opacity: 0, y: 16 }}
					transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
					className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-lg md:hidden"
				>
					<DemoPill
						placement="dock"
						long
						className="min-h-12 w-full text-[15px]"
					/>
				</motion.aside>
			) : null}
		</AnimatePresence>
	);
}
