import type { ReactNode } from "react";

/**
 * A pick-one MODE card — a title, a one-line consequence, and a radio dot.
 * Moved out of the Fulfilment tab (z8r3fdhpm7) the moment a second surface
 * needed the same choice shape: the product form's "How are the days
 * counted?" is the same kind of decision as the opening-hours and
 * delivery-charge modes, so it wears the same control rather than a
 * look-alike. Lay several side by side in a grid; `aria-pressed` carries the
 * state for assistive tech.
 */
export function ModeButton({
	active,
	disabled,
	onClick,
	title,
	subtitle,
	badge,
}: {
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
	title: string;
	subtitle: string;
	badge?: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-pressed={active}
			className={`relative flex flex-col items-start gap-0.5 rounded-xl border-2 py-2.5 pl-3 pr-9 text-left transition-colors ${
				active
					? "border-accent bg-accent/5"
					: "border-border bg-card hover:border-accent/40"
			} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
		>
			<span
				className={`flex items-center gap-1.5 text-sm font-semibold ${active ? "text-accent" : "text-foreground"}`}
			>
				{title}
				{badge}
			</span>
			<span className="text-xs text-muted-foreground">{subtitle}</span>
			<ModeRadioDot active={active} />
		</button>
	);
}

/**
 * Radio-style indicator in a mode card's corner. These grids choose exactly
 * ONE option, but the tinted-border selected state alone read as "these might
 * all be on" (Zaki, 27 Jul) — an explicit empty-ring vs filled-dot makes the
 * pick-one semantics visible at a glance. Decorative only: the button itself
 * carries aria-pressed.
 */
export function ModeRadioDot({ active }: { active: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={`absolute bottom-2.5 right-2.5 flex size-4 items-center justify-center rounded-full border-2 transition-colors ${
				active ? "border-accent" : "border-border"
			}`}
		>
			{active ? <span className="size-2 rounded-full bg-accent" /> : null}
		</span>
	);
}
