import type { ReactNode } from "react";
import type { Tone } from "../../lib/tone";

/** The tones a billing stat tile can take — the TONE subset this page uses. */
export type StatTileTone = Extract<
	Tone,
	"neutral" | "info" | "warn" | "success" | "danger"
>;

/**
 * Tile surfaces. Not TONE_PANEL: these read `text-X-800` where the registry's
 * panels read `text-X-700`, so adopting it would repaint blue + emerald in
 * light mode (see lib/tone.ts). `danger` is the exception that moved: it used
 * to be `text-destructive` on `bg-destructive/10`, which is ~3.5:1 in light and
 * ~3:1 in dark — too faint for the 11px helper line — so it now matches the
 * other tinted tiles.
 */
const SURFACE: Record<StatTileTone, string> = {
	neutral: "border-border bg-muted/50 text-foreground",
	info: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
	warn: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
	success:
		"border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
	danger:
		"border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
};

/**
 * One stat tile for the admin billing page (z8r3fdwf9t). Both rows — the
 * invoice figures and the credit totals — render through this, because they
 * had been two hand-copied tiles that drifted: one row's icon well was
 * `bg-white/70` in BOTH themes (a near-white disc with a pale `-200` icon on
 * it in dark), the other's `bg-background/70`.
 *
 * The well is white in light (unchanged), and in dark it is the tile's OWN ink
 * at 15% (`bg-current/15`): a slightly brighter disc of the same hue, so the
 * icon — which inherits that ink — always reads on it, whatever the tone.
 */
export type StatTileProps = {
	label: string;
	value: string;
	helper: string;
	icon: ReactNode;
	tone: StatTileTone;
};

export function StatTile({ label, value, helper, icon, tone }: StatTileProps) {
	return (
		<div
			className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${SURFACE[tone]}`}
		>
			<div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/70 dark:bg-current/15">
				{icon}
			</div>
			<div className="min-w-0">
				<p className="text-xs font-medium opacity-75">{label}</p>
				<p className="truncate font-mono text-lg font-bold leading-tight">
					{value}
				</p>
				{/* Wraps: the helper IS the explanation — cut off, it read
				    "across 0 stores · service still …". */}
				<p className="text-[11px] leading-snug text-pretty opacity-70">
					{helper}
				</p>
			</div>
		</div>
	);
}
