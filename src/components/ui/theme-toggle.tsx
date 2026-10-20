import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";

/**
 * The quick theme control (z8r3fdadub). Two states, not three: the page has
 * already matched the device on arrival, so the only thing left worth offering
 * in passing is "actually, the other one". Tapping it writes an explicit
 * preference to this browser; the seller's three-way picker (Settings → App →
 * Appearance) is where "match device" can be chosen again.
 *
 * It rides every piece of chrome — buyer footers, the marketing nav, the
 * /stores header, the dashboard header and sidebar — because a theme toggle
 * that exists on some pages and not others is a page the visitor can't fix.
 *
 * `outline` is the footer form (a bordered disc beside the powered-by badge);
 * `ghost` matches the icon buttons it sits between in a nav bar.
 */
export function ThemeToggle({
	className,
	variant = "outline",
}: {
	className?: string;
	variant?: "outline" | "ghost";
}) {
	const { resolved, setPreference } = useTheme();
	const goingDark = resolved === "light";
	const label = goingDark ? "Switch to dark mode" : "Switch to light mode";

	return (
		<button
			type="button"
			onClick={() => setPreference(goingDark ? "dark" : "light")}
			aria-label={label}
			title={label}
			className={cn(
				"flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
				variant === "outline" && "border border-border",
				className,
			)}
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
