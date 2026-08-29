import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";

/**
 * The buyer's theme control (z8r3fdadub).
 *
 * TWO states, not three, unlike the seller's Appearance settings. A shopper who
 * arrived from a WhatsApp link is here to place an order; the page has already
 * matched their phone by default, so the only thing left worth offering is
 * "actually, the other one". Exposing a "match device" option would mean
 * explaining a concept to solve a problem they don't have. Tapping it writes an
 * explicit preference to this browser, which is exactly what a buyer means by
 * tapping it.
 *
 * It lives in the storefront FOOTER on purpose: a theme switch must never
 * compete with the buy button. Nothing above the fold moves.
 */
export function ThemeToggle({ className }: { className?: string }) {
	const { resolved, setPreference } = useTheme();
	const goingDark = resolved === "light";
	const label = goingDark ? "Switch to dark mode" : "Switch to light mode";

	return (
		<button
			type="button"
			onClick={() => setPreference(goingDark ? "dark" : "light")}
			aria-label={label}
			title={label}
			className={`flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
				className ?? ""
			}`}
		>
			{/* Both glyphs render and CSS picks one. `resolved` reports light during
			    SSR and the first hydration pass — the class is already on <html> by
			    then, so branching on it here would paint a Moon on an
			    already-dark page for a frame. The label can use `resolved` safely:
			    nothing reads it until hydration, and no click is possible before. */}
			<Moon className="size-4.5 dark:hidden" aria-hidden="true" />
			<Sun className="hidden size-4.5 dark:block" aria-hidden="true" />
		</button>
	);
}
